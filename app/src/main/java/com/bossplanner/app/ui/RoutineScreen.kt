package com.bossplanner.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.RoutineRepository
import kotlinx.coroutines.launch

/**
 * 고정 불가 시간 설정. 매주 반복되는 안 되는 시간을 요일별로 한 번 저장해 두면,
 * 새 주기의 불가 시간표가 이 값으로 미리 채워진다.
 */
@Composable
fun RoutineScreen(
    uid: String,
    onDone: () -> Unit,
    routines: RoutineRepository = remember { RoutineRepository() },
) {
    val columns = remember { weekdayColumns(RoutineRepository::key) }
    var selected by remember { mutableStateOf<Set<String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(uid) {
        selected = try {
            routines.load(uid)
        } catch (e: Exception) {
            emptySet()
        }
    }

    BackHandler(enabled = !busy, onBack = onDone)

    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("고정 불가 시간", style = MaterialTheme.typography.headlineSmall)
        Text(
            "출근이나 수면처럼 매주 반복되는 안 되는 시간을 저장해 두세요. 새 주기마다 불가 시간표가 이 값으로 미리 채워져서, 달라진 부분만 고치고 제출하면 됩니다.",
            style = MaterialTheme.typography.bodySmall,
        )

        val current = selected
        if (current == null) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else {
            BulkFillPanel(columns, current, enabled = !busy) { selected = it }
            SlotGrid(columns, current, enabled = !busy, onChange = { selected = it }, modifier = Modifier.weight(1f).fillMaxWidth())
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(
                enabled = current != null && !busy,
                modifier = Modifier.weight(1f),
                onClick = {
                    val slots = current.orEmpty()
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            routines.save(uid, slots)
                            onDone()
                        } catch (e: Exception) {
                            error = "저장하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요."
                        } finally {
                            busy = false
                        }
                    }
                },
            ) {
                Text(if (busy) "저장 중…" else "저장 (불가 ${current?.size ?: 0}칸)")
            }
            TextButton(enabled = !busy, onClick = onDone) { Text("취소") }
        }
    }
}
