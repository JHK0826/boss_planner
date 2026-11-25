package com.bossplanner.app.data

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * 시간표 탭의 가로 타임라인 배치 (웹 src/lib/timeline.ts와 같은 규칙).
 * 요일(목~수)이 줄, 가로축이 시각이다. 레이드가 없는 시간은 접어 한 화면에 들어오게 한다.
 */
object Timeline {
    /** 접은 빈 시간(빗금 한 칸)이 차지하는 폭 */
    const val BREAK = 0.05
    /** 파티 색 개수 */
    const val PARTY_COLORS = 6
    private const val FOLD_HOURS = 2.0
    private const val MIN_HOURS = 6.0
    private const val HOUR_MS = 2 * TimeSlots.SLOT_MS
    private const val DAY_MS = TimeSlots.SLOTS_PER_DAY * TimeSlots.SLOT_MS
    private const val KST_OFFSET_MS = 9 * 60 * 60 * 1000L

    /** 축의 한 구간 [fromHour, toHour). 날 시작부터의 시(24 넘으면 다음 날 새벽) */
    data class Segment(val fromHour: Double, val toHour: Double)

    /** [left]·[width]는 축 대비 비율(0~1) */
    data class Bar(val raid: Raid, val row: Int, val left: Double, val width: Double, val colorIndex: Int, val past: Boolean)

    data class Span(val row: Int, val left: Double, val width: Double)

    data class Tick(val left: Double, val label: String)

    data class Now(val row: Int, val left: Double)

    data class LegendParty(val partyId: String, val partyName: String, val colorIndex: Int)

    data class Layout(
        /** 줄마다 그날 00:00 */
        val dayStarts: List<Long>,
        val segments: List<Segment>,
        /** 접은 빈 시간 (모든 줄에 같은 자리): left, width */
        val breaks: List<Pair<Double, Double>>,
        val ticks: List<Tick>,
        /** 구간 안의 정각 세로선 */
        val gridLines: List<Double>,
        val bars: List<Bar>,
        val routine: List<Span>,
        /** 지금 시각. 이 주가 아니거나 축 밖이면 null */
        val now: Now?,
        /** 이 주에 나온 파티 (색 순서) */
        val parties: List<LegendParty>,
    )

    /** 파티 ID → 색 번호. 받은 레이드 전체로 정해, 이번 주와 다음 주에서 같은 파티는 같은 색이다. */
    fun partyColors(raids: List<Raid>): Map<String, Int> =
        raids.map { it.partyId }.distinct().sorted().withIndex().associate { (index, id) -> id to index % PARTY_COLORS }

    /** 레이드가 있는 시각(앞뒤 1시간 여유)을 합친 축 구간. 2시간 넘게 빈 곳은 나눈다. */
    fun segments(hours: List<Pair<Double, Double>>): List<Segment> {
        if (hours.isEmpty()) return listOf(Segment(18.0, 24.0))
        val spans = hours.map { (start, end) ->
            // 자정 전에 끝나면 24에서 자르고, 자정을 넘으면 그 끝까지 둔다.
            Segment(max(0.0, floor(start) - 1), min(ceil(end) + 1, max(24.0, ceil(end))))
        }.sortedBy { it.fromHour }
        val merged = mutableListOf<Segment>()
        for (span in spans) {
            val last = merged.lastOrNull()
            if (last != null && span.fromHour - last.toHour < FOLD_HOURS) {
                merged[merged.lastIndex] = last.copy(toHour = max(last.toHour, span.toHour))
            } else {
                merged += span
            }
        }
        // 너무 좁으면 마지막 구간을 뒤로(24까지), 그래도 모자라면 첫 구간을 앞으로 늘린다.
        var missing = MIN_HOURS - merged.sumOf { it.toHour - it.fromHour }
        if (missing > 0) {
            val last = merged.last()
            val grow = min(missing, max(0.0, max(24.0, last.toHour) - last.toHour))
            merged[merged.lastIndex] = last.copy(toHour = last.toHour + grow)
            missing -= grow
        }
        if (missing > 0) {
            val first = merged.first()
            val grow = min(missing, first.fromHour)
            merged[0] = first.copy(fromHour = first.fromHour - grow)
            missing -= grow
        }
        if (missing > 0) merged[merged.lastIndex] = merged.last().let { it.copy(toHour = it.toHour + missing) }
        return merged
    }

