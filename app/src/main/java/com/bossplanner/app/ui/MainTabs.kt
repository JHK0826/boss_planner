package com.bossplanner.app.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.bossplanner.app.data.Bosses
import com.bossplanner.app.data.CharacterInfo
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.RoutineRepository
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.UserProfile

private val TAB_PADDING = 24.dp

/** 내 캐릭터: 보스에 참여하도록 골라 둔 캐릭터를 본다. */
@Composable
fun CharactersTab(characters: List<CharacterInfo>, onEditCharacters: () -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = TAB_PADDING),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { TabTitle("내 캐릭터") }
        if (characters.isEmpty()) {
            item { Text("선택한 캐릭터가 없습니다.", style = MaterialTheme.typography.bodyMedium) }
        }
        items(characters, key = { it.id }) { character ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    AsyncImage(model = character.imageUrl, contentDescription = null, modifier = Modifier.size(72.dp))
                    Column(modifier = Modifier.padding(start = 12.dp)) {
                        Text(character.name, style = MaterialTheme.typography.titleMedium)
                        Text("Lv.${character.level} · ${character.job}", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            listOfNotNull(character.world, character.guild?.takeIf { it.isNotBlank() }).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
        item {
            OutlinedButton(onClick = onEditCharacters, modifier = Modifier.fillMaxWidth().padding(bottom = TAB_PADDING)) {
                Text("캐릭터 다시 선택")
            }
        }
    }
}

/** 파티: 내 파티 목록, 파티 만들기, 초대 코드로 가입 */
@Composable
fun PartiesTab(
    parties: List<Party>,
    onOpenParty: (partyId: String) -> Unit,
    onCreateParty: () -> Unit,
    onJoinParty: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = TAB_PADDING),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item { TabTitle("파티") }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onCreateParty, modifier = Modifier.weight(1f)) { Text("파티 만들기") }
                OutlinedButton(onClick = onJoinParty, modifier = Modifier.weight(1f)) { Text("코드로 가입") }
            }
        }
        if (parties.isEmpty()) {
            item { Text("아직 가입한 파티가 없습니다.", style = MaterialTheme.typography.bodyMedium) }
        }
        items(parties, key = { it.id }) { party ->
            Card(modifier = Modifier.fillMaxWidth().clickable { onOpenParty(party.id) }) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(party.name, style = MaterialTheme.typography.titleMedium)
                    Text(party.bossLabel, style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "${if (party.isWeekly) "주간" else "월간"} · ${party.memberUids.size}명",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        item { Box(Modifier.height(TAB_PADDING)) }
    }
}

