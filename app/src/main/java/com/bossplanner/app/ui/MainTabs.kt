package com.bossplanner.app.ui

import com.bossplanner.app.data.Timeline
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.draw.clip
import androidx.compose.material3.FilterChip
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Switch
import com.bossplanner.app.data.PartyStatus
import androidx.compose.material3.Surface
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.bossplanner.app.data.Bosses
import com.bossplanner.app.data.CharacterInfo
import com.bossplanner.app.data.CharacterScheduler
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.PartyMember
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.Raid
import com.bossplanner.app.data.RoutineRepository
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.UserProfile

private val TAB_PADDING = 24.dp

/** 게임 스케줄러를 받아 오는 상태 (MainScreen이 들고 있다) */
data class SchedulerUiState(
    val characters: Map<String, CharacterScheduler>? = null,
    val loading: Boolean = false,
    val error: String? = null,
)

/** 내 캐릭터: 골라 둔 캐릭터와 게임 스케줄러에 등록한 보스(클리어 여부, 파티 인원수)를 본다. */
@Composable
fun CharactersTab(
    characters: List<CharacterInfo>?,
    scheduler: SchedulerUiState,
    onRefresh: () -> Unit,
    onOpenEarnings: (characterId: String) -> Unit,
    onEditCharacters: () -> Unit,
) {
    val fetchedAt = scheduler.characters?.values?.mapNotNull { it.fetchedAtMs }?.minOrNull()
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = TAB_PADDING),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { TabTitle("내 캐릭터") }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when {
                        scheduler.loading -> "스케줄러를 받아 오는 중…"
                        fetchedAt != null -> "게임 스케줄러 · ${TimeSlots.dateTime(fetchedAt)} 기준"
                        else -> "게임 스케줄러"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                TextButton(enabled = !scheduler.loading, onClick = onRefresh) { Text("새로고침") }
            }
            scheduler.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
        when {
            characters == null -> item { Loading() }
            characters.isEmpty() -> item { Text("선택한 캐릭터가 없습니다.", style = MaterialTheme.typography.bodyMedium) }
        }
        items(characters.orEmpty(), key = { it.id }) { character ->
            val state = scheduler.characters?.get(character.id)
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.Top) {
                        AsyncImage(model = character.imageUrl, contentDescription = null, modifier = Modifier.size(72.dp))
                        Column(modifier = Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(character.name, style = MaterialTheme.typography.titleMedium)
                            Text("Lv.${character.level} · ${character.job}", style = MaterialTheme.typography.bodyMedium)
                            Text(
                                listOfNotNull(character.world, character.guild?.takeIf { it.isNotBlank() }).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                            )
                            if (state != null) {
                                Text(
                                    "주간 ${state.bosses.count { it.isWeekly }} · 월간 ${state.bosses.count { !it.isWeekly }}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        TextButton(onClick = { onOpenEarnings(character.id) }) { Text("수익 보기") }
                    }
                    state?.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                    if (state != null && state.bosses.isNotEmpty()) BossChips(state.bosses)
                    if (state != null && state.bosses.isEmpty() && state.error == null) {
                        Text("게임 스케줄러에 등록한 보스가 없습니다.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        item {
            OutlinedButton(onClick = onEditCharacters, modifier = Modifier.fillMaxWidth()) {
                Text("캐릭터 다시 선택")
            }
        }
        // NEXON Open API 이용 조건: 받은 데이터를 보여 주는 화면에 출처를 적는다.
        item {
            Text(
                NEXON_ATTRIBUTION,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = TAB_PADDING),
            )
        }
    }
}

/** 파티 목록 정렬 */
enum class PartySort(val label: String) {
    Todo("할 일 먼저"),
    Character("캐릭터순"),
    Name("파티 이름순"),
    Recent("최근 가입순"),
}

/**
 * 파티: 내 파티 목록, 파티 만들기, 초대 코드로 가입.
 * 캐릭터를 골라 그 캐릭터가 들어간 파티만 볼 수 있고, 목록을 정렬할 수 있다.
 *
 * @param characterFilter 이 캐릭터(characterId)가 들어간 파티만 본다. null이면 전체
 */
@Composable
fun PartiesTab(
    uid: String,
    /** 내 파티 목록. 아직 받아 오는 중이면 null */
    loadedParties: List<Party>?,
    /** 파티별 상태 (내가 할 일). 아직 못 읽은 파티는 null */
    statuses: Map<String, PartyStatus?>,
    characterFilter: String?,
    onCharacterFilterChange: (String?) -> Unit,
    sort: PartySort,
    onSortChange: (PartySort) -> Unit,
    onOpenParty: (partyId: String) -> Unit,
    onCreateParty: () -> Unit,
    onJoinParty: () -> Unit,
) {
    val parties = loadedParties.orEmpty()
    // 내 파티에 들어가 있는 내 캐릭터들 (레벨 높은 순)과 캐릭터별 파티 수
    val myCharacters = parties.mapNotNull { it.members[uid] }
        .distinctBy { it.characterId }
        .sortedWith(compareByDescending<PartyMember> { it.level }.thenBy { it.characterName })
    val partyCount = parties.groupingBy { it.members[uid]?.characterId }.eachCount()
    // 고른 캐릭터의 파티가 없어졌으면(탈퇴 등) 전체로 돌아간다.
    val activeFilter = characterFilter?.takeIf { id -> myCharacters.any { it.characterId == id } }
    LaunchedEffect(activeFilter, characterFilter) {
        if (characterFilter != null && activeFilter == null) onCharacterFilterChange(null)
    }

    val mine = { party: Party -> party.members[uid] }
    val shown = parties
        .filter { activeFilter == null || mine(it)?.characterId == activeFilter }
        .let { list ->
            val byCharacter = compareByDescending<Party> { mine(it)?.level ?: 0 }
                .thenBy { mine(it)?.characterName.orEmpty() }
                .thenBy { it.name }
            when (sort) {
                PartySort.Todo -> list.sortedWith(
                    compareByDescending<Party> { statuses[it.id]?.needsAction == true }.then(byCharacter),
                )
                PartySort.Character -> list.sortedWith(byCharacter)
                PartySort.Name -> list.sortedBy { it.name }
                PartySort.Recent -> list.sortedByDescending { mine(it)?.joinedAtMs ?: 0 }
            }
        }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = TAB_PADDING),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item { TabTitle("파티") }
        val todoCount = statuses.values.count { it?.needsAction == true }
        if (todoCount > 0) {
            item {
                Text(
                    "할 일이 있는 파티 ${todoCount}개",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onCreateParty, modifier = Modifier.weight(1f)) { Text("파티 만들기") }
                OutlinedButton(onClick = onJoinParty, modifier = Modifier.weight(1f)) { Text("코드로 가입") }
            }
        }
        if (loadedParties == null) {
            item { Loading() }
        } else if (parties.isEmpty()) {
            item { Text("아직 가입한 파티가 없습니다.", style = MaterialTheme.typography.bodyMedium) }
        } else {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val selected = myCharacters.firstOrNull { it.characterId == activeFilter }
                    Dropdown(
                        label = selected?.let { "${it.characterName} (${partyCount[it.characterId] ?: 0})" }
                            ?: "전체 캐릭터 (${parties.size})",
                        options = listOf("전체 캐릭터 (${parties.size})") +
                            myCharacters.map { "${it.characterName} · Lv.${it.level} (${partyCount[it.characterId] ?: 0})" },
                        enabled = true,
                        onSelect = { index -> onCharacterFilterChange(if (index == 0) null else myCharacters[index - 1].characterId) },
                        modifier = Modifier.weight(1f),
                        fillWidth = true,
                    )
                    Dropdown(
                        label = sort.label,
                        options = PartySort.entries.map { it.label },
                        enabled = true,
                        onSelect = { onSortChange(PartySort.entries[it]) },
                    )
                }
            }
        }
        items(shown, key = { it.id }) { party ->
            val me = mine(party)
            Card(modifier = Modifier.fillMaxWidth().clickable { onOpenParty(party.id) }) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    statuses[party.id]?.takeIf { it.text.isNotEmpty() }?.let { StatusBadge(it) }
                    Text(party.name, style = MaterialTheme.typography.titleMedium)
                    Text(party.bossLabel, style = MaterialTheme.typography.bodyMedium)
                    Text(
                        listOfNotNull(
                            if (party.isWeekly) "주간" else "월간",
                            "${party.memberUids.size}명",
                            me?.let { "내 캐릭터 ${it.characterName} (Lv.${it.level})" },
                        ).joinToString(" · "),
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
fun SettingsTab(profile: UserProfile, onOpenGuide: () -> Unit, onEditApiKey: () -> Unit, onSignOut: () -> Unit) {
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
        val theme = LocalThemeSetting.current
        Row(
            modifier = Modifier.fillMaxWidth().clickable { theme.onChange(!theme.dark) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("다크 모드", style = MaterialTheme.typography.titleSmall)
                Text(
                    if (theme.followsSystem) "휴대폰 설정을 따르는 중" else "앱에서 직접 설정함",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = theme.dark, onCheckedChange = null)
        }
        if (!theme.followsSystem) {
            TextButton(onClick = { theme.onChange(null) }) { Text("휴대폰 설정 따르기") }
        }
        OutlinedButton(onClick = onOpenGuide, modifier = Modifier.fillMaxWidth()) { Text("사용 가이드") }
        OutlinedButton(onClick = onEditApiKey, modifier = Modifier.fillMaxWidth()) { Text("API Key 다시 등록") }
        OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("로그아웃") }
        // 파티원끼리 같은 버전을 쓰는지 확인할 수 있게 보여 준다.
        Text("버전 $version", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(NEXON_ATTRIBUTION, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** NEXON Open API 출처 표기 (이용 조건) */
private const val NEXON_ATTRIBUTION = "Data based on NEXON Open API"

private const val DAY_MS = TimeSlots.SLOTS_PER_DAY * TimeSlots.SLOT_MS

/**
 * 시간표: 고정 불가 시간을 설정하고, 이번 주·다음 주(목~수)의 확정 일정을 가로 타임라인으로 한눈에 본다.
 * 파티마다 색이 다르고, 레이드가 없는 시간은 접는다. 파티마다 따로 제출한 불가 시간은 여기에 나오지 않는다.
 */
@OptIn(ExperimentalLayoutApi::class)
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
    var nextWeek by remember { mutableStateOf(false) }
    val shownStart = if (nextWeek) weekStart + 7 * DAY_MS else weekStart
    // null = 아직 받아 오는 중. 이번 주 시작부터 이후 전부라 다음 주 확정 일정도 들어 있다.
    val loadedRaids by remember(uid, weekStart) { parties.myRaids(uid, weekStart) }
        .collectAsStateWithLifecycle<List<Raid>?>(null)
    val raids = loadedRaids.orEmpty()
    var routine by remember { mutableStateOf<Set<String>>(emptySet()) }

    LaunchedEffect(uid) {
        routine = try {
            routines.load(uid)
        } catch (e: Exception) {
            emptySet()
        }
    }

    val layout = remember(raids, shownStart, routine) { Timeline.layout(raids, shownStart, routine, now) }
    val colors = remember(raids) { Timeline.partyColors(raids) }

    LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        item { TabTitle("시간표") }
        item {
            OutlinedButton(onClick = onEditRoutine, modifier = Modifier.fillMaxWidth()) { Text("고정 불가 시간 설정") }
        }

        item {
            Column(modifier = Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "${if (nextWeek) "다음 주" else "이번 주"} (${TimeSlots.dayLabel(shownStart)} ~ ${TimeSlots.dayLabel(shownStart + 7 * DAY_MS - 1)})",
                    style = MaterialTheme.typography.titleMedium,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !nextWeek, onClick = { nextWeek = false }, label = { Text("이번 주") })
                    FilterChip(selected = nextWeek, onClick = { nextWeek = true }, label = { Text("다음 주") })
                }
            }
        }
        if (loadedRaids == null) {
            item { Loading() }
        } else {
            item { RaidTimeline(layout, onOpenParty) }
            item {
                FlowRow(
                    modifier = Modifier.padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    layout.parties.forEach { party -> Legend(partyColor(party.colorIndex), party.partyName, round = true) }
                    Legend(routineColor(), "고정 불가 시간")
                }
            }
            if (layout.bars.isEmpty()) {
                item {
                    Text(
                        "이 주에 확정된 일정이 없습니다.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }

        item {
            Text(
                "확정된 일정",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
            )
        }
        if (loadedRaids == null) {
            item { Loading() }
        } else if (raids.isEmpty()) {
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
                Row(modifier = Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        Modifier
                            .padding(top = 5.dp)
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(partyColor(colors[raid.partyId] ?: 0)),
                    )
                    Column {
                        Text(
                            TimeSlots.range(raid.startMs, raid.endMs) + if (raid.endMs <= now) " · 지남" else "",
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text("${raid.partyName} · ${Bosses.label(raid.bosses)}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        item { Box(Modifier.height(TAB_PADDING)) }
    }
}

@Composable
internal fun Legend(color: Color, label: String, round: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.size(12.dp).clip(if (round) CircleShape else RectangleShape).background(color))
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}

/** 파티 카드 맨 위의 상태 표시. 내가 할 일이면 강조색, 기다리는 중이면 흐린 색 */
@Composable
private fun StatusBadge(status: PartyStatus) {
    val action = status.needsAction
    Surface(
        color = if (action) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(6.dp),
    ) {
        Text(
            if (action) "할 일 · ${status.text}" else status.text,
            style = MaterialTheme.typography.labelMedium,
            color = if (action) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

/** 목록을 받아 오는 동안 보여 주는 표시 */
@Composable
internal fun Loading() {
    Box(modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun TabTitle(text: String) {
    Text(text, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = TAB_PADDING, bottom = 4.dp))
}
