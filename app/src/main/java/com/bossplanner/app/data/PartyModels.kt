package com.bossplanner.app.data

data class PartyMember(
    val uid: String,
    val displayName: String,
    val characterName: String,
    val job: String,
    val level: Int,
    val characterId: String,
)

/** 파티가 잡는 보스 하나. 여러 보스를 묶어 한 번에 갈 수 있다. */
data class PartyBoss(val name: String, val difficulty: String)

data class Party(
    val id: String,
    val name: String,
    val bosses: List<PartyBoss>,
    val cycle: String,
    val durationMinutes: Int,
    val leaderUid: String,
    val memberUids: List<String>,
    val members: Map<String, PartyMember>,
    val inviteCode: String,
    val scheduleStarted: Boolean,
) {
    val isWeekly: Boolean get() = cycle == "WEEKLY"
    val bossLabel: String get() = Bosses.label(bosses)
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

/** memberUids: 확정 당시 파티원 = 이 레이드에 참여한 사람 */
data class Confirmed(val startMs: Long, val endMs: Long, val memberUids: List<String>)

data class ChangeRequest(val requestedBy: String, val reason: String, val status: String) {
    val isPending: Boolean get() = status == "PENDING"
}

/**
 * 등록된 분배금.
 * saleAmount·feePercent·netAmount는 경매장 판매액으로 등록했을 때만 있다.
 * amountPerPerson은 받는 사람 모두 같은 금액일 때만 있다.
 */
data class Settlement(
    val sellerUid: String,
    val saleAmount: Long?,
    val feePercent: Int?,
    val netAmount: Long?,
    val amountPerPerson: Long?,
    val completed: Boolean,
)

/** 받을 사람 한 명의 분배금 상태: PENDING(대기) → PAID(지급함) → RECEIVED(수령 확인) */
data class SettlementEntry(val uid: String, val amount: Long, val status: String)

data class ChatMessage(
    val id: String,
    val senderUid: String,
    val text: String,
    val createdAtMs: Long,
    /** 첨부한 이미지 주소. 없으면 null */
    val imageUrl: String?,
)

/** 내 확정 일정 한 건 (여러 파티에 걸친 주간 시간표용) */
data class Raid(
    val partyId: String,
    val partyName: String,
    val bosses: List<PartyBoss>,
    val startMs: Long,
    val endMs: Long,
)

data class Unavailable(val slots: List<String>, val submitted: Boolean)

data class Vote(val agreed: List<Int>, val round: Int)

/** 파티로 갈 수 있는 보스. 목록은 서버(getBossCatalog)에서 받는다. */
data class BossCatalogEntry(val name: String, val difficulties: List<String>, val monthly: Boolean)

data class BossCatalog(val bosses: List<BossCatalogEntry>, val minutesPerBoss: Int, val maxDurationMinutes: Int)

object Bosses {
    private val labels = mapOf(
        "EASY" to "이지",
        "NORMAL" to "노멀",
        "HARD" to "하드",
        "CHAOS" to "카오스",
        "EXTREME" to "익스트림",
    )

    fun difficultyLabel(code: String): String = labels[code] ?: code

    /** "하드 발드릭스, 하드 벨로나" */
    fun label(bosses: List<PartyBoss>): String =
        bosses.joinToString(", ") { "${difficultyLabel(it.difficulty)} ${it.name}" }
}
