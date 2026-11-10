package com.bossplanner.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.CharacterRepository
import com.bossplanner.app.data.userMessage
import kotlinx.coroutines.launch

/**
 * API Key 입력 화면. 키는 화면 상태에만 잠깐 있고(remember, 저장 안 함) 서버로 보낸 뒤 버린다.
 */
@Composable
fun ApiKeyScreen(
    onRegistered: () -> Unit,
    onCancel: (() -> Unit)?,
    onSignOut: () -> Unit,
    characters: CharacterRepository = remember { CharacterRepository() },
) {
    var apiKey by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("NEXON Open API Key 등록", style = MaterialTheme.typography.headlineSmall)
        Text(
            "openapi.nexon.com에서 메이플스토리 API Key를 발급받아 붙여넣어 주세요. " +
                "키는 서버에만 저장되고 이 기기에는 남지 않습니다.",
            style = MaterialTheme.typography.bodyMedium,
        )
        OutlinedTextField(
            value = apiKey,
            onValueChange = { apiKey = it.trim() },
            label = { Text("API Key") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Button(
            enabled = apiKey.length >= 20 && !busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        characters.registerApiKey(apiKey)
                        apiKey = ""
                        onRegistered()
                    } catch (e: Exception) {
                        error = e.userMessage()
                    } finally {
                        busy = false
                    }
                }
            },
        ) {
            Text(if (busy) "확인 중…" else "등록하고 캐릭터 불러오기")
        }

        if (onCancel != null) {
            TextButton(onClick = onCancel, enabled = !busy) { Text("취소") }
        } else {
            TextButton(onClick = onSignOut, enabled = !busy) { Text("로그아웃") }
        }
    }
}
