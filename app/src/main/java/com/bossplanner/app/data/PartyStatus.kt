package com.bossplanner.app.data

/** 파티 목록에서 파티 하나의 상태를 정할 때 쓰는 일정 데이터 */
data class PartySnapshot(
    /** 최근 일정들 (최신순). 첫 번째가 가장 최근 주기다 */
    val schedules: List<Schedule>,
    /** 가장 최근 일정의 불가 시간 (uid → 입력). 입력을 받는 중일 때만 채운다 */
    val unavailable: Map<String, Unavailable>,
    /** 가장 최근 일정의 투표 (uid → 투표). 후보가 있을 때만 채운다 */
    val votes: Map<String, Vote>,
    /** 정산이 끝나지 않은 일정별 분배금 상태 (periodId → 받을 사람별 상태) */
    val settlements: Map<String, List<SettlementEntry>>,
)

/**
 * 파티 목록에 붙이는 상태.
 * @param needsAction 내가 해야 할 일이면 true, 다른 사람을 기다리거나 알림용이면 false
 * @param moreActions label 말고도 해야 할 일이 몇 건 더 있는가
 * @param todos 해야 할 일 전부 (급한 순). 파티 화면의 탭 배지에 쓴다
 */
data class PartyStatus(
    val label: String,
    val needsAction: Boolean,
    val moreActions: Int = 0,
    val todos: List<String> = emptyList(),
) {
    val text: String get() = if (moreActions > 0) "$label 외 ${moreActions}건" else label
}

/** 파티 화면 하단 탭별로 내가 할 일이 있는가 */
data class TabTodos(val schedule: Boolean, val settlement: Boolean) {
    companion object {
        /** 정산 탭에서 하는 일. 나머지 할 일(불가 시간 입력, 투표, 일정 확정, 결과 기록, 변경 요청 처리)은 투표 탭에서 한다. */
        val SETTLEMENT_TODOS = setOf("정산금 수령 확인", "정산금 지급")

        fun of(status: PartyStatus?): TabTodos {
            val todos = status?.todos.orEmpty()
            return TabTodos(
                schedule = todos.any { it !in SETTLEMENT_TODOS },
                settlement = todos.any { it in SETTLEMENT_TODOS },
            )
        }
    }
}

object PartyStatuses {
    /**
     * 내가 이 파티에서 지금 해야 할 일. 해야 할 일이 없으면 지금 상황을 알려 주는 문구를 준다.
     * 해야 할 일이 여러 개면 급한 것(결과 기록 → 변경 요청 처리 → 입력 → 투표 → 확정 → 정산) 하나를 보여 준다.
     *
     * @return 일정 데이터를 아직 못 읽었으면 null
     */
    fun of(uid: String, party: Party, snapshot: PartySnapshot?, nowMs: Long): PartyStatus? {
        if (snapshot == null) return null
        val isLeader = party.leaderUid == uid
        val todos = mutableListOf<String>()
        var info = ""

        // 끝난 주기의 일정은 "이번 주기"로 보지 않는다.
        val current = snapshot.schedules.firstOrNull()?.takeIf { it.periodEndMs > nowMs }
        // 그 주기 참여 파티원 (용병으로 대체한 사람 제외). 대체한 본인은 입력·투표·결과 기록을 하지 않는다.
        val participants = party.participantUids(current)
        val members = participants.size
        val replaced = current?.isReplaced(uid) == true
        if (current == null) {
            info = if (party.scheduleStarted) "다음 주기 대기" else "일정 시작 전"
        } else {
            when (current.state) {
                "OPEN", "RETRY" -> {
                    // 이번 주 레이드가 끝나 미리 연 다음 주 일정: 입력·투표는 할 일, 확정은 목요일부터
                    val upcoming = current.isUpcoming(nowMs)
                    val prefix = if (upcoming) "다음 주 " else ""
                    val submitted = participants.count { snapshot.unavailable[it]?.submitted == true }
                    val voted = participants.count { snapshot.votes[it]?.round == current.round }
                    when {
                        replaced && current.unanimous.isNotEmpty() && isLeader && !upcoming -> todos += "일정 확정"
                        replaced -> info = "${prefix}용병으로 대체"
                        snapshot.unavailable[uid]?.submitted != true -> todos += "${prefix}불가 시간 입력"
                        current.candidates.isEmpty() -> info = "${prefix}다른 파티원 입력 대기 ($submitted/$members)"
                        // 투표 없이 자동 지정: 투표·확정 할 일이 없다. 미리 연 다음 주면 1위 예정 시간을 보여 준다.
                        current.isAutoAssigned ->
                            info = when {
                                upcoming -> "자동 지정 예정 ${TimeSlots.dateTime(current.candidates.first().startMs)}"
                                // 같은 파티원이 있는 다른 자동 지정 파티가 먼저 정하는 중
                                current.autoDeferredAtMs != null -> "자동 지정 대기"
                                else -> "자동 지정 중"
                            }
                        snapshot.votes[uid]?.round != current.round -> todos += "${prefix}투표"
                        current.unanimous.isNotEmpty() && upcoming -> info = "다음 주 전원 동의 · 목요일부터 확정 가능"
                        current.unanimous.isNotEmpty() && isLeader -> todos += "일정 확정"
                        current.unanimous.isNotEmpty() -> info = "파티장 확정 대기"
                        else -> info = "${prefix}다른 파티원 투표 대기 ($voted/$members)"
                    }
                    if (current.state == "RETRY" && info.isNotEmpty()) info = "재조정 · $info"
                }
                "LOCKED" -> {
                    val confirmed = current.confirmed
                    when {
                        replaced -> info = "용병으로 대체"
                        confirmed != null && nowMs >= confirmed.startMs -> todos += "결과 기록"
                        isLeader && current.changeRequest?.isPending == true -> todos += "변경 요청 처리"
                        confirmed != null -> info = "확정 ${TimeSlots.dateTime(confirmed.startMs)}"
                        else -> info = "확정"
                    }
                }
                "VERIFYING" -> if (replaced) info = "용병으로 대체" else todos += "결과 기록"
                "SETTLED" -> {
                    val settlement = current.settlement
                    val mine = snapshot.settlements[current.id]?.firstOrNull { it.uid == uid }
                    info = when {
                        settlement == null -> "클리어 · 분배금 미등록"
                        settlement.completed -> "정산 완료"
                        mine?.status == "PENDING" -> "정산금 지급 대기"
                        else -> "정산 진행 중"
                    }
                }
                "SKIPPED" -> info = "이번 주기 미사용"
                "EXPIRED" -> info = "이번 주기 종료"
                else -> info = ""
            }
        }

        // 정산은 지난 주기 것도 함께 본다.
        val settlementTodos = mutableListOf<String>()
        for (schedule in snapshot.schedules) {
            val entries = snapshot.settlements[schedule.id] ?: continue
            if (schedule.settlement?.completed == true) continue
            if (entries.any { it.uid == uid && it.status == "PAID" }) settlementTodos += "정산금 수령 확인"
            if (schedule.settlement?.sellerUid == uid && entries.any { it.status == "PENDING" }) settlementTodos += "정산금 지급"
        }
        todos += settlementTodos

        return if (todos.isNotEmpty()) {
            PartyStatus(todos.first(), needsAction = true, moreActions = todos.size - 1, todos = todos.toList())
        } else {
            PartyStatus(info, needsAction = false)
        }
    }
}
