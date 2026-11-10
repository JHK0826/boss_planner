package com.bossplanner.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.bossplanner.app.data.CharacterInfo
import com.bossplanner.app.data.UserProfile
import com.bossplanner.app.data.UserRepository

/** 온보딩이 끝난 뒤의 홈. 파티·일정 화면은 2주차에 여기에 붙는다. */
@Composable
fun HomeScreen(
    uid: String,
    profile: UserProfile,
    onEditCharacters: () -> Unit,
    onEditApiKey: () -> Unit,
    onSignOut: () -> Unit,
    users: UserRepository = remember { UserRepository() },
) {
    var characters by remember { mutableStateOf<List<CharacterInfo>>(emptyList()) }

    LaunchedEffect(uid, profile.selectedCharacterIds) {
        characters = try {
            users.cachedCharacters(uid, profile.selectedCharacterIds)
        } catch (e: Exception) {
            emptyList()
        }
    }

    Column(modifier = Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            if (profile.displayName.isBlank()) "내 캐릭터" else "${profile.displayName}님의 캐릭터",
            style = MaterialTheme.typography.headlineSmall,
        )

        LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(characters, key = { it.id }) { character ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(
                            model = character.imageUrl,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                        )
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

        Text("파티와 주간 일정은 다음 단계에서 추가됩니다.", style = MaterialTheme.typography.bodySmall)

        OutlinedButton(onClick = onEditCharacters, modifier = Modifier.fillMaxWidth()) { Text("캐릭터 다시 선택") }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onEditApiKey) { Text("API Key 다시 등록") }
            TextButton(onClick = onSignOut) { Text("로그아웃") }
        }
    }
}
