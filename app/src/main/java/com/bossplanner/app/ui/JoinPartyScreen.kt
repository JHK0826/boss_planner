package com.bossplanner.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.CharacterInfo
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.userMessage
import kotlinx.coroutines.launch

@Composable
fun JoinPartyScreen(
    characters: List<CharacterInfo>,
    onJoined: (partyId: String) -> Unit,
    onBack: () -> Unit,
    parties: PartyRepository = remember { PartyRepository() },
) {
    var code by rememberSaveable { mutableStateOf("") }
    var characterId by rememberSaveable { mutableStateOf(characters.firstOrNull()?.id) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    BackHandler(enabled = !busy, onBack = onBack)

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("초대 코드로 가입", style = MaterialTheme.typography.headlineSmall)
        Text(
            "파티장에게 받은 6자리 코드를 입력해 주세요. 이미 주기가 시작된 파티는 주기 시작일(주간 보스는 목요일, 월간 보스는 1일)에만 가입할 수 있습니다.",
            style = MaterialTheme.typography.bodyMedium,
        )

        OutlinedTextField(
            value = code,
            onValueChange = { input -> code = input.uppercase().filter { it.isLetterOrDigit() }.take(6) },
            label = { Text("초대 코드") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            modifier = Modifier.fillMaxWidth(),
        )

        CharacterPicker(characters, characterId, enabled = !busy) { characterId = it }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Button(
            enabled = code.length == 6 && characterId != null && !busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                val selected = characterId ?: return@Button
                busy = true
                error = null
                scope.launch {
                    try {
                        onJoined(parties.joinParty(code, selected))
                    } catch (e: Exception) {
                        error = e.userMessage()
                    } finally {
                        busy = false
                    }
                }
            },
        ) {
            Text(if (busy) "가입하는 중…" else "가입하기")
        }
        TextButton(onClick = onBack, enabled = !busy) { Text("취소") }
    }
}
