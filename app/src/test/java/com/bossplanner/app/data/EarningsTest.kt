package com.bossplanner.app.data

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZonedDateTime

class EarningsTest {
    private fun kst(iso: String) = ZonedDateTime.parse("$iso+09:00[Asia/Seoul]").toInstant().toEpochMilli()

    private fun boss(name: String, cycle: String, cleared: Boolean, share: Long, partySize: Int = 1) =
        SchedulerBoss(name, "HARD", cycle, cleared, partySize, share * partySize, share)

    private val bosses = listOf(
        boss("림보", "WEEKLY", true, 300, 3),
        boss("스우", "WEEKLY", false, 100),
        boss("검은 마법사", "MONTHLY", false, 1000),
    )

    private fun record(id: String, crystal: Long, settlements: List<SettlementEarning> = emptyList()) =
        EarningsRecord(id, mapOf("c1" to crystal), settlements)

    @Test
    fun expectedIncludesWeeklyAndUnclearedMonthly() {
        assertEquals(1400L, Earnings.expectedThisWeek(bosses))
        assertEquals(400L, Earnings.expectedThisWeek(bosses.take(2) + boss("검은 마법사", "MONTHLY", true, 1000)))
    }

    @Test
    fun thisWeekCountsClearedWeeklyAndMySettlements() {
        val records = listOf(
            record(
                "W-20261119",
                300,
                listOf(
                    SettlementEarning("p1", "c1", "스우팟", 50, kst("2026-11-21T21:00:00")),
                    SettlementEarning("p2", "c2", "다른캐릭", 999, 0),
                ),
            ),
        )
        val week = Earnings.earnedThisWeek(bosses, records, "c1", kst("2026-11-24T12:00:00"))
        assertEquals(300L, week.crystal)
        assertEquals(50L, week.settlement)
        assertEquals(350L, week.total)
    }

    @Test
    fun monthlyGroupsWeeksByThursdayMonth() {
        val records = listOf(
            record("W-20261126", 300),
            record("W-20261119", 200, listOf(SettlementEarning("k", "c1", "", 50, 0))),
            record("M-202611", 1000),
            record("W-20261029", 70),
        )
        val months = Earnings.monthly(records, "c1", kst("2026-12-02T12:00:00"), 3)
        assertEquals(listOf("M-202612", "M-202611", "M-202610"), months.map { it.monthId })
        assertEquals(listOf(0L, 1550L, 70L), months.map { it.total })
        assertEquals(listOf(false, true, true), months.map { it.recorded })
        assertEquals("2026년 11월", months[1].label)
    }

    @Test
    fun periodIds() {
        assertEquals("W-20261119", Earnings.weekId(kst("2026-11-25T23:59:00")))
        assertEquals("W-20261126", Earnings.weekId(kst("2026-11-26T00:00:00")))
        assertEquals("M-202611", Earnings.monthId(kst("2026-11-30T12:00:00")))
    }
}
