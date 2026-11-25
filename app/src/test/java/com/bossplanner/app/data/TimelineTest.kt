package com.bossplanner.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime

/** 웹 test/timeline.test.ts와 같은 경우를 확인한다 */
class TimelineTest {
    private val hour = 3_600_000L
    private val day = 24 * hour

    // 2026-11-26(목) 00:00 KST
    private val week = ZonedDateTime.parse("2026-11-26T00:00+09:00[Asia/Seoul]").toInstant().toEpochMilli()
    private fun at(d: Int, h: Double) = week + d * day + (h * hour).toLong()
    private fun raid(partyId: String, d: Int, h: Double, hours: Double = 1.0) =
        Raid(partyId, "${partyId}팟", listOf(PartyBoss("스우", "HARD")), at(d, h), at(d, h + hours))

    private fun close(actual: Double, expected: Double) = assertEquals(expected, actual, 1e-6)
    private fun seg(from: Int, to: Int) = Timeline.Segment(from.toDouble(), to.toDouble())

    @Test
    fun `레이드가 없으면 18~24시 한 구간이다`() {
        val layout = Timeline.layout(emptyList(), week, emptySet(), week)
        assertEquals(listOf(seg(18, 24)), layout.segments)
        assertEquals(listOf("18", "19", "20", "21", "22", "23", "00"), layout.ticks.map { it.label })
        assertTrue(layout.bars.isEmpty())
    }

    @Test
    fun `레이드 앞뒤로 1시간을 두고 최소 6시간, 막대는 시작한 날 줄의 시각 비율에 놓인다`() {
        val layout = Timeline.layout(listOf(raid("a", 0, 20.0), raid("b", 2, 22.0)), week, emptySet(), week)
        assertEquals(listOf(seg(18, 24)), layout.segments)
        assertEquals(listOf(0, 2), layout.bars.map { it.row })
        close(layout.bars[1].left, 4.0 / 6)
        close(layout.bars[1].width, 1.0 / 6)
        assertEquals(listOf(seg(18, 24)), Timeline.segments(listOf(21.0 to 22.0)))
        assertEquals(listOf(seg(9, 15)), Timeline.segments(listOf(10.0 to 11.0)))
        assertEquals(listOf(seg(17, 23)), Timeline.segments(listOf(18.0 to 19.0, 21.0 to 22.0)))
    }

    @Test
    fun `어느 요일에도 레이드가 없는 2시간 넘는 빈 시간은 빗금 한 칸으로 접는다`() {
        val layout = Timeline.layout(listOf(raid("a", 2, 10.0), raid("b", 2, 20.0), raid("c", 0, 21.0)), week, emptySet(), week)
        assertEquals(listOf(seg(9, 12), seg(19, 23)), layout.segments)
        val unit = (1 - Timeline.BREAK) / 7
        close(layout.breaks.single().first, 3 * unit)
        close(layout.bars.first { it.raid.partyId == "b" }.left, 3 * unit + Timeline.BREAK + unit)
        assertEquals(listOf("09", "10", "11", "19", "20", "21", "22", "23"), layout.ticks.map { it.label })
    }

    @Test
    fun `자정을 넘는 레이드는 시작한 날 줄에 그리고 축이 24시를 넘는다`() {
        val layout = Timeline.layout(listOf(raid("a", 5, 23.5)), week, emptySet(), week)
        assertEquals(5, layout.bars.single().row)
        assertEquals(25.0, layout.segments.last().toHour, 0.0)
        assertEquals("01", layout.ticks.last().label)
    }

    @Test
    fun `다음 주 시작을 주면 다음 주 레이드만 그리고, 같은 파티는 두 주에서 같은 색이다`() {
        val raids = listOf(raid("b", 0, 20.0), raid("a", 7, 20.0), raid("b", 8, 21.0))
        val thisWeek = Timeline.layout(raids, week, emptySet(), week)
        val nextWeek = Timeline.layout(raids, week + 7 * day, emptySet(), week)
        assertEquals(listOf("b"), thisWeek.bars.map { it.raid.partyId })
        assertEquals(listOf(0, 1), nextWeek.bars.map { it.row })
        val color = Timeline.partyColors(raids)["b"]
        assertEquals(color, thisWeek.bars.single().colorIndex)
        assertEquals(color, nextWeek.bars.first { it.raid.partyId == "b" }.colorIndex)
        assertEquals(listOf("a", "b"), nextWeek.parties.map { it.partyId })
        assertNull(nextWeek.now)
    }

    @Test
    fun `고정 불가 시간은 이어진 칸을 한 구간으로 합치고, 24시 이후는 다음 요일로 본다`() {
        // 목(4) 18:00~20:00, 금(5) 00:00~00:30
        val routine = setOf(36, 37, 38, 39).map { RoutineRepository.key(4, it) }.toSet() + RoutineRepository.key(5, 0)
        val layout = Timeline.layout(listOf(raid("a", 0, 23.5)), week, routine, week)
        assertEquals(listOf(seg(19, 25)), layout.segments)
        val thursday = layout.routine.filter { it.row == 0 }
        assertEquals(2, thursday.size)
        close(thursday[0].left, 0.0)
        close(thursday[0].width, 1.0 / 6)
        close(thursday[1].left, 5.0 / 6)
        close(thursday[1].width, 0.5 / 6)
    }

    @Test
    fun `지금 시각은 오늘 줄의 축 위에 놓이고, 축 밖이면 없다`() {
        val raids = listOf(raid("a", 0, 20.0))
        val now = Timeline.layout(raids, week, emptySet(), at(1, 21.0)).now!!
        assertEquals(1, now.row)
        close(now.left, 3.0 / 6)
        assertNull(Timeline.layout(raids, week, emptySet(), at(1, 9.0)).now)
        assertTrue(Timeline.layout(raids, week, emptySet(), at(0, 21.0)).bars.single().past)
    }
}
