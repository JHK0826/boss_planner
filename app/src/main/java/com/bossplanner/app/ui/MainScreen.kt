package com.bossplanner.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.runtime.produceState
import com.bossplanner.app.data.PartySnapshot
import com.bossplanner.app.data.PartyStatuses
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.bossplanner.app.push.Push
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bossplanner.app.data.CharacterInfo
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.EarningsRepository
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.UserProfile
import com.bossplanner.app.data.UserRepository
import com.bossplanner.app.data.userMessage

/** 하단 메뉴. 순서대로 보인다. */
private enum class Tab(val label: String, val icon: ImageVector) {
    Characters("내 캐릭터", Icons.Filled.Face),
    Parties("파티", Icons.Filled.List),
    Timetable("시간표", Icons.Filled.DateRange),
    Settings("설정", Icons.Filled.Settings),
}

/** 메뉴에서 더 들어간 화면. 이 화면들이 떠 있는 동안에는 하단 메뉴를 숨긴다. */
private sealed interface Screen {
    data object CreateParty : Screen
    data object JoinParty : Screen
    /** @param tab 처음 보여 줄 탭. null이면 할 일이 있는 탭을 연다. */
    data class PartyDetail(val partyId: String, val tab: PartyTab? = null) : Screen
    data class EditUnavailable(val partyId: String, val target: UnavailableTarget) : Screen
    data object Routine : Screen
    data class Earnings(val characterId: String) : Screen
}

/**
 * 온보딩이 끝난 뒤의 화면들.
 * 하단 메뉴 네 개(내 캐릭터 / 파티 / 시간표 / 설정)가 기본이고, 파티 상세·불가 시간 입력·정산 등은 그 위에 뜬다.
 */
