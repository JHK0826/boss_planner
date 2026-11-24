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
    ) = Schedule(
        id = id,
        state = state,
        periodStartMs = start,
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

    private fun status(uid: String, snapshot: PartySnapshot?, party: Party = party(), at: Long = now) =
        PartyStatuses.of(uid, party, snapshot, at)

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
}
