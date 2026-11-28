package com.bossplanner.app.data

data class PartyMember(
    val uid: String,
    val displayName: String,
    val characterName: String,
    val job: String,
    val level: Int,
    val characterId: String,
    /** 이 파티에 가입한 시각. 모르면 0 */
    val joinedAtMs: Long,
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
    /** 추천할 때 우선하는 시간대. 없으면 null */
    val preferredWindow: PreferredWindow?,
    /** 지금으로부터 이 시간(분) 안에 시작하는 후보는 추천하지 않는다 */
    val minLeadMinutes: Int,
    /** 투표 없이 점수 1위 시간으로 자동 지정 */
    val autoAssign: Boolean = false,
) {
    val isWeekly: Boolean get() = cycle == "WEEKLY"
    val bossLabel: String get() = Bosses.label(bosses)
}

/** 파티 선호 시간대: 요일(1=월 ~ 7=일)과 하루 안의 30분 칸 범위 [startRow, endRow) */
data class PreferredWindow(val days: List<Int>, val startRow: Int, val endRow: Int)

/** 추천 후보. score·reasons는 추천 점수와 이유 코드 (예전 후보에는 없다) */
data class Candidate(
    val slotId: String,
    val startMs: Long,
    val endMs: Long,
    val score: Int? = null,
    val reasons: List<String> = emptyList(),
)

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
    /** 이번 주기 용병 (대체 용병 + 파티장이 추가한 임시 용병) */
    val mercenaries: List<Mercenary> = emptyList(),
    /** 후보를 고른 방식: VOTE(투표) 또는 AUTO(투표 없이 자동 지정, 후보는 점수순) */
    val assignMode: String = "VOTE",
    /** 누가 확정했는가: LEADER 또는 AUTO. 확정 전이면 null */
    val confirmedBy: String? = null,
    /** 투표 없이 자동 지정: 같은 파티원이 있는, 우선순위가 더 높은 다른 자동 지정 파티를 기다리며 확정을 미룬 시각. 아니면 null */
    val autoDeferredAtMs: Long? = null,
) {
    /** 투표 없이 자동 지정하는 일정 (후보가 점수순 순위다) */
    val isAutoAssigned: Boolean get() = assignMode == "AUTO"

    /** 이번 주기를 용병으로 대체한 파티원 */
    val replacedUids: Set<String> get() = mercenaries.mapNotNull { it.replaces }.toSet()

    fun isReplaced(uid: String): Boolean = uid in replacedUids

    /** 그 파티원의 대체 용병 */
    fun replacementOf(uid: String): Mercenary? = mercenaries.firstOrNull { it.replaces == uid }

    /** 파티장이 추가한 임시 용병 수 (레이드 인원 = 파티원 수 + 이 값) */
    val extraMercenaryCount: Int get() = mercenaries.count { it.replaces == null }

    /** 용병을 대체·추가·빼기 할 수 있는 때: 확정 전, 또는 확정 후 레이드 시작 전 (서버 domain/mercenary.ts와 같음) */
    fun canEditMercenaries(nowMs: Long): Boolean = acceptsInput || (state == "LOCKED" && confirmed != null && nowMs < confirmed.startMs)

    /** 대체 취소는 확정 전에만 된다 */
    val canCancelReplacement: Boolean get() = acceptsInput

    /** 클리어했지만 분배금 정산이 끝나지 않았다 */
    val settlementOpen: Boolean get() = state == "SETTLED" && settlement?.completed != true

    /** 불가 시간 입력·투표·확정을 받는 상태 (처음 조율 또는 미클리어 후 재조정) */
    val acceptsInput: Boolean get() = state == "OPEN" || state == "RETRY"

    /** 이번 주 레이드가 끝나 미리 연 다음 주 일정인가 (주기가 아직 시작하지 않음). 확정은 주기가 시작한 뒤에만 된다. */
    fun isUpcoming(nowMs: Long): Boolean = periodStartMs > nowMs
}

/**
 * 이번 주기 용병. replaces가 있으면 그 파티원을 대체한 용병, null이면 파티장이 추가한 임시 용병.
 * 계정·스케줄러가 없는 더미라 시간 제약이 없고, 정산에서는 1인분을 받는다(판매자가 직접 지급).
 */
data class Mercenary(val id: String, val name: String, val replaces: String?)

/** 파티 정원: 파티원 + 그 주기에 파티장이 추가한 임시 용병 */
const val MAX_PARTY_SIZE = 6

/** 정산 문서 ID가 용병인가 */
fun isMercenaryId(id: String): Boolean = id.startsWith("merc_")

/** 그 주기에 참여하는 파티원 (용병으로 대체한 사람 제외). 일정이 없으면 파티원 전원 */
fun Party.participantUids(schedule: Schedule?): List<String> =
    if (schedule == null) memberUids else memberUids.filter { it !in schedule.replacedUids }

/** 용병 표시 이름: "용병 2", "용병 (비숍 대신)" */
fun Party.mercenaryLabel(merc: Mercenary): String {
    val replaced = merc.replaces?.let { members[it] } ?: return merc.name
    return "${merc.name} (${replaced.displayName.ifBlank { replaced.characterName }} 대신)"
}

/** 지금 진행 중인 주기의 일정 (미리 연 다음 주 일정이 맨 앞에 있어도 이번 주 것을 찾는다) */
fun List<Schedule>.currentPeriod(nowMs: Long): Schedule? = firstOrNull { it.periodStartMs <= nowMs && nowMs < it.periodEndMs }

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

/** @param carried 다른 파티에 낸 같은 주기 불가 시간을 서버가 자동으로 넣어 둔 것 (본인이 고쳐 내면 false) */
data class Unavailable(val slots: List<String>, val submitted: Boolean, val carried: Boolean = false)

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
