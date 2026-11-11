package com.bossplanner.app.data

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** 시간 칸은 30분 단위이고 ID는 KST 기준 "yyyyMMdd-HHmm"이다. 서버와 같은 규칙. */
object TimeSlots {
    const val SLOT_MS = 30 * 60 * 1000L
    const val SLOTS_PER_DAY = 48
    private val KST: ZoneId = ZoneId.of("Asia/Seoul")
    private val idFormat = DateTimeFormatter.ofPattern("yyyyMMdd-HHmm")
    private val dayFormat = DateTimeFormatter.ofPattern("M/d", Locale.KOREAN)
    private val weekdayFormat = DateTimeFormatter.ofPattern("E", Locale.KOREAN)
    private val dateTimeFormat = DateTimeFormatter.ofPattern("M/d(E) HH:mm", Locale.KOREAN)
    private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")

    private fun at(ms: Long): ZonedDateTime = Instant.ofEpochMilli(ms).atZone(KST)

    fun slotId(ms: Long): String = at(ms).format(idFormat)
    fun dayLabel(ms: Long): String = at(ms).format(dayFormat)
    fun weekdayLabel(ms: Long): String = at(ms).format(weekdayFormat)
    fun dateTime(ms: Long): String = at(ms).format(dateTimeFormat)
    fun time(ms: Long): String = at(ms).format(timeFormat)

    /** "11/14(토) 20:00 ~ 21:00" */
    fun range(startMs: Long, endMs: Long): String = "${dateTime(startMs)} ~ ${time(endMs)}"

    /** ms가 속한 KST 날짜의 00:00. 변경 요청 마감(전날 23:59) 계산에 쓴다. */
    fun startOfDay(ms: Long): Long = at(ms).toLocalDate().atStartOfDay(KST).toInstant().toEpochMilli()

    /** 하루 안에서 n번째 칸의 시작 시각 "HH:mm" */
    fun rowLabel(row: Int): String = "%02d:%02d".format(row / 2, (row % 2) * 30)
}
