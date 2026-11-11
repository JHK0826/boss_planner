package com.bossplanner.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.Bosses
import com.bossplanner.app.data.CharacterInfo
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.userMessage
import kotlinx.coroutines.launch

private val DURATIONS = listOf(30, 60, 90, 120, 150, 180)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CreatePartyScreen(
    characters: List<CharacterInfo>,
    onCreated: (partyId: String) -> Unit,
    onBack: () -> Unit,
    parties: PartyRepository = remember { PartyRepository() },
) {
    var name by rememberSaveable { mutableStateOf("") }
    var bossName by rememberSaveable { mutableStateOf("스우") }
    var difficulty by rememberSaveable { mutableStateOf("HARD") }
    var durationMinutes by rememberSaveable { mutableIntStateOf(60) }
    var characterId by rememberSaveable { mutableStateOf(characters.firstOrNull()?.id) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val boss = Bosses.find(bossName)
    val cycle = if (boss.monthly) "MONTHLY" else "WEEKLY"

    BackHandler(enabled = !busy, onBack = onBack)

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("고정 파티 만들기", style = MaterialTheme.typography.headlineSmall)

        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(20) },
            label = { Text("파티 이름") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Text("보스", style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Bosses.all.forEach { item ->
                FilterChip(
                    selected = item.name == bossName,
                    onClick = {
                        bossName = item.name
                        // 보스마다 있는 난이도가 다르다.
                        if (difficulty !in item.difficulties) difficulty = item.difficulties.last()
                    },
                    label = { Text(item.name) },
                )
            }
        }
        Text(
            if (cycle == "MONTHLY") "월간 보스: 매월 1일에 주기가 시작됩니다." else "주간 보스: 매주 목요일에 주기가 시작됩니다.",
            style = MaterialTheme.typography.bodySmall,
        )

        Text("난이도", style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            boss.difficulties.forEach { code ->
                FilterChip(
                    selected = code == difficulty,
                    onClick = { difficulty = code },
                    label = { Text(Bosses.difficultyLabel(code)) },
                )
            }
        }

        Text("소요 시간 (추천 시간의 길이)", style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DURATIONS.forEach { minutes ->
                FilterChip(
                    selected = minutes == durationMinutes,
                    onClick = { durationMinutes = minutes },
                    label = { Text(durationLabel(minutes)) },
                )
            }
        }

        CharacterPicker(characters, characterId, enabled = !busy) { characterId = it }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Button(
            enabled = name.isNotBlank() && characterId != null && !busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                val selected = characterId ?: return@Button
                busy = true
                error = null
                scope.launch {
                    try {
                        onCreated(parties.createParty(name.trim(), bossName, difficulty, cycle, durationMinutes, selected))
                    } catch (e: Exception) {
                        error = e.userMessage()
                    } finally {
                        busy = false
                    }
                }
            },
        ) {
            Text(if (busy) "만드는 중…" else "파티 만들기")
        }
        TextButton(onClick = onBack, enabled = !busy) { Text("취소") }
    }
}

fun durationLabel(minutes: Int): String = when {
    minutes < 60 -> "${minutes}분"
    minutes % 60 == 0 -> "${minutes / 60}시간"
    else -> "${minutes / 60}시간 ${minutes % 60}분"
}
