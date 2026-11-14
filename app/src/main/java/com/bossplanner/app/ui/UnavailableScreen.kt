package com.bossplanner.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.RoutineRepository
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.userMessage
import com.google.firebase.firestore.FirebaseFirestoreException
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

/**
 * 불가 시간 입력. 한 칸씩 누르지 않아도 되도록 세 가지를 지원한다.
 *
 * - 범위로 한 번에 채우기 (요일 + 시간대)
 * - 고정 불가 시간: 저장해 둔 매주 반복 시간으로 미리 채운다
 * - 내 다른 파티에도 적용: 불가 시간은 사람 기준이라, 같은 주기의 다른 파티에도 함께 제출한다
 */
@Composable
fun UnavailableScreen(
    uid: String,
    partyId: String,
    target: UnavailableTarget,
    otherParties: List<Party>,
    onDone: () -> Unit,
    parties: PartyRepository = remember { PartyRepository() },
    routines: RoutineRepository = remember { RoutineRepository() },
) {
    val dayCount = ((target.periodEndMs - target.periodStartMs) / (TimeSlots.SLOT_MS * TimeSlots.SLOTS_PER_DAY)).toInt()
    val columns = remember(target.periodStartMs, dayCount) {
        List(dayCount) { day ->
            val dayStart = target.periodStartMs + day * TimeSlots.SLOTS_PER_DAY * TimeSlots.SLOT_MS
            GridColumn(
                title = TimeSlots.weekdayLabel(dayStart),
                subtitle = TimeSlots.dayLabel(dayStart),
                weekday = TimeSlots.weekday(dayStart),
                slotIds = List(TimeSlots.SLOTS_PER_DAY) { row -> TimeSlots.slotId(dayStart + row * TimeSlots.SLOT_MS) },
            )
        }
    }
    val now = remember { System.currentTimeMillis() }
    val firstFutureSlot = ((now - target.periodStartMs) / TimeSlots.SLOT_MS).toInt() + 1

    var selected by remember { mutableStateOf<Set<String>?>(null) }
    var routine by remember { mutableStateOf<Set<String>>(emptySet()) }
    var prefilled by remember { mutableStateOf(false) }
    var applyToOthers by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    /** 고정 불가 시간(요일-시각)을 이 주기의 날짜 칸으로 옮긴다. */
    fun routineSlots(): Set<String> = columns.flatMap { column ->
        column.slotIds.filterIndexed { row, _ -> RoutineRepository.key(column.weekday, row) in routine }
    }.toSet()

    LaunchedEffect(partyId, target.periodId) {
        routine = try {
            routines.load(uid)
        } catch (e: Exception) {
            emptySet()
        }
        val saved = parties.unavailable(partyId, target.periodId).first()[uid]
        if (saved != null) {
            selected = saved.slots.toSet()
        } else {
            // 이번 주기에 아직 아무것도 저장하지 않았으면 고정 불가 시간으로 시작한다.
            selected = routineSlots()
            prefilled = routine.isNotEmpty()
        }
    }

    BackHandler(enabled = !busy, onBack = onDone)

    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("불가 시간 입력", style = MaterialTheme.typography.headlineSmall)
        Text(
            when {
                prefilled -> "고정 불가 시간으로 채워 두었습니다. 이번 주기에 달라진 부분만 고치고 제출해 주세요."
                routine.isEmpty() -> "안 되는 시간을 표시하고 제출해 주세요. 매주 비슷하다면 '시간표' 메뉴의 고정 불가 시간에 저장해 두면 다음부터 미리 채워집니다."
                else -> "안 되는 시간을 표시하고 제출해 주세요. 안 되는 시간이 없어도 제출을 눌러야 입력으로 처리됩니다."
            },
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
            BulkFillPanel(columns, current, enabled = !busy) { selected = it }
            if (routine.isNotEmpty()) {
                TextButton(enabled = !busy, onClick = { selected = routineSlots() }) { Text("고정 불가 시간으로 되돌리기") }
            }
            SlotGrid(
                columns = columns,
                selected = current,
                enabled = !busy,
                onChange = { selected = it },
                modifier = Modifier.weight(1f).fillMaxWidth(),
                pastBefore = firstFutureSlot,
            )
        }

        if (otherParties.isNotEmpty()) {
            Row(
                modifier = Modifier.fillMaxWidth().clickable(enabled = !busy) { applyToOthers = !applyToOthers },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = applyToOthers, onCheckedChange = null)
                Text(
                    "내 다른 파티에도 같은 시간으로 제출 (같은 주기에 입력을 받는 파티)",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(start = 8.dp),
                )
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
                            if (applyToOthers) submitToOtherParties(parties, otherParties, target, uid, slots)
                            onDone()
                        } catch (e: Exception) {
                            error = if (e is FirebaseFirestoreException) {
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
            TextButton(enabled = !busy, onClick = onDone) { Text("취소") }
        }
    }
}

/**
 * 같은 주기에 입력을 받고 있는 내 다른 파티에도 같은 불가 시간을 제출한다.
 * 주기가 다른 파티(주간 ↔ 월간)나 이미 확정된 파티는 건너뛴다. 한 파티가 실패해도 나머지는 계속한다.
 */
private suspend fun submitToOtherParties(
    parties: PartyRepository,
    otherParties: List<Party>,
    target: UnavailableTarget,
    uid: String,
    slots: List<String>,
) {
    for (party in otherParties) {
        try {
            val schedule = parties.latestScheduleOnce(party.id) ?: continue
            val samePeriod = schedule.periodStartMs == target.periodStartMs && schedule.periodEndMs == target.periodEndMs
            if (schedule.acceptsInput && samePeriod) {
                parties.setUnavailable(party.id, schedule.id, uid, slots, submitted = true)
            }
        } catch (e: Exception) {
            // 이 파티는 건너뛴다. 그 파티 화면에서 따로 제출할 수 있다.
        }
    }
}