    /** 구간 목록으로 시 → 가로 위치(0~1). 접은 곳 안의 시각은 앞 구간 끝으로 붙인다. */
    fun x(segments: List<Segment>): (Double) -> Double {
        val total = segments.sumOf { it.toHour - it.fromHour }
        val unit = (1 - BREAK * (segments.size - 1)) / total
        return { hour ->
            var offset = 0.0
            var result = 0.0
            for ((i, segment) in segments.withIndex()) {
                if (hour <= segment.toHour || i == segments.lastIndex) {
                    result = offset + (hour.coerceIn(segment.fromHour, segment.toHour) - segment.fromHour) * unit
                    break
                }
                offset += (segment.toHour - segment.fromHour) * unit + BREAK
            }
            result
        }
    }

    private fun label(hour: Double) = "%02d".format(hour.toInt() % 24)

    /** KST 그날 안의 30분 칸 번호 (0~47) */
    private fun rowOf(ms: Long): Int = (Math.floorMod(ms + KST_OFFSET_MS, DAY_MS) / TimeSlots.SLOT_MS).toInt()

    /**
     * @param raids 받아 온 확정 일정 전체 (색을 정하는 데 쓴다)
     * @param weekStartMs 보고 있는 주의 목요일 00:00
     * @param routine 고정 불가 시간 키 (`RoutineRepository.key`)
     */
    fun layout(raids: List<Raid>, weekStartMs: Long, routine: Set<String>, nowMs: Long): Layout {
        val dayStarts = List(7) { weekStartMs + it * DAY_MS }
        val colors = partyColors(raids)
        val weekEnd = weekStartMs + 7 * DAY_MS
        // 시작한 날 줄에 그린다. 자정을 넘는 레이드는 그날 줄에서 24시를 넘긴다.
        val inWeek = raids.filter { it.startMs in weekStartMs until weekEnd }.map { raid ->
            val row = ((raid.startMs - weekStartMs) / DAY_MS).toInt()
            val start = (raid.startMs - dayStarts[row]).toDouble() / HOUR_MS
            Triple(raid, row, start to start + (raid.endMs - raid.startMs).toDouble() / HOUR_MS)
        }

        val segments = segments(inWeek.map { it.third })
        val x = x(segments)
        val step = if (segments.sumOf { it.toHour - it.fromHour } <= 8) 1.0 else 2.0

        val ticks = mutableListOf<Tick>()
        val gridLines = mutableListOf<Double>()
        segments.forEachIndexed { i, segment ->
            // 접은 곳 바로 앞 눈금은 뒤 구간 첫 눈금과 겹치므로 뺀다.
            val lastTick = if (i < segments.lastIndex) segment.toHour - 1 else segment.toHour
            var h = segment.fromHour
            while (h <= lastTick) {
                ticks += Tick(x(h), label(h))
                h += step
            }
            var line = segment.fromHour + 1
            while (line < segment.toHour) {
                gridLines += x(line)
                line += 1
            }
        }
        val breaks = segments.dropLast(1).map { x(it.toHour) to BREAK }

        val bars = inWeek.map { (raid, row, hours) ->
            Bar(raid, row, x(hours.first), x(hours.second) - x(hours.first), colors[raid.partyId] ?: 0, raid.endMs <= nowMs)
        }

        // 고정 불가 시간: 축 위 30분 칸마다 실제 시각의 요일·행으로 본다 (24시 이후는 다음 요일).
        val routineSpans = mutableListOf<Span>()
        dayStarts.forEachIndexed { row, dayStart ->
            for (segment in segments) {
                var from: Double? = null
                var h = segment.fromHour
                while (h <= segment.toHour) {
                    val at = dayStart + (h * HOUR_MS).toLong()
                    val on = h < segment.toHour && RoutineRepository.key(TimeSlots.weekday(at), rowOf(at)) in routine
                    if (on && from == null) from = h
                    if (!on && from != null) {
                        routineSpans += Span(row, x(from), x(h) - x(from))
                        from = null
                    }
                    h += 0.5
                }
            }
        }

        val now = if (nowMs in weekStartMs until weekEnd) {
            val row = ((nowMs - weekStartMs) / DAY_MS).toInt()
            val hour = (nowMs - dayStarts[row]).toDouble() / HOUR_MS
            if (segments.any { hour >= it.fromHour && hour <= it.toHour }) Now(row, x(hour)) else null
        } else {
            null
        }

        // 색을 정한 순서(파티 ID 순)
        val parties = inWeek.map { it.first }.distinctBy { it.partyId }.sortedBy { it.partyId }
            .map { LegendParty(it.partyId, it.partyName, colors[it.partyId] ?: 0) }

        return Layout(dayStarts, segments, breaks, ticks, gridLines, bars, routineSpans, now, parties)
    }
}
