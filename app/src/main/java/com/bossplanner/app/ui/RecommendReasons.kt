package com.bossplanner.app.ui

/**
 * 추천 후보의 이유 코드 → 문구. 서버 functions/src/domain/recommend.ts의 ReasonCode, 웹 lib/recommendReasons.ts와 같다.
 */
private val REASON_LABELS = mapOf(
    "PREFERRED" to "선호 시간대",
    "ADJACENT_SAME_CHARACTER" to "같은 캐릭터 레이드와 이어서",
    "ADJACENT" to "다른 레이드와 이어서",
    "ADJACENT_PENDING" to "다른 파티 후보와 이어서",
    "USUAL_TIME" to "평소 레이드 시간",
    "LATE_NIGHT" to "새벽",
    "DAYTIME" to "낮·아침 시간",
    "MIDNIGHT" to "자정 넘어서",
    "PENDING_OVERLAP" to "다른 파티 후보와 겹침",
)

/** 이유 코드를 "선호 시간대 · 평소 레이드 시간"처럼 붙인 문구. 모르는 코드는 뺀다 */
fun reasonText(reasons: List<String>): String = reasons.mapNotNull { REASON_LABELS[it] }.joinToString(" · ")
