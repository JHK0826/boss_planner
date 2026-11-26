package com.bossplanner.app.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.time.Instant
import java.time.ZoneId

/** 게임 스케줄러에 등록한 보스 하나 (서버 domain/earnings.ts의 PricedBoss) */
data class SchedulerBoss(
    val name: String,
    /** EASY | NORMAL | HARD | CHAOS | EXTREME */
    val difficulty: String,
    /** WEEKLY | MONTHLY */
    val cycle: String,
    val cleared: Boolean,
    /** 앱에서 그 보스로 들어간 파티의 인원. 없으면 1 */
    val partySize: Int,
    /** 결정석 가격. 미등록이면 null */
    val price: Long?,
    /** 내 몫 = 가격 ÷ 인원수 */
    val share: Long,
) {
    val isWeekly: Boolean get() = cycle == "WEEKLY"
}

data class CharacterScheduler(
    val bosses: List<SchedulerBoss>,
    val fetchedAtMs: Long?,
    /** 이번에 받지 못한 이유 (저장해 둔 값이 있으면 그 값도 함께 온다) */
    val error: String?,
)

data class SettlementEarning(val key: String, val characterId: String?, val partyName: String, val amount: Long, val raidAtMs: Long)

/** 수익 기록 한 기간 (users/{uid}/earnings/{W-yyyyMMdd | M-yyyyMM}) */
data class EarningsRecord(
    val id: String,
    /** characterId → 결정석 합계 */
    val crystals: Map<String, Long>,
    val settlements: List<SettlementEarning>,
)

class EarningsRepository(
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val functions: FirebaseFunctions = FirebaseFunctions.getInstance("asia-northeast3"),
) {
    /** 골라 둔 캐릭터마다 게임 스케줄러에 등록한 보스. 서버가 1시간 동안 저장해 두고(주·달이 바뀌면 다시), refresh면 1분이 지났을 때 다시 받는다. */
    suspend fun schedulerState(refresh: Boolean = false): Map<String, CharacterScheduler> {
        val result = functions.getHttpsCallable("getSchedulerState").call(mapOf("refresh" to refresh)).await().getData() as? Map<*, *>
        val characters = result?.get("characters") as? Map<*, *> ?: return emptyMap()
        return characters.entries.mapNotNull { (id, value) ->
            val state = value as? Map<*, *> ?: return@mapNotNull null
            (id as? String ?: return@mapNotNull null) to CharacterScheduler(
                bosses = (state["bosses"] as? List<*>).orEmpty().mapNotNull { item ->
                    val boss = item as? Map<*, *> ?: return@mapNotNull null
                    SchedulerBoss(
                        name = boss["name"] as? String ?: return@mapNotNull null,
                        difficulty = boss["difficulty"] as? String ?: "",
                        cycle = boss["cycle"] as? String ?: "WEEKLY",
                        cleared = boss["cleared"] == true,
                        partySize = (boss["partySize"] as? Number)?.toInt() ?: 1,
                        price = (boss["price"] as? Number)?.toLong(),
                        share = (boss["share"] as? Number)?.toLong() ?: 0,
                    )
                },
                fetchedAtMs = (state["fetchedAtMs"] as? Number)?.toLong(),
                error = state["error"] as? String,
            )
        }.toMap()
    }

    /** 내 수익 기록 전부. 한 해에 60개 남짓이라 통째로 구독한다. */
    fun earnings(uid: String): Flow<List<EarningsRecord>> = callbackFlow {
        val registration = db.collection("users").document(uid).collection("earnings").addSnapshotListener { snapshot, error ->
            if (error != null || snapshot == null) {
                trySend(emptyList())
                return@addSnapshotListener
            }
            trySend(
                snapshot.documents.map { doc ->
                    val characters = doc.get("characters") as? Map<*, *> ?: emptyMap<Any, Any>()
                    val settlements = doc.get("settlements") as? Map<*, *> ?: emptyMap<Any, Any>()
                    EarningsRecord(
                        id = doc.id,
                        crystals = characters.entries.mapNotNull { (id, value) ->
                            val crystal = ((value as? Map<*, *>)?.get("crystalValue") as? Number)?.toLong() ?: return@mapNotNull null
                            (id as? String ?: return@mapNotNull null) to crystal
                        }.toMap(),
                        settlements = settlements.entries.mapNotNull { (key, value) ->
                            val s = value as? Map<*, *> ?: return@mapNotNull null
                            SettlementEarning(
                                key = key as? String ?: return@mapNotNull null,
                                characterId = s["characterId"] as? String,
                                partyName = s["partyName"] as? String ?: "",
                                amount = (s["amount"] as? Number)?.toLong() ?: 0,
                                raidAtMs = (s["raidAt"] as? Timestamp)?.toDate()?.time ?: 0,
                            )
                        },
                    )
                },
            )
        }
        awaitClose { registration.remove() }
    }
}