/** 설정: 계정, API Key 재등록, 로그아웃, 앱 버전 */
@Composable
fun SettingsTab(profile: UserProfile, onEditApiKey: () -> Unit, onSignOut: () -> Unit) {
    val context = LocalContext.current
    val version = remember {
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "?"
    }
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = TAB_PADDING),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TabTitle("설정")
        if (profile.displayName.isNotBlank()) {
            Text("닉네임", style = MaterialTheme.typography.labelMedium)
            Text(profile.displayName, style = MaterialTheme.typography.titleMedium)
        }
        OutlinedButton(onClick = onEditApiKey, modifier = Modifier.fillMaxWidth()) { Text("API Key 다시 등록") }
        OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("로그아웃") }
        // 파티원끼리 같은 버전을 쓰는지 확인할 수 있게 보여 준다.
        Text("버전 $version", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private val TIME_LABEL_WIDTH = 44.dp
private val TIMETABLE_CELL_HEIGHT = 18.dp
private const val DAY_MS = TimeSlots.SLOTS_PER_DAY * TimeSlots.SLOT_MS

/**
 * 시간표: 고정 불가 시간을 설정하고, 이번 주(목~수)의 확정 일정을 한눈에 본다.
 * 시간표의 색은 확정된 레이드와 고정 불가 시간이다. 파티마다 따로 제출한 불가 시간은 여기에 나오지 않는다.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TimetableTab(
    uid: String,
    onEditRoutine: () -> Unit,
    onOpenParty: (partyId: String) -> Unit,
    parties: PartyRepository,
    routines: RoutineRepository = remember { RoutineRepository() },
) {
    val now = remember { System.currentTimeMillis() }
    val weekStart = remember { TimeSlots.weekStart(now) }
    val weekEnd = weekStart + 7 * DAY_MS
    val raids by remember(uid, weekStart) { parties.myRaids(uid, weekStart) }.collectAsStateWithLifecycle(emptyList())
    var routine by remember { mutableStateOf<Set<String>>(emptySet()) }

    LaunchedEffect(uid) {
        routine = try {
            routines.load(uid)
        } catch (e: Exception) {
            emptySet()
        }
    }

    // 이번 주 칸 번호(날 × 48 + 행) 중 레이드가 잡힌 칸
    val raidSlots = remember(raids, weekStart) {
        raids.flatMap { raid ->
            val first = Math.floorDiv(raid.startMs - weekStart, TimeSlots.SLOT_MS).toInt()
            val last = Math.floorDiv(raid.endMs - 1 - weekStart, TimeSlots.SLOT_MS).toInt()
            (first..last).filter { it in 0 until 7 * TimeSlots.SLOTS_PER_DAY }
        }.toSet()
    }
    val nowSlot = ((now - weekStart) / TimeSlots.SLOT_MS).toInt()
    val raidColor = MaterialTheme.colorScheme.primary
    val routineColor = MaterialTheme.colorScheme.errorContainer
    val freeColor = MaterialTheme.colorScheme.surfaceVariant

    BoxWithConstraints(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        val cellWidth = (maxWidth - TIME_LABEL_WIDTH) / 7
        LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            item { TabTitle("시간표") }
            item {
                OutlinedButton(onClick = onEditRoutine, modifier = Modifier.fillMaxWidth()) { Text("고정 불가 시간 설정") }
            }

            item {
                Text(
                    "확정된 일정",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
                )
            }
            if (raids.isEmpty()) {
                item { Text("이번 주 이후로 확정된 일정이 없습니다.", style = MaterialTheme.typography.bodyMedium) }
            }
            items(raids, key = { "${it.partyId}-${it.startMs}" }) { raid ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp)
                        .alpha(if (raid.endMs <= now) 0.5f else 1f)
                        .clickable { onOpenParty(raid.partyId) },
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            TimeSlots.range(raid.startMs, raid.endMs) + if (raid.endMs <= now) " · 지남" else "",
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text("${raid.partyName} · ${Bosses.label(raid.bosses)}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            item {
                Column(modifier = Modifier.padding(top = 12.dp)) {
                    Text(
                        "이번 주 (${TimeSlots.dayLabel(weekStart)} ~ ${TimeSlots.dayLabel(weekEnd - 1)})",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Legend(raidColor, "확정 일정")
                        Legend(routineColor, "고정 불가 시간")
                    }
                }
            }
            // 요일 줄은 시간표를 내려도 위에 붙어 있다.
            stickyHeader {
                Row(modifier = Modifier.background(MaterialTheme.colorScheme.surface).padding(vertical = 4.dp)) {
                    Box(Modifier.width(TIME_LABEL_WIDTH))
                    repeat(7) { day ->
                        val dayStart = weekStart + day * DAY_MS
                        Column(modifier = Modifier.width(cellWidth), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(TimeSlots.weekdayLabel(dayStart), style = MaterialTheme.typography.labelMedium)
                            Text(TimeSlots.dayLabel(dayStart), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
            items(TimeSlots.SLOTS_PER_DAY) { row ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (row % 2 == 0) TimeSlots.rowLabel(row) else "",
                        modifier = Modifier.width(TIME_LABEL_WIDTH).padding(end = 6.dp),
                        style = MaterialTheme.typography.labelSmall,
                        textAlign = TextAlign.End,
                    )
                    repeat(7) { day ->
                        val index = day * TimeSlots.SLOTS_PER_DAY + row
                        val weekday = TimeSlots.weekday(weekStart + day * DAY_MS)
                        val color = when {
                            index in raidSlots -> raidColor
                            RoutineRepository.key(weekday, row) in routine -> routineColor
                            else -> freeColor
                        }
                        Box(
                            modifier = Modifier
                                .width(cellWidth)
                                .height(TIMETABLE_CELL_HEIGHT)
                                .padding(horizontal = 1.dp)
                                // 지난 시간은 흐리게
                                .alpha(if (index < nowSlot) 0.4f else 1f)
                                .background(color),
                        )
                    }
                }
            }
            item { Box(Modifier.height(TAB_PADDING)) }
        }
    }
}

@Composable
private fun Legend(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.size(12.dp).background(color))
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun TabTitle(text: String) {
    Text(text, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = TAB_PADDING, bottom = 4.dp))
}
