package com.bossplanner.app.data

data class PartyMember(
    val uid: String,
    val displayName: String,
    val characterName: String,
    val job: String,
    val level: Int,
)

data class Party(
    val id: String,
    val name: String,
    val bossName: String,
    val difficulty: String,
    val cycle: String,
    val durationSlots: Int,
    val leaderUid: String,
    val memberUids: List<String>,
    val members: Map<String, PartyMember>,
    val inviteCode: String,
    val scheduleStarted: Boolean,
) {
    val isWeekly: Boolean get() = cycle == "WEEKLY"
}

data class Candidate(val slotId: String, val startMs: Long, val endMs: Long)

data class Schedule(
    val id: String,
    val state: String,
    val periodStartMs: Long,
    val periodEndMs: Long,
    val inputDeadlineMs: Long,
    val durationSlots: Int,
    /** 후보가 바뀔 때마다 오른다. 투표는 같은 round일 때만 유효하다. */
    val round: Int,
    val candidates: List<Candidate>,
    /** 전원이 동의한 후보 번호 */
    val unanimous: List<Int>,
    val skippedReason: String?,
    /** 확정된 레이드 시간. 확정 전이면 null */
    val confirmed: Confirmed?,
    val changeRequest: ChangeRequest?,
    val retryCount: Int,
    val expiredReason: String?,
    /** 등록된 분배금. 아직 등록 전이면 null */
    val settlement: Settlement?,
) {
    /** 클리어했지만 분배금 정산이 끝나지 않았다 */
    val settlementOpen: Boolean get() = state == "SETTLED" && settlement?.completed != true

    /** 불가 시간 입력·투표·확정을 받는 상태 (처음 조율 또는 미클리어 후 재조정) */
    val acceptsInput: Boolean get() = state == "OPEN" || state == "RETRY"
}

data class Confirmed(val startMs: Long, val endMs: Long)

data class ChangeRequest(val requestedBy: String, val reason: String, val status: String) {
    val isPending: Boolean get() = status == "PENDING"
}

data class Settlement(val sellerUid: String, val amountPerPerson: Long, val completed: Boolean)

/** 받을 사람 한 명의 분배금 상태: PENDING(대기) → PAID(지급함) → RECEIVED(수령 확인) */
data class SettlementEntry(val uid: String, val amount: Long, val status: String)

data class ChatMessage(val id: String, val senderUid: String, val text: String, val createdAtMs: Long)

/** 내 확정 일정 한 건 (여러 파티에 걸친 주간 시간표용) */
data class Raid(
    val partyId: String,
    val partyName: String,
    val bossName: String,
    val difficulty: String,
    val startMs: Long,
    val endMs: Long,
)

data class Unavailable(val slots: List<String>, val submitted: Boolean)

data class Vote(val agreed: List<Int>, val round: Int)

data class Boss(val name: String, val difficulties: List<String>, val monthly: Boolean = false)

/**
 * 주간·월간 보스 목록. 이름과 난이도는 NEXON 스케줄러 API의 boss_contents 값과 같아야
 * 05:00 자동 클리어 확인이 된다 (2026-11 기준 API 응답에서 가져옴).
 */
object Bosses {
    val all = listOf(
        Boss("자쿰", listOf("CHAOS")),
        Boss("매그너스", listOf("HARD")),
        Boss("파풀라투스", listOf("CHAOS")),
        Boss("피에르", listOf("CHAOS")),
        Boss("반반", listOf("CHAOS")),
        Boss("블러디퀸", listOf("CHAOS")),
        Boss("벨룸", listOf("CHAOS")),
        Boss("스우", listOf("NORMAL", "HARD", "EXTREME")),
        Boss("데미안", listOf("NORMAL", "HARD")),
        Boss("가디언 엔젤 슬라임", listOf("NORMAL", "CHAOS")),
        Boss("루시드", listOf("EASY", "NORMAL", "HARD")),
        Boss("윌", listOf("EASY", "NORMAL", "HARD")),
        Boss("더스크", listOf("NORMAL", "CHAOS")),
        Boss("진 힐라", listOf("NORMAL", "HARD")),
        Boss("듄켈", listOf("NORMAL", "HARD")),
        Boss("검은 마법사", listOf("HARD", "EXTREME"), monthly = true),
        Boss("선택받은 세렌", listOf("NORMAL", "HARD", "EXTREME")),
        Boss("감시자 칼로스", listOf("EASY", "NORMAL", "CHAOS", "EXTREME")),
        Boss("카링", listOf("EASY", "NORMAL", "HARD", "EXTREME")),
        Boss("림보", listOf("NORMAL", "HARD", "EXTREME")),
        Boss("발드릭스", listOf("NORMAL", "HARD", "EXTREME")),
        Boss("최초의 대적자", listOf("EASY", "NORMAL", "HARD", "EXTREME")),
        Boss("찬란한 흉성", listOf("NORMAL", "HARD")),
        Boss("유피테르", listOf("NORMAL", "HARD")),
        Boss("시즌 보스 메이린", listOf("NORMAL", "HARD")),
        Boss("벨로나", listOf("EASY", "NORMAL", "HARD")),
    )

    fun find(name: String): Boss = all.firstOrNull { it.name == name } ?: all.first()

    private val labels = mapOf(
        "EASY" to "이지",
        "NORMAL" to "노멀",
        "HARD" to "하드",
        "CHAOS" to "카오스",
        "EXTREME" to "익스트림",
    )

    fun difficultyLabel(code: String): String = labels[code] ?: code
}
