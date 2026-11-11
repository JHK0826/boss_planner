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
)

data class Unavailable(val slots: List<String>, val submitted: Boolean)

data class Vote(val agreed: List<Int>, val round: Int)

/** 보스 목록. 월간 보스만 따로 표시하고 나머지는 주간이다. */
object Bosses {
    val names = listOf(
        "스우", "데미안", "가디언 엔젤 슬라임", "루시드", "윌", "더스크", "진 힐라", "듄켈",
        "선택받은 세렌", "감시자 칼로스", "최초의 대적자", "카링", "림보", "발드릭스", "검은 마법사",
    )
    private val monthly = setOf("검은 마법사")

    fun cycleOf(bossName: String): String = if (bossName in monthly) "MONTHLY" else "WEEKLY"

    val difficulties = listOf(
        "EASY" to "이지",
        "NORMAL" to "노멀",
        "HARD" to "하드",
        "CHAOS" to "카오스",
        "EXTREME" to "익스트림",
    )

    fun difficultyLabel(code: String): String = difficulties.firstOrNull { it.first == code }?.second ?: code
}
