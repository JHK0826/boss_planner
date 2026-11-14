package com.bossplanner.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.TimeSlots

/** 시간표의 한 열(하루). slotIds는 00:00부터 30분 칸 48개의 ID다. */
data class GridColumn(
    val title: String,
    val subtitle: String,
    /** 요일: 1(월) ~ 7(일) */
    val weekday: Int,
    val slotIds: List<String>,
)

private val WEEKDAY_NAMES = listOf("월", "화", "수", "목", "금", "토", "일")
private val LABEL_WIDTH = 48.dp
private val CELL_HEIGHT = 28.dp
private val MIN_CELL_WIDTH = 40.dp

/** 범위 채우기에서 고르는 요일 묶음 */
internal val DAY_CHOICES: List<Pair<String, Set<Int>>> =
    listOf("매일" to (1..7).toSet(), "평일" to setOf(1, 2, 3, 4, 5), "주말" to setOf(6, 7)) +
        WEEKDAY_NAMES.mapIndexed { index, name -> "${name}요일" to setOf(index + 1) }

/**
 * 범위로 한 번에 채우기. 요일과 시간대를 골라 그 범위를 통째로 불가(또는 가능)로 만든다.
 * 예: 평일 00:00~19:00 불가, 매일 02:00~10:00 불가.
 * 되는 시간이 더 적다면 "전체 불가"를 누른 뒤 되는 시간대만 "가능으로" 비우는 편이 빠르다.
 */
@Composable
fun BulkFillPanel(
    columns: List<GridColumn>,
    selected: Set<String>,
    enabled: Boolean,
    onChange: (Set<String>) -> Unit,
) {
    var dayChoice by rememberSaveable { mutableIntStateOf(1) }
    var fromRow by rememberSaveable { mutableIntStateOf(0) }
    var toRow by rememberSaveable { mutableIntStateOf(18 * 2) }
    val days = DAY_CHOICES[dayChoice].second

    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("한 번에 채우기", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            TextButton(enabled = enabled, onClick = { onChange(columns.flatMap { it.slotIds }.toSet()) }) { Text("전체 불가") }
            TextButton(enabled = enabled, onClick = { onChange(emptySet()) }) { Text("전체 가능") }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Dropdown(
                label = DAY_CHOICES[dayChoice].first,
                options = DAY_CHOICES.map { it.first },
                enabled = enabled,
                onSelect = { dayChoice = it },
            )
            Dropdown(
                label = TimeSlots.rowLabel(fromRow),
                options = (0..47).map(TimeSlots::rowLabel),
                enabled = enabled,
                onSelect = {
                    fromRow = it
                    if (toRow <= it) toRow = it + 1
                },
            )
            Text("~")
            Dropdown(
                label = TimeSlots.rowLabel(toRow),
                options = ((fromRow + 1)..48).map(TimeSlots::rowLabel),
                enabled = enabled,
                onSelect = { toRow = fromRow + 1 + it },
            )
        }
        val range = columns.filter { it.weekday in days }.flatMap { it.slotIds.subList(fromRow, toRow) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                enabled = enabled && range.isNotEmpty(),
                modifier = Modifier.weight(1f),
                onClick = { onChange(selected + range) },
            ) { Text("불가로 채우기") }
            OutlinedButton(
                enabled = enabled && range.isNotEmpty(),
                modifier = Modifier.weight(1f),
                onClick = { onChange(selected - range.toSet()) },
            ) { Text("가능으로 비우기") }
        }
    }
}

/** 현재 값을 보여 주는 버튼. 누르면 선택지가 펼쳐진다. onSelect에는 고른 항목의 순번을 넘긴다. */
@Composable
internal fun Dropdown(label: String, options: List<String>, enabled: Boolean, onSelect: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(enabled = enabled, onClick = { open = true }) { Text(label) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEachIndexed { index, option ->
                DropdownMenuItem(
                    text = { Text(option) },
                    onClick = {
                        onSelect(index)
                        open = false
                    },
                )
            }
        }
    }
}

