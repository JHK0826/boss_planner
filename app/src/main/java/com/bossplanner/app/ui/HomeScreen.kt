package com.bossplanner.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.bossplanner.app.data.Bosses
import com.bossplanner.app.data.CharacterInfo
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.Raid
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.UserProfile

/** 설치된 앱의 버전 (version.properties의 versionName) */
@Composable
private fun appVersionName(): String {
    val context = LocalContext.current
    return remember {
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "?"
    }
}

@Composable
fun HomeScreen(
    profile: UserProfile,
    characters: List<CharacterInfo>,
    parties: List<Party>,
    raids: List<Raid>,
    onOpenParty: (partyId: String) -> Unit,
    onCreateParty: () -> Unit,
    onJoinParty: () -> Unit,
    onEditRoutine: () -> Unit,
    onEditCharacters: () -> Unit,
    onEditApiKey: () -> Unit,
    onSignOut: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Text(
                if (profile.displayName.isBlank()) "보스 스케줄 매니저" else "${profile.displayName}님",
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(top = 24.dp),
            )
        }

        if (raids.isNotEmpty()) {
            item { Text("확정된 일정", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
            items(raids, key = { "raid-${it.partyId}-${it.startMs}" }) { raid ->
                Card(modifier = Modifier.fillMaxWidth().clickable { onOpenParty(raid.partyId) }) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(TimeSlots.range(raid.startMs, raid.endMs), style = MaterialTheme.typography.titleMedium)
                        Text(
                            "${raid.partyName} · ${Bosses.label(raid.bosses)}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }

        item { Text("내 파티", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
        if (parties.isEmpty()) {
            item { Text("아직 가입한 파티가 없습니다.", style = MaterialTheme.typography.bodyMedium) }
        }
        items(parties, key = { "party-${it.id}" }) { party ->
            Card(modifier = Modifier.fillMaxWidth().clickable { onOpenParty(party.id) }) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(party.name, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${party.bossLabel} · ${if (party.isWeekly) "주간" else "월간"} · ${party.memberUids.size}명",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onCreateParty, modifier = Modifier.weight(1f)) { Text("파티 만들기") }
                OutlinedButton(onClick = onJoinParty, modifier = Modifier.weight(1f)) { Text("코드로 가입") }
            }
        }

        item {
            // 매주 반복되는 안 되는 시간을 저장해 두면 불가 시간표가 미리 채워진다.
            OutlinedButton(onClick = onEditRoutine, modifier = Modifier.fillMaxWidth()) { Text("고정 불가 시간 설정") }
        }

        item { Text("내 캐릭터", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp)) }
        items(characters, key = { "character-${it.id}" }) { character ->
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                AsyncImage(model = character.imageUrl, contentDescription = null, modifier = Modifier.size(56.dp))
                Column(modifier = Modifier.padding(start = 12.dp)) {
                    Text(character.name, style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Lv.${character.level} · ${character.job} · ${character.world}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        item {
            Column(modifier = Modifier.padding(bottom = 24.dp)) {
                TextButton(onClick = onEditCharacters) { Text("캐릭터 다시 선택") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = onEditApiKey) { Text("API Key 다시 등록") }
                    TextButton(onClick = onSignOut) { Text("로그아웃") }
                }
                // 파티원끼리 같은 버전을 쓰는지 확인할 수 있게 보여 준다.
                Text(
                    "버전 ${appVersionName()}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 12.dp, top = 8.dp),
                )
            }
        }
    }
}
