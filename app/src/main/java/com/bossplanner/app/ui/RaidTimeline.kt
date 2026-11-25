package com.bossplanner.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.Timeline

private val DAY_LABEL_WIDTH = 40.dp
private val ROW_HEIGHT = 34.dp
private val IMAGE_SIZE = 24.dp
private val IMAGE_STEP = 26.dp
/** 이미지 옆에 이만큼 남아야 파티 이름을 적는다 */
private val NAME_MIN_WIDTH = 56.dp

private val LIGHT_PARTY_COLORS = listOf(
    Color(0xFF6750A4), Color(0xFF00677F), Color(0xFF9C4A12), Color(0xFF386A20), Color(0xFF8E4585), Color(0xFF45618A),
)
private val DARK_PARTY_COLORS = listOf(
    Color(0xFFD0BCFF), Color(0xFF5FD4FD), Color(0xFFFFB68E), Color(0xFF9CD67D), Color(0xFFFFADEB), Color(0xFFADC6FF),
)

/** 앱 다크 모드 설정을 따르도록 화면 바탕 밝기로 판단한다 */
@Composable
private fun isDark(): Boolean = MaterialTheme.colorScheme.surface.luminance() < 0.5f

/** 시간표 타임라인의 파티 색 (웹 --party-1 ~ 6과 같다) */
@Composable
fun partyColor(colorIndex: Int): Color = (if (isDark()) DARK_PARTY_COLORS else LIGHT_PARTY_COLORS)[colorIndex % Timeline.PARTY_COLORS]

@Composable
private fun onPartyColor(): Color = if (isDark()) Color(0xFF1D1B20) else Color.White

/** 다크의 errorContainer는 진해서 고정 불가 시간 바탕을 옅게 */
@Composable
fun routineColor(): Color = MaterialTheme.colorScheme.errorContainer.copy(alpha = if (isDark()) 0.45f else 1f)

/** 요일이 줄, 가로축이 시각인 확정 일정 타임라인. 막대를 누르면 그 파티로 간다. */
@Composable
fun RaidTimeline(layout: Timeline.Layout, onOpenParty: (partyId: String) -> Unit) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val rowWidth = maxWidth - DAY_LABEL_WIDTH
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(modifier = Modifier.padding(start = DAY_LABEL_WIDTH).width(rowWidth).height(16.dp)) {
                layout.ticks.forEach { tick ->
                    Text(
                        tick.label,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        // 눈금 글자의 가운데를 시각에 맞춘다 (글자 폭 약 14dp)
                        modifier = Modifier.offset(x = rowWidth * tick.left.toFloat() - 7.dp),
                    )
                }
            }
            layout.dayStarts.forEachIndexed { row, dayStart ->
                TimelineRow(layout, row, dayStart, rowWidth, onOpenParty)
            }
        }
    }
}

@Composable
private fun TimelineRow(layout: Timeline.Layout, row: Int, dayStart: Long, rowWidth: Dp, onOpenParty: (String) -> Unit) {
    val today = layout.now?.row == row
    val surface = MaterialTheme.colorScheme.surface
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.width(DAY_LABEL_WIDTH)) {
            Text(
                TimeSlots.weekdayLabel(dayStart),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (today) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            )
            Text(TimeSlots.dayLabel(dayStart), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Box(
            modifier = Modifier
                .width(rowWidth)
                .height(ROW_HEIGHT)
                .clip(RoundedCornerShape(6.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            val routine = routineColor()
            layout.routine.filter { it.row == row }.forEach { span ->
                Box(Modifier.offset(x = rowWidth * span.left.toFloat()).width(rowWidth * span.width.toFloat()).fillMaxHeight().background(routine))
            }
            layout.gridLines.forEach { left ->
                Box(Modifier.offset(x = rowWidth * left.toFloat()).width(1.dp).fillMaxHeight().background(surface))
            }
            layout.breaks.forEach { (left, width) ->
                Box(
                    Modifier
                        .offset(x = rowWidth * left.toFloat())
                        .width(rowWidth * width.toFloat())
                        .fillMaxHeight()
                        // 접은 빈 시간: 빗금
                        .drawBehind {
                            val gap = 6.dp.toPx()
                            var start = -size.height
                            while (start < size.width) {
                                drawLine(surface, Offset(start, size.height), Offset(start + size.height, 0f), strokeWidth = 3.dp.toPx() / 2)
                                start += gap
                            }
                        },
                )
            }
            layout.bars.filter { it.row == row }.forEach { bar -> TimelineBar(bar, rowWidth, onOpenParty) }
            layout.now?.takeIf { today }?.let { now ->
                Box(Modifier.offset(x = rowWidth * now.left.toFloat() - 1.dp).width(2.dp).fillMaxHeight().background(MaterialTheme.colorScheme.error))
            }
        }
    }
}

/** 보스 이미지는 들어가는 만큼(최소 1개), 파티 이름은 남는 폭이 넉넉할 때만 */
@Composable
private fun TimelineBar(bar: Timeline.Bar, rowWidth: Dp, onOpenParty: (String) -> Unit) {
    val raid = bar.raid
    val width = rowWidth * bar.width.toFloat() - 2.dp
    val fit = ((width - 4.dp) / IMAGE_STEP).toInt().coerceIn(1, maxOf(1, raid.bosses.size))
    val showName = width - IMAGE_STEP * fit >= NAME_MIN_WIDTH
    val label = "${raid.partyName} ${TimeSlots.range(raid.startMs, raid.endMs)}"
    Row(
        modifier = Modifier
            .offset(x = rowWidth * bar.left.toFloat() + 1.dp, y = 3.dp)
            .width(width)
            .height(ROW_HEIGHT - 6.dp)
            .alpha(if (bar.past) 0.45f else 1f)
            .clip(RoundedCornerShape(5.dp))
            .background(partyColor(bar.colorIndex))
            .clickable { onOpenParty(raid.partyId) }
            .semantics { contentDescription = label }
            .padding(horizontal = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        raid.bosses.take(fit).forEach { boss ->
            val image = bossImageRes(boss.name)
            val tile = Modifier.size(IMAGE_SIZE).clip(RoundedCornerShape(4.dp)).background(Color.Black.copy(alpha = 0.12f))
            if (image != null) {
                Image(painterResource(image), contentDescription = null, contentScale = ContentScale.Crop, modifier = tile)
            } else {
                Box(tile, contentAlignment = Alignment.Center) {
                    Text(boss.name.take(1), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = onPartyColor())
                }
            }
        }
        if (showName) {
            Text(
                raid.partyName,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = onPartyColor(),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