@Composable
fun MainScreen(
    uid: String,
    profile: UserProfile,
    openPartyId: String?,
    onPartyOpened: () -> Unit,
    onEditCharacters: () -> Unit,
    onEditApiKey: () -> Unit,
    onSignOut: () -> Unit,
    users: UserRepository = remember { UserRepository() },
    partyRepository: PartyRepository = remember { PartyRepository() },
    earningsRepository: EarningsRepository = remember { EarningsRepository() },
) {
    var tab by rememberSaveable { mutableStateOf(Tab.Parties) }
    // 파티 목록의 캐릭터 선택과 정렬. 다른 메뉴나 파티 화면에 다녀와도 유지한다.
    var partyFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var partySort by rememberSaveable { mutableStateOf(PartySort.Todo) }
    var screen by remember { mutableStateOf<Screen?>(null) }
    // null = 아직 받아 오는 중. 빈 목록과 구분해서 로딩 표시를 보여 준다.
    var characters by remember { mutableStateOf<List<CharacterInfo>?>(null) }
    val loadedParties by remember(uid) { partyRepository.myParties(uid) }
        .collectAsStateWithLifecycle<List<Party>?>(null)
    val parties = loadedParties.orEmpty()

    // 파티마다 내가 할 일.
    // 일정 데이터는 파티 탭을 보고 있고 앱이 화면에 떠 있을 때만 지켜본다. 다른 화면에 있는 동안은
    // 마지막으로 읽은 값을 그대로 쓰므로, 하단 메뉴의 숫자는 파티 탭에 돌아올 때 새로 맞춰진다.
    // 파티 목록(구성)이 바뀔 때만 다시 구독한다.
    val partyIds = parties.map { it.id }
    var snapshots by remember { mutableStateOf<Map<String, PartySnapshot>>(emptyMap()) }
    val watchStatuses = screen == null && tab == Tab.Parties
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(partyIds, watchStatuses) {
        snapshots = snapshots.filterKeys { it in partyIds }
        if (!watchStatuses || partyIds.isEmpty()) return@LaunchedEffect
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            combine(partyIds.map { id -> partyRepository.partySnapshot(id).map { id to it } }) { it.toMap() }
                .collect { snapshots = it }
        }
    }
    // 레이드 시작처럼 시간이 지나서 바뀌는 할 일이 있어 1분마다 다시 계산한다.
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(60_000)
            value = System.currentTimeMillis()
        }
    }
    val statuses = parties.associate { it.id to PartyStatuses.of(uid, it, snapshots[it.id], now) }
    val todoCount = statuses.values.count { it?.needsAction == true }

    // 알림 권한을 묻고(Android 13 이상) 이 기기를 알림 대상으로 등록한다.
    val context = LocalContext.current
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(uid) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        runCatching { Push.register(uid) }
    }

    // 알림을 눌러 들어오면 그 파티 화면을 연다.
    LaunchedEffect(openPartyId) {
        if (openPartyId != null) {
            tab = Tab.Parties
            screen = Screen.PartyDetail(openPartyId)
            onPartyOpened()
        }
    }

    LaunchedEffect(uid, profile.selectedCharacterIds) {
        characters = try {
            users.cachedCharacters(uid, profile.selectedCharacterIds)
        } catch (e: Exception) {
            emptyList()
        }
    }

    // 게임 스케줄러: 내 캐릭터 탭이나 수익 화면을 처음 열 때 받는다. 서버가 10분 동안 저장해 두므로 NEXON 호출은 적다.
    var scheduler by remember(profile.selectedCharacterIds) { mutableStateOf(SchedulerUiState()) }
    var schedulerRequest by remember(profile.selectedCharacterIds) { mutableStateOf<Boolean?>(null) }
    val wantsScheduler = (screen == null && tab == Tab.Characters) || screen is Screen.Earnings
    LaunchedEffect(wantsScheduler, profile.selectedCharacterIds) {
        if (wantsScheduler && scheduler.characters == null && schedulerRequest == null) schedulerRequest = false
    }
    LaunchedEffect(schedulerRequest) {
        val refresh = schedulerRequest ?: return@LaunchedEffect
        scheduler = scheduler.copy(loading = true)
        scheduler = try {
            SchedulerUiState(characters = earningsRepository.schedulerState(refresh), loading = false, error = null)
        } catch (e: Exception) {
            scheduler.copy(loading = false, error = e.userMessage())
        }
        schedulerRequest = null
    }

    when (val current = screen) {
        null -> Column(modifier = Modifier.fillMaxSize()) {
            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                when (tab) {
                    Tab.Characters -> CharactersTab(
                        characters = characters,
                        scheduler = scheduler,
                        onRefresh = { if (schedulerRequest == null) schedulerRequest = true },
                        onOpenEarnings = { screen = Screen.Earnings(it) },
                        onEditCharacters = onEditCharacters,
                    )
                    Tab.Parties -> PartiesTab(
                        uid = uid,
                        // 목록을 받기 전에는 null을 넘겨 로딩 표시를 보여 준다.
                        loadedParties = loadedParties,
                        statuses = statuses,
                        characterFilter = partyFilter,
                        onCharacterFilterChange = { partyFilter = it },
                        sort = partySort,
                        onSortChange = { partySort = it },
                        onOpenParty = { screen = Screen.PartyDetail(it) },
                        onCreateParty = { screen = Screen.CreateParty },
                        onJoinParty = { screen = Screen.JoinParty },
                    )
                    Tab.Timetable -> TimetableTab(
                        uid = uid,
                        onEditRoutine = { screen = Screen.Routine },
                        onOpenParty = { screen = Screen.PartyDetail(it) },
                        parties = partyRepository,
                    )
                    Tab.Settings -> SettingsTab(profile = profile, onEditApiKey = onEditApiKey, onSignOut = onSignOut)
                }
            }
            // 화면 가장자리 여백은 MainActivity가 이미 주고 있어서 여기서는 더하지 않는다.
            NavigationBar(windowInsets = WindowInsets(0, 0, 0, 0)) {
                Tab.entries.forEach { item ->
                    NavigationBarItem(
                        selected = item == tab,
                        onClick = { tab = item },
                        icon = {
                            // 파티 메뉴에는 할 일이 있는 파티 수를 붙인다.
                            if (item == Tab.Parties && todoCount > 0) {
                                BadgedBox(badge = { Badge { Text("$todoCount") } }) { Icon(item.icon, contentDescription = null) }
                            } else {
                                Icon(item.icon, contentDescription = null)
                            }
                        },
                        label = { Text(item.label) },
                    )
                }
            }
        }
        Screen.CreateParty -> CreatePartyScreen(
            uid = uid,
            characters = characters.orEmpty(),
            myParties = parties,
            onCreated = { screen = Screen.PartyDetail(it) },
            onBack = { screen = null },
            parties = partyRepository,
        )
        Screen.JoinParty -> JoinPartyScreen(
            characters = characters.orEmpty(),
            onJoined = { screen = Screen.PartyDetail(it) },
            onBack = { screen = null },
            parties = partyRepository,
        )
        is Screen.PartyDetail -> PartyScreen(
            uid = uid,
            partyId = current.partyId,
            initialTab = current.tab,
            onEditUnavailable = { screen = Screen.EditUnavailable(current.partyId, it) },
            onBack = { screen = null },
            parties = partyRepository,
        )
        Screen.Routine -> RoutineScreen(uid = uid, onDone = { screen = null })
        is Screen.Earnings -> EarningsScreen(
            uid = uid,
            character = characters?.firstOrNull { it.id == current.characterId },
            characterId = current.characterId,
            scheduler = scheduler,
            onBack = { screen = null },
            repository = earningsRepository,
        )
        is Screen.EditUnavailable -> UnavailableScreen(
            uid = uid,
            partyId = current.partyId,
            target = current.target,
            otherParties = parties.filter { it.id != current.partyId },
            // 끝나면 파티 화면의 투표 탭으로 돌아간다.
            onDone = { screen = Screen.PartyDetail(current.partyId, PartyTab.Schedule) },
            parties = partyRepository,
        )
    }
}