/**
 * 30분 단위 시간표. 세로는 00:00~23:30, 가로는 날짜(또는 요일)다.
 * 칸을 탭하면 그 칸이, 위쪽 날짜를 탭하면 하루 전체가, 왼쪽 시각을 탭하면 그 시각의 모든 날이 바뀐다.
 *
 * @param pastBefore 이 번호(열 × 48 + 행)보다 앞선 칸은 이미 지난 시간이라 고칠 수 없다.
 */
@Composable
fun SlotGrid(
    columns: List<GridColumn>,
    selected: Set<String>,
    enabled: Boolean,
    onChange: (Set<String>) -> Unit,
    modifier: Modifier = Modifier,
    pastBefore: Int = 0,
) {
    BoxWithConstraints(modifier = modifier) {
        val fitted = (maxWidth - LABEL_WIDTH) / columns.size.coerceAtLeast(1)
        val cellWidth = if (fitted < MIN_CELL_WIDTH) MIN_CELL_WIDTH else fitted
        Column(modifier = Modifier.horizontalScroll(rememberScrollState())) {
            Row {
                Box(Modifier.width(LABEL_WIDTH))
                columns.forEach { column ->
                    val allSelected = selected.containsAll(column.slotIds)
                    Column(
                        modifier = Modifier
                            .width(cellWidth)
                            .clickable(enabled = enabled) {
                                onChange(if (allSelected) selected - column.slotIds.toSet() else selected + column.slotIds)
                            }
                            .padding(vertical = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(column.title, style = MaterialTheme.typography.labelMedium)
                        if (column.subtitle.isNotEmpty()) Text(column.subtitle, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            LazyColumn {
                items(TimeSlots.SLOTS_PER_DAY) { row ->
                    val rowIds = columns.map { it.slotIds[row] }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            // 정각에만 시각을 적는다.
                            if (row % 2 == 0) TimeSlots.rowLabel(row) else "",
                            modifier = Modifier
                                .width(LABEL_WIDTH)
                                .height(CELL_HEIGHT)
                                .clickable(enabled = enabled) {
                                    onChange(if (selected.containsAll(rowIds)) selected - rowIds.toSet() else selected + rowIds)
                                }
                                .padding(end = 6.dp, top = 6.dp),
                            style = MaterialTheme.typography.labelSmall,
                            textAlign = TextAlign.End,
                        )
                        columns.forEachIndexed { columnIndex, column ->
                            val slotId = column.slotIds[row]
                            SlotCell(
                                width = cellWidth,
                                blocked = slotId in selected,
                                past = columnIndex * TimeSlots.SLOTS_PER_DAY + row < pastBefore,
                                enabled = enabled,
                                onToggle = { onChange(if (slotId in selected) selected - slotId else selected + slotId) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SlotCell(width: Dp, blocked: Boolean, past: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    val color = if (blocked) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.surfaceVariant
    Box(
        modifier = Modifier
            .width(width)
            .height(CELL_HEIGHT)
            .padding(1.dp)
            .alpha(if (past) 0.35f else 1f)
            .background(color)
            // 지난 시간은 추천 대상이 아니라서 고칠 필요가 없다.
            .clickable(enabled = enabled && !past, onClick = onToggle),
    )
}

/** 요일 7개(월~일)짜리 열. 고정 불가 시간 편집에 쓴다. */
fun weekdayColumns(slotIdFor: (weekday: Int, row: Int) -> String): List<GridColumn> =
    (1..7).map { weekday ->
        GridColumn(
            title = WEEKDAY_NAMES[weekday - 1],
            subtitle = "",
            weekday = weekday,
            slotIds = List(TimeSlots.SLOTS_PER_DAY) { row -> slotIdFor(weekday, row) },
        )
    }
