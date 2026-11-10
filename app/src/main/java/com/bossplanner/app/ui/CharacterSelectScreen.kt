package com.bossplanner.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import com.bossplanner.app.data.CharacterRepository
import com.bossplanner.app.data.CharacterSummary
import com.bossplanner.app.data.UserRepository
import com.bossplanner.app.data.userMessage
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

@Composable
fun CharacterSelectScreen(
    uid: String,
    initiallySelected: List<String>,
    onSaved: () -> Unit,
    onCancel: (() -> Unit)?,
    characters: CharacterRepository = remember { CharacterRepository() },
    users: UserRepository = remember { UserRepository() },
) {
    var list by remember { mutableStateOf<List<CharacterSummary>?>(null) }
    var selected by remember { mutableStateOf(initiallySelected.toSet()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(reloadKey) {
        error = null
        try {
            // 두 번째부터는 NEXON에서 새로 받아 온다.
            list = characters.listCharacters(refresh = reloadKey > 0)
        } catch (e: Exception) {
            error = e.userMessage()
        }
    }

    Column(modifier = Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("보스에 참여할 캐릭터 선택", style = MaterialTheme.typography.headlineSmall)
        Text("파티에 넣을 캐릭터를 모두 골라 주세요. 나중에 바꿀 수 있습니다.", style = MaterialTheme.typography.bodyMedium)

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        val current = list
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when {
                current == null && error == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                current != null && current.isEmpty() ->
                    Text("이 API Key의 계정에 캐릭터가 없습니다.", Modifier.align(Alignment.Center))
                current != null -> LazyColumn {
                    items(current, key = { it.id }) { character ->
                        val checked = character.id in selected
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = !busy) {
                                    selected = if (checked) selected - character.id else selected + character.id
                                }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = checked, onCheckedChange = null)
                            Column(modifier = Modifier.padding(start = 12.dp)) {
                                Text(character.name, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    "Lv.${character.level} · ${character.job} · ${character.world}",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
        }

        Button(
            enabled = current != null && !busy && selected.any { id -> current.any { it.id == id } },
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                val ids = current.orEmpty().map { it.id }.filter { it in selected }
                busy = true
                error = null
                scope.launch {
                    try {
                        // 선택한 캐릭터의 레벨·직업·이미지를 서버에 캐시해 둔다.
                        coroutineScope { ids.map { async { characters.getCharacterInfo(it) } }.awaitAll() }
                        users.setSelectedCharacters(uid, ids)
                        onSaved()
                    } catch (e: Exception) {
                        error = e.userMessage()
                    } finally {
                        busy = false
                    }
                }
            },
        ) {
            Text(if (busy) "저장 중…" else "선택 완료 (${selected.size})")
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(enabled = !busy, onClick = { list = null; reloadKey++ }) { Text("목록 새로고침") }
            if (onCancel != null) TextButton(enabled = !busy, onClick = onCancel) { Text("취소") }
        }
    }
}
