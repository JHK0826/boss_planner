package com.bossplanner.app.ui

import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class PeriodColumnsTest {
    private val kst = ZoneId.of("Asia/Seoul")
    private fun midnight(date: String) = LocalDate.parse(date).atStartOfDay(kst).toInstant().toEpochMilli()

    // 주간 주기: 목요일부터 7일, 열마다 30분 칸 48개
    @Test
    fun weeklyPeriodHasSevenDaysFromThursday() {
        val columns = periodColumns(midnight("2026-11-12"), midnight("2026-11-19"))
        assertEquals(7, columns.size)
        assertEquals(listOf(4, 5, 6, 7, 1, 2, 3), columns.map { it.weekday })
        assertEquals("20261112-0000", columns.first().slotIds.first())
        assertEquals("20261118-2330", columns.last().slotIds.last())
        assertEquals(List(7) { 48 }, columns.map { it.slotIds.size })
        assertEquals("목", columns.first().title)
        assertEquals("11/12", columns.first().subtitle)
    }

    // 월간 주기: 그달의 날짜 수만큼
    @Test
    fun monthlyPeriodHasOneColumnPerDay() {
        assertEquals(31, periodColumns(midnight("2026-12-01"), midnight("2027-01-01")).size)
        assertEquals(28, periodColumns(midnight("2027-02-01"), midnight("2027-03-01")).size)
        assertEquals("20270228-0000", periodColumns(midnight("2027-02-01"), midnight("2027-03-01")).last().slotIds.first())
    }
}
