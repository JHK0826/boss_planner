package com.bossplanner.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.PreferredWindow
import com.bossplanner.app.data.TimeSlots

/** 파티의 추천 설정: 선호 시간대(없을 수 있음), 최소 여유 시간, 투표 없이 자동 지정 */
data class RecommendSettings(
    val preferredWindow: PreferredWindow? = null,
    val minLeadMinutes: Int = 180,
    val autoAssign: Boolean = false,
)

/** 선호 시간대를 처음 켰을 때의 값: 매일 21:00 ~ 24:00 */
private val DEFAULT_WINDOW = PreferredWindow(days = (1..7).toList(), startRow = 42, endRow = 48)
private val LEAD_CHOICES = listOf(0 to "없음", 60 to "1시간", 180 to "3시간", 360 to "6시간", 720 to "12시간", 1440 to "24시간")

private fun dayChoiceLabel(days: List<Int>): String =
    DAY_CHOICES.firstOrNull { it.second == days.toSet() }?.first
        ?: days.sorted().joinToString("·") { "월화수목금토일"[it - 1].toString() }

/** "매일 21:00~24:00 선호 · 여유 3시간 · 투표 없이 자동 지정" */
fun recommendSettingsSummary(window: PreferredWindow?, minLeadMinutes: Int, autoAssign: Boolean = false): String {
    val preferred = window?.let {
        "${dayChoiceLabel(it.days)} ${TimeSlots.rowLabel(it.startRow)}~${TimeSlots.rowLabel(it.endRow)} 선호"
    } ?: "선호 시간대 없음"
    val lead = LEAD_CHOICES.firstOrNull { it.first == minLeadMinutes }?.second ?: "${minLeadMinutes}분"
    return "$preferred · 여유 $lead · ${if (autoAssign) "투표 없이 자동 지정" else "투표로 확정"}"
}

/**
 * 추천 설정 편집. 파티를 만들 때와 파티장이 나중에 바꿀 때 같이 쓴다.
 *
 * - 선호 시간대: 이 안에 들어가는 시각을 먼저 추천한다. 그 밖의 시각도 가능하면 추천된다.
 * - 최소 여유 시간: 지금으로부터 이 시간 안에 시작하는 시각은 추천하지 않는다.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RecommendSettingsEditor(settings: RecommendSettings, enabled: Boolean, onChange: (RecommendSettings) -> Unit) {
    val window = settings.preferredWindow

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable(enabled = enabled) {
                onChange(settings.copy(preferredWindow = if (window == null) DEFAULT_WINDOW else null))
            },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("선호 시간대", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Switch(checked = window != null, onCheckedChange = null)
        }
        if (window != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Dropdown(
                    label = dayChoiceLabel(window.days),
                    options = DAY_CHOICES.map { it.first },
                    enabled = enabled,
                    onSelect = { onChange(settings.copy(preferredWindow = window.copy(days = DAY_CHOICES[it].second.sorted()))) },
                )
                Dropdown(
                    label = TimeSlots.rowLabel(window.startRow),
                    options = (0..47).map(TimeSlots::rowLabel),
                    enabled = enabled,
                    onSelect = { start ->
                        val end = if (window.endRow <= start) start + 1 else window.endRow
                        onChange(settings.copy(preferredWindow = window.copy(startRow = start, endRow = end)))
                    },
                )
                Text("~")
                Dropdown(
                    label = TimeSlots.rowLabel(window.endRow),
                    options = ((window.startRow + 1)..48).map(TimeSlots::rowLabel),
                    enabled = enabled,
                    onSelect = { onChange(settings.copy(preferredWindow = window.copy(endRow = window.startRow + 1 + it))) },
                )
            }
            Text(
                "이 시간대에 들어가는 시각을 먼저 추천합니다. 그 밖의 시각도 가능하면 함께 추천됩니다.",
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Text("최소 여유 시간", style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            LEAD_CHOICES.forEach { (minutes, label) ->
                FilterChip(
                    selected = minutes == settings.minLeadMinutes,
                    enabled = enabled,
                    onClick = { onChange(settings.copy(minLeadMinutes = minutes)) },
                    label = { Text(label) },
                )
            }
        }
        Text(
            "추천을 계산하는 시점으로부터 이 시간 안에 시작하는 시각은 추천하지 않습니다.",
            style = MaterialTheme.typography.bodySmall,
        )

        Row(
            modifier = Modifier.fillMaxWidth().clickable(enabled = enabled) { onChange(settings.copy(autoAssign = !settings.autoAssign)) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("투표 없이 자동 지정", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Switch(checked = settings.autoAssign, onCheckedChange = null)
        }
        Text(
            "전원이 불가 시간을 내면 투표 없이 점수 1위 시간으로 바로 확정합니다. 미리 연 다음 주는 목요일 00:00에 확정합니다. " +
                "파티장은 레이드 4시간 전까지 다른 순위로 바꿀 수 있습니다.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
