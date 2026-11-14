package com.bossplanner.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.BossCatalog
import com.bossplanner.app.data.Bosses
import com.bossplanner.app.data.CharacterInfo
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.PartyBoss
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.userMessage
import kotlinx.coroutines.launch

private const val DURATION_STEP = 10

/**
 * 고정 파티 만들기. 보스를 여러 개 묶을 수 있다.
 *
 * - 주간 보스와 월간 보스는 주기가 달라 한 파티에 섞을 수 없다.
 * - 같은 캐릭터가 이미 다른 파티에서 잡는 보스는 고를 수 없다 (서버에서도 검사한다).
 * - 소요 시간은 보스 하나에 20분으로 잡고, 10분 단위로 고칠 수 있다 (최소 20분).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CreatePartyScreen(
    uid: String,
    characters: List<CharacterInfo>,
    myParties: List<Party>,
    onCreated: (partyId: String) -> Unit,
    onBack: () -> Unit,
    parties: PartyRepository = remember { PartyRepository() },
) {
    var catalog by remember { mutableStateOf<BossCatalog?>(null) }
    var name by rememberSaveable { mutableStateOf("") }
    // 고른 보스 이름 → 난이도 (고른 순서 유지)
    var selected by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    // null이면 보스 수에 맞춰 자동으로 정한다.
    var customDuration by remember { mutableStateOf<Int?>(null) }
    var settings by remember { mutableStateOf(RecommendSettings()) }
    var characterId by rememberSaveable { mutableStateOf(characters.firstOrNull()?.id) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(reloadKey) {
        error = null
        try {
            catalog = parties.getBossCatalog()
        } catch (e: Exception) {
            error = e.userMessage()
        }
    }

    BackHandler(enabled = !busy, onBack = onBack)

    val loaded = catalog
    if (loaded == null) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            val message = error
            if (message == null) {
                CircularProgressIndicator()
            } else {
                Text(message, color = MaterialTheme.colorScheme.error)
                Button(onClick = { reloadKey++ }) { Text("다시 시도") }
            }
            TextButton(onClick = onBack) { Text("취소") }
        }
        return
    }

    // 이 캐릭터가 이미 다른 파티에서 잡는 보스
    val takenBy = remember(myParties, characterId, uid) {
        myParties.filter { it.members[uid]?.characterId == characterId }
            .flatMap { party -> party.bosses.map { it.name to party.name } }
            .toMap()
    }
    // 캐릭터를 바꿔서 겹치게 된 보스는 선택에서 뺀다.
    LaunchedEffect(takenBy) {
        if (selected.keys.any { it in takenBy }) selected = selected.filterKeys { it !in takenBy }
    }

    val selectedMonthly = loaded.bosses.firstOrNull { it.name in selected }?.monthly
    val autoDuration = (selected.size * loaded.minutesPerBoss).coerceIn(loaded.minutesPerBoss, loaded.maxDurationMinutes)
    val durationMinutes = customDuration ?: autoDuration

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

        CharacterPicker(characters, characterId, enabled = !busy) { characterId = it }

        Text("보스 (여러 개를 묶을 수 있습니다)", style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            loaded.bosses.forEach { boss ->
                val isSelected = boss.name in selected
                // 주간과 월간은 섞을 수 없고, 이 캐릭터가 이미 잡는 보스는 고를 수 없다.
                val selectable = boss.name !in takenBy && (selectedMonthly == null || selectedMonthly == boss.monthly)
                FilterChip(
                    selected = isSelected,
                    enabled = !busy && (isSelected || selectable),
                    onClick = {
                        selected = if (isSelected) selected - boss.name else selected + (boss.name to boss.difficulties.last())
                    },
                    label = { Text(if (boss.monthly) "${boss.name} (월간)" else boss.name) },
                )
            }
        }
        if (takenBy.isNotEmpty()) {
            Text(
                "이 캐릭터가 이미 다른 파티에서 잡는 보스는 고를 수 없습니다: " +
                    takenBy.entries.joinToString(", ") { "${it.key}(${it.value})" },
                style = MaterialTheme.typography.bodySmall,
            )
        }

        if (selected.isNotEmpty()) {
            Text("난이도", style = MaterialTheme.typography.titleSmall)
            selected.forEach { (bossName, difficulty) ->
                val boss = loaded.bosses.firstOrNull { it.name == bossName } ?: return@forEach
                Column {
                    Text(bossName, style = MaterialTheme.typography.bodyMedium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        boss.difficulties.forEach { code ->
                            FilterChip(
                                selected = code == difficulty,
                                enabled = !busy,
                                onClick = { selected = selected + (bossName to code) },
                                label = { Text(Bosses.difficultyLabel(code)) },
                            )
                        }
                    }
                }
            }
            Text(
                if (selectedMonthly == true) "월간 보스: 매월 1일에 주기가 시작됩니다." else "주간 보스: 매주 목요일에 주기가 시작됩니다.",
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Text("소요 시간 (추천 시간의 길이)", style = MaterialTheme.typography.titleSmall)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(
                enabled = !busy && durationMinutes > loaded.minutesPerBoss,
                onClick = { customDuration = (durationMinutes - DURATION_STEP).coerceAtLeast(loaded.minutesPerBoss) },
            ) { Text("−10분") }
            Box(contentAlignment = Alignment.Center) {
                Text(durationLabel(durationMinutes), style = MaterialTheme.typography.titleMedium)
            }
            OutlinedButton(
                enabled = !busy && durationMinutes < loaded.maxDurationMinutes,
                onClick = { customDuration = (durationMinutes + DURATION_STEP).coerceAtMost(loaded.maxDurationMinutes) },
            ) { Text("+10분") }
            if (customDuration != null && customDuration != autoDuration) {
                TextButton(enabled = !busy, onClick = { customDuration = null }) { Text("자동") }
            }
        }
        Text(
            "보스 하나에 ${loaded.minutesPerBoss}분으로 계산합니다. 시간표는 30분 단위라 추천 시간은 정각이나 30분에 시작합니다.",
            style = MaterialTheme.typography.bodySmall,
        )

        RecommendSettingsEditor(settings, enabled = !busy) { settings = it }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Button(
            enabled = name.isNotBlank() && characterId != null && selected.isNotEmpty() && !busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                val character = characterId ?: return@Button
                val bosses = selected.map { PartyBoss(it.key, it.value) }
                busy = true
                error = null
                scope.launch {
                    try {
                        onCreated(
                            parties.createParty(
                                name.trim(),
                                bosses,
                                durationMinutes,
                                character,
                                settings.preferredWindow,
                                settings.minLeadMinutes,
                            ),
                        )
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
