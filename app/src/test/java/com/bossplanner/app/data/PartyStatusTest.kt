package com.bossplanner.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PartyStatusTest {
    private val hour = 60 * 60 * 1000L
    private val start = 1_000_000_000_000L
    private val now = start + 24 * hour

    private fun party(leader: String = "a", started: Boolean = true) = Party(
        id = "p1",
        name = "스우팟",
        bosses = listOf(PartyBoss("스우", "HARD")),
        cycle = "WEEKLY",
        durationMinutes = 60,
        leaderUid = leader,
        memberUids = listOf("a", "b"),
        members = emptyMap(),
        inviteCode = "ABC123",
        scheduleStarted = started,
        preferredWindow = null,
        minLeadMinutes = 180,
    )

    private fun schedule(
        state: String = "OPEN",
        id: String = "W-1",
        round: Int = 1,
        candidates: Int = 0,
        unanimous: List<Int> = emptyList(),
        confirmedAt: Long? = null,
        changeRequest: ChangeRequest? = null,
        settlement: Settlement? = null,
        periodEnd: Long = start + 7 * 24 * hour,
        periodStart: Long = start,
        mercenaries: List<Mercenary> = emptyList(),
    ) = Schedule(
        id = id,
        state = state,
        periodStartMs = periodStart,
        periodEndMs = periodEnd,
        inputDeadlineMs = start + 24 * hour,
        durationSlots = 2,
        round = round,
        candidates = List(candidates) { Candidate("s$it", start + it * hour, start + (it + 1) * hour) },
        unanimous = unanimous,
        skippedReason = null,
        confirmed = confirmedAt?.let { Confirmed(it, it + hour, listOf("a", "b")) },
        changeRequest = changeRequest,
        retryCount = 0,
        expiredReason = null,
        settlement = settlement,
        mercenaries = mercenaries,
    )

    private fun snapshot(
        vararg schedules: Schedule,
        submitted: Set<String> = emptySet(),
        votedRound: Map<String, Int> = emptyMap(),
        settlements: Map<String, List<SettlementEntry>> = emptyMap(),
    ) = PartySnapshot(
        schedules = schedules.toList(),
        unavailable = submitted.associateWith { Unavailable(emptyList(), true) },
        votes = votedRound.mapValues { Vote(listOf(0), it.value) },
        settlements = settlements,
    )

    private fun fullStatus(uid: String, snapshot: PartySnapshot?, party: Party = party(), at: Long = now) =
        PartyStatuses.of(uid, party, snapshot, at)

    /** 표시 문구만 비교한다 (할 일 목록은 tabTodos 테스트에서 본다). */
    private fun status(uid: String, snapshot: PartySnapshot?, party: Party = party(), at: Long = now) =
        fullStatus(uid, snapshot, party, at)?.copy(todos = emptyList())

    @Test
    fun `아직 못 읽었으면 null`() {
        assertNull(status("a", null))
    }

    @Test
    fun `일정이 없으면 시작 전 또는 다음 주기 대기`() {
        assertEquals(PartyStatus("일정 시작 전", false), status("a", snapshot(), party(started = false)))
        assertEquals(PartyStatus("다음 주기 대기", false), status("a", snapshot()))
        // 지난 주기 일정만 있으면 이번 주기 일정이 없는 것으로 본다.
        val ended = schedule(state = "SKIPPED", periodEnd = now - hour)
        assertEquals(PartyStatus("다음 주기 대기", false), status("a", snapshot(ended)))
    }

    @Test
    fun `입력과 투표 단계`() {
        val open = schedule()
        assertEquals(PartyStatus("불가 시간 입력", true), status("a", snapshot(open)))
        assertEquals(
            PartyStatus("다른 파티원 입력 대기 (1/2)", false),
            status("a", snapshot(open, submitted = setOf("a"))),
        )

        val voting = schedule(candidates = 3, round = 2)
        val both = setOf("a", "b")
        assertEquals(PartyStatus("투표", true), status("a", snapshot(voting, submitted = both)))
        // 지난 라운드 투표는 하지 않은 것으로 본다.
        assertEquals(PartyStatus("투표", true), status("a", snapshot(voting, submitted = both, votedRound = mapOf("a" to 1))))
        assertEquals(
            PartyStatus("다른 파티원 투표 대기 (1/2)", false),
            status("a", snapshot(voting, submitted = both, votedRound = mapOf("a" to 2))),
        )
    }

    @Test
    fun `전원 동의 후보가 있으면 파티장만 확정할 일이 생긴다`() {
        val agreed = schedule(candidates = 3, unanimous = listOf(1))
        val snap = snapshot(agreed, submitted = setOf("a", "b"), votedRound = mapOf("a" to 1, "b" to 1))
        assertEquals(PartyStatus("일정 확정", true), status("a", snap))
        assertEquals(PartyStatus("파티장 확정 대기", false), status("b", snap))
    }

    @Test
    fun `재조정 중이면 앞에 표시한다`() {
        val retry = schedule(state = "RETRY")
        assertEquals(PartyStatus("재조정 · 다른 파티원 입력 대기 (1/2)", false), status("a", snapshot(retry, submitted = setOf("a"))))
    }

    @Test
    fun `용병으로 대체한 사람은 입력·투표·결과 기록을 하지 않고, 나머지만 센다`() {
        val replacedB = listOf(Mercenary("merc_1", "용병", "b"))
        assertEquals(PartyStatus("용병으로 대체", false), status("b", snapshot(schedule(mercenaries = replacedB))))
        assertEquals(
            PartyStatus("다른 파티원 투표 대기 (1/1)", false),
            status("a", snapshot(schedule(mercenaries = replacedB, candidates = 2), submitted = setOf("a"), votedRound = mapOf("a" to 1))),
        )
        val raid = now + 2 * hour
        assertEquals(PartyStatus("용병으로 대체", false), status("b", snapshot(schedule(state = "LOCKED", confirmedAt = raid, mercenaries = replacedB)), at = raid))
        // 파티장이 대체했어도 확정은 파티장의 할 일
        val replacedA = listOf(Mercenary("merc_2", "용병", "a"))
        val snap = snapshot(schedule(mercenaries = replacedA, candidates = 2, unanimous = listOf(0)), submitted = setOf("b"), votedRound = mapOf("b" to 1))
        assertEquals(PartyStatus("일정 확정", true), status("a", snap))
    }

    @Test
    fun `투표 없이 자동 지정하는 일정은 투표·확정 할 일이 없고, 미리 연 다음 주면 1위 예정 시간을 보여 준다`() {
        val plannedStart = now + 3 * 24 * hour
        val upcoming = schedule(periodStart = now + 24 * hour, periodEnd = now + 8 * 24 * hour, round = 2)
            .copy(assignMode = "AUTO", candidates = listOf(Candidate("x", plannedStart, plannedStart + hour, 5, emptyList())))
        assertEquals(
            PartyStatus("자동 지정 예정 ${TimeSlots.dateTime(plannedStart)}", false),
            status("a", snapshot(upcoming, submitted = setOf("a", "b"))),
        )
        assertEquals(PartyStatus("다음 주 불가 시간 입력", true), status("b", snapshot(upcoming, submitted = setOf("a"))))
    }

    @Test
    fun `같은 파티원이 있는 다른 자동 지정 파티를 기다리면 자동 지정 대기로 보여 준다`() {
        val start = now + 3 * 24 * hour
        val auto = schedule(round = 2).copy(assignMode = "AUTO", candidates = listOf(Candidate("x", start, start + hour, 5, emptyList())))
        val both = setOf("a", "b")
        assertEquals(PartyStatus("자동 지정 중", false), status("a", snapshot(auto, submitted = both)))
        assertEquals(PartyStatus("자동 지정 대기", false), status("a", snapshot(auto.copy(autoDeferredAtMs = now), submitted = both)))
    }

    @Test
    fun `확정 뒤에는 레이드가 시작되면 결과 기록`() {
        val raid = now + 2 * hour
        val locked = schedule(state = "LOCKED", confirmedAt = raid)
        assertEquals(PartyStatus("확정 ${TimeSlots.dateTime(raid)}", false), status("b", snapshot(locked)))
        assertEquals(PartyStatus("결과 기록", true), status("b", snapshot(locked), at = raid))
        assertEquals(PartyStatus("결과 기록", true), status("b", snapshot(schedule(state = "VERIFYING", confirmedAt = raid))))
    }

    @Test
    fun `변경 요청은 파티장의 할 일`() {
        val locked = schedule(state = "LOCKED", confirmedAt = now + 48 * hour, changeRequest = ChangeRequest("b", "", "PENDING"))
        assertEquals(PartyStatus("변경 요청 처리", true), status("a", snapshot(locked)))
        assertEquals(false, status("b", snapshot(locked))!!.needsAction)
    }

    @Test
    fun `정산 단계`() {
        val settlement = Settlement("a", 100_000_000, 3, 97_000_000, 49_238_500, completed = false)
        val settled = schedule(state = "SETTLED", settlement = settlement)
        val pending = mapOf(settled.id to listOf(SettlementEntry("b", 49_238_500, "PENDING")))
        val paid = mapOf(settled.id to listOf(SettlementEntry("b", 49_238_500, "PAID")))

        // 판매자는 지급할 일이, 받는 사람은 기다리기
        assertEquals(PartyStatus("정산금 지급", true), status("a", snapshot(settled, settlements = pending)))
        assertEquals(PartyStatus("정산금 지급 대기", false), status("b", snapshot(settled, settlements = pending)))
        // 지급함 뒤에는 받는 사람이 수령 확인
        assertEquals(PartyStatus("정산금 수령 확인", true), status("b", snapshot(settled, settlements = paid)))
        assertEquals(PartyStatus("정산 진행 중", false), status("a", snapshot(settled, settlements = paid)))

        assertEquals(PartyStatus("클리어 · 분배금 미등록", false), status("a", snapshot(schedule(state = "SETTLED"))))
        val done = schedule(state = "SETTLED", settlement = settlement.copy(completed = true))
        assertEquals(PartyStatus("정산 완료", false), status("a", snapshot(done)))
    }

    @Test
    fun `지난 주기 정산도 할 일로 센다`() {
        val settlement = Settlement("a", 100_000_000, 3, 97_000_000, 49_238_500, completed = false)
        val past = schedule(state = "SETTLED", id = "W-0", settlement = settlement)
        val open = schedule(id = "W-1")
        val snap = snapshot(open, past, settlements = mapOf("W-0" to listOf(SettlementEntry("b", 1, "PENDING"))))
        // 이번 주기 입력 + 지난 주기 지급
        val result = status("a", snap)!!
        assertEquals("불가 시간 입력", result.label)
        assertEquals(1, result.moreActions)
        assertEquals("불가 시간 입력 외 1건", result.text)
    }

    @Test
    fun `할 일을 파티 화면의 투표 탭과 정산 탭으로 나눈다`() {
        val settlement = Settlement("a", 100_000_000, 3, 97_000_000, 49_238_500, completed = false)
        val past = schedule(state = "SETTLED", id = "W-0", settlement = settlement)
        val pending = mapOf("W-0" to listOf(SettlementEntry("b", 1, "PENDING")))
        val both = fullStatus("a", snapshot(schedule(id = "W-1"), past, settlements = pending))
        assertEquals(listOf("불가 시간 입력", "정산금 지급"), both?.todos)
        assertEquals(TabTodos(schedule = true, settlement = true), TabTodos.of(both))

        assertEquals(TabTodos(schedule = true, settlement = false), TabTodos.of(fullStatus("a", snapshot(schedule()))))
        val settled = schedule(state = "SETTLED", settlement = settlement)
        val paid = mapOf(settled.id to listOf(SettlementEntry("b", 1, "PAID")))
        assertEquals(TabTodos(schedule = false, settlement = true), TabTodos.of(fullStatus("b", snapshot(settled, settlements = paid))))
        assertEquals(TabTodos(schedule = false, settlement = false), TabTodos.of(fullStatus("a", snapshot())))
        assertEquals(TabTodos(schedule = false, settlement = false), TabTodos.of(null))
    }

    @Test
    fun `미리 연 다음 주 일정은 다음 주 할 일로 보이고 확정은 목요일부터라 안내만 한다`() {
        val upcoming = schedule(periodStart = now + 24 * hour, periodEnd = now + 8 * 24 * hour)
        val settled = schedule(state = "SETTLED", id = "W-0")
        assertEquals(PartyStatus("다음 주 불가 시간 입력", true), status("a", snapshot(upcoming, settled)))
        val voting = upcoming.copy(round = 2, candidates = listOf(Candidate("s0", now + 30 * hour, now + 31 * hour)))
        assertEquals(PartyStatus("다음 주 투표", true), status("a", snapshot(voting, submitted = setOf("a", "b"))))
        val agreed = voting.copy(unanimous = listOf(0))
        assertEquals(
            PartyStatus("다음 주 전원 동의 · 목요일부터 확정 가능", false),
            status("a", snapshot(agreed, submitted = setOf("a", "b"), votedRound = mapOf("a" to 2, "b" to 2))),
        )
        assertEquals(TabTodos(schedule = true, settlement = false), TabTodos.of(fullStatus("a", snapshot(upcoming))))
        assertEquals("W-0", listOf(upcoming, settled).currentPeriod(now)?.id)
    }
}
