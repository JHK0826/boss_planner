package com.bossplanner.app.ui

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * 지금 화면이 다크 모드인지와, 설정을 바꾸는 방법.
 * MainActivity가 앱 전체에 하나만 두고, 설정 탭이 읽어서 토글을 보여 준다.
 *
 * @param followsSystem 휴대폰 설정을 따르는 중이면 true
 * @param onChange true/false = 앱에서 직접 설정, null = 다시 휴대폰 설정 따르기
 */
data class ThemeSetting(
    val dark: Boolean,
    val followsSystem: Boolean,
    val onChange: (Boolean?) -> Unit,
)

val LocalThemeSetting = staticCompositionLocalOf { ThemeSetting(dark = false, followsSystem = true, onChange = {}) }
