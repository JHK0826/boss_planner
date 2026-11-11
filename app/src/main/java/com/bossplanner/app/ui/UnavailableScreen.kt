package com.bossplanner.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.userMessage
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** 불가 시간을 입력할 일정 */
data class UnavailableTarget(
    val periodId: String,
    val periodStartMs: Long,
    val periodEndMs: Long,
    /** 이미 추천 후보가 나와 있는가. 다시 제출하면 추천과 투표가 처음부터 다시 진행된다. */
    val hasCandidates: Boolean,
)

private val LABEL_WIDTH = 48.dp
private val CELL_HEIGHT = 28.dp
private val MIN_CELL_WIDTH = 40.dp

/**
 * 30분 단위 시간표. 안 되는 칸만 탭하고 제출한다.
 * 세로는 00:00~23:30, 가로는 주기의 날짜(주간 7일, 월간은 가로로 스크롤)이다.
 */
@Composable
fun UnavailableScreen(
    uid: String,
    partyId: String,
    target: UnavailableTarget,
    onDone: () -> Unit,
    parties: PartyRepository = remember { PartyRepository() },
) {
    val dayCount = ((target.periodEndMs - target.periodStartMs) / (TimeSlots.SLOT_MS * TimeSlots.SLOTS_PER_DAY)).toInt()
    // slotIds[day][row]
    val slotIds = remember(target.periodStartMs, dayCount) {
        List(dayCount) { day ->
            List(TimeSlots.SLOTS_PER_DAY) { row ->
                TimeSlots.slotId(target.periodStartMs + (day * TimeSlots.SLOTS_PER_DAY + row) * TimeSlots.SLOT_MS)
            }
        }
    }
    val now = remember { System.currentTimeMillis() }
    val firstFutureSlot = ((now - target.periodStartMs) / TimeSlots.SLOT_MS).toInt() + 1

    var selected by remember { mutableStateOf<Set<String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(partyId, target.periodId) {
        selected = parties.unavailable(partyId, target.periodId).first()[uid]?.slots.orEmpty().toSet()
    }

    BackHandler(enabled = !busy, onBack = onDone)

    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("불가 시간 입력", style = MaterialTheme.typography.headlineSmall)
        Text(
            "안 되는 시간만 탭해 주세요. 날짜를 탭하면 하루 전체가 선택됩니다. 안 되는 시간이 없어도 제출을 눌러야 입력으로 처리됩니다.",
            style = MaterialTheme.typography.bodySmall,
        )
        if (target.hasCandidates) {
            Text(
                "이미 추천 시간이 나와 있습니다. 내용을 바꿔 제출하면 추천과 투표가 처음부터 다시 진행됩니다.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        val current = selected
        if (current == null) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else {
            BoxWithConstraints(modifier = Modifier.weight(1f).fillMaxWidth()) {
                val fitted = (maxWidth - LABEL_WIDTH) / dayCount
                val cellWidth = if (fitted < MIN_CELL_WIDTH) MIN_CELL_WIDTH else fitted
                Column(modifier = Modifier.horizontalScroll(rememberScrollState())) {
                    Row {
                        Box(Modifier.width(LABEL_WIDTH))
                        slotIds.forEachIndexed { day, ids ->
                            val dayStart = target.periodStartMs + day * TimeSlots.SLOTS_PER_DAY * TimeSlots.SLOT_MS
                            val allSelected = current.containsAll(ids)
                            Column(
                                modifier = Modifier
                                    .width(cellWidth)
                                    .clickable(enabled = !busy) {
                                        selected = if (allSelected) current - ids.toSet() else current + ids
                                    }
                                    .padding(vertical = 4.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Text(TimeSlots.weekdayLabel(dayStart), style = MaterialTheme.typography.labelMedium)
                                Text(TimeSlots.dayLabel(dayStart), style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                    LazyColumn {
                        items(TimeSlots.SLOTS_PER_DAY) { row ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    // 정각에만 시각을 적는다.
                                    if (row % 2 == 0) TimeSlots.rowLabel(row) else "",
                                    modifier = Modifier.width(LABEL_WIDTH).padding(end = 6.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    textAlign = TextAlign.End,
                                )
                                slotIds.forEachIndexed { day, ids ->
                                    val slotId = ids[row]
                                    SlotCell(
                                        width = cellWidth,
                                        blocked = slotId in current,
                                        past = day * TimeSlots.SLOTS_PER_DAY + row < firstFutureSlot,
                                        enabled = !busy,
                                        onToggle = { selected = if (slotId in current) current - slotId else current + slotId },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(
                enabled = current != null && !busy,
                modifier = Modifier.weight(1f),
                onClick = {
                    val slots = current.orEmpty().toList()
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            parties.setUnavailable(partyId, target.periodId, uid, slots, submitted = true)
                            onDone()
                        } catch (e: Exception) {
                            error = if (e is com.google.firebase.firestore.FirebaseFirestoreException) {
                                "제출하지 못했습니다. 일정이 이미 확정되었거나 종료되었을 수 있습니다."
                            } else {
                                e.userMessage()
                            }
                        } finally {
                            busy = false
                        }
                    }
                },
            ) {
                Text(if (busy) "제출 중…" else "제출 (불가 ${current?.size ?: 0}칸)")
            }
            TextButton(enabled = current != null && !busy, onClick = { selected = emptySet() }) { Text("모두 지우기") }
            TextButton(enabled = !busy, onClick = onDone) { Text("취소") }
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