/** 수익 보기 계산 (웹 web/src/lib/earnings.ts와 같은 규칙) */
object Earnings {
    private val KST: ZoneId = ZoneId.of("Asia/Seoul")

    /** 난이도 배지 글자 */
    fun short(difficulty: String): String = when (difficulty) {
        "EXTREME" -> "EX"
        "CHAOS" -> "C"
        "HARD" -> "H"
        "NORMAL" -> "N"
        "EASY" -> "E"
        else -> difficulty
    }

    /** 주간 기록 ID "W-yyyyMMdd" (목요일 시작) */
    fun weekId(ms: Long): String = "W-" + TimeSlots.slotId(TimeSlots.weekStart(ms)).substring(0, 8)

    /** 월간 기록 ID "M-yyyyMM" */
    fun monthId(ms: Long): String = "M-" + TimeSlots.slotId(ms).substring(0, 6)

    /** 이번 주 예상 수익: 등록한 주간 보스 전부 + 이번 달에 아직 안 잡은 월간 보스의 몫 */
    fun expectedThisWeek(bosses: List<SchedulerBoss>): Long = bosses.filter { it.isWeekly || !it.cleared }.sumOf { it.share }

    data class Week(val crystal: Long, val settlement: Long, val settlements: List<SettlementEarning>) {
        val total: Long get() = crystal + settlement
    }

    /** 이번 주에 번 돈: 클리어한 주간 보스의 결정석 + 이번 주 레이드의 정산금 */
    fun earnedThisWeek(bosses: List<SchedulerBoss>, records: List<EarningsRecord>, characterId: String, nowMs: Long): Week {
        val crystal = bosses.filter { it.isWeekly && it.cleared }.sumOf { it.share }
        val settlements = records.firstOrNull { it.id == weekId(nowMs) }?.settlements.orEmpty()
            .filter { it.characterId == characterId }
            .sortedBy { it.raidAtMs }
        return Week(crystal, settlements.sumOf { it.amount }, settlements)
    }

    data class Month(val monthId: String, val label: String, val crystal: Long, val settlement: Long, val recorded: Boolean) {
        val total: Long get() = crystal + settlement
    }

    /** 최근 n달(이번 달부터). 주간 기록은 시작일(목요일)이 속한 달로 묶고 월간 결정석을 더한다. */
    fun monthly(records: List<EarningsRecord>, characterId: String, nowMs: Long, count: Int = 6): List<Month> {
        val now = Instant.ofEpochMilli(nowMs).atZone(KST).toLocalDate().withDayOfMonth(1)
        return (0 until count).map { i ->
            val date = now.minusMonths(i.toLong())
            val monthId = "M-%04d%02d".format(date.year, date.monthValue)
            var crystal = 0L
            var settlement = 0L
            var recorded = false
            for (record in records) {
                val inMonth = record.id == monthId || (record.id.startsWith("W-") && "M-" + record.id.substring(2, 8) == monthId)
                if (!inMonth) continue
                record.crystals[characterId]?.let {
                    crystal += it
                    recorded = true
                }
                record.settlements.filter { it.characterId == characterId }.forEach {
                    settlement += it.amount
                    recorded = true
                }
            }
            Month(monthId, "${date.year}년 ${date.monthValue}월", crystal, settlement, recorded)
        }
    }
}
