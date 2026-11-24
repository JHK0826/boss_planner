package com.bossplanner.app.data

import android.content.Context

/**
 * 다크 모드 설정. 기기에만 저장한다(계정과 상관없음).
 * - 저장된 값이 없으면 휴대폰의 다크 모드 설정을 따른다.
 * - true/false가 저장되어 있으면 그 값을 쓴다.
 */
object ThemePreference {
    private const val FILE = "settings"
    private const val KEY_DARK = "dark_mode"

    /** null이면 휴대폰 설정을 따른다 */
    fun load(context: Context): Boolean? {
        val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        return if (prefs.contains(KEY_DARK)) prefs.getBoolean(KEY_DARK, false) else null
    }

    /** null을 저장하면 다시 휴대폰 설정을 따른다 */
    fun save(context: Context, dark: Boolean?) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().apply {
            if (dark == null) remove(KEY_DARK) else putBoolean(KEY_DARK, dark)
        }.apply()
    }
}
