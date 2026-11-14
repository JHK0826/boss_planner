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
import androidx.compose.material3.Icon
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
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.UserProfile
import com.bossplanner.app.data.UserRepository

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
    data class PartyDetail(val partyId: String) : Screen
    data class EditUnavailable(val partyId: String, val target: UnavailableTarget) : Screen
    data class SettlementDetail(val partyId: String, val periodId: String) : Screen
    data object Routine : Screen
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
) {
    var tab by rememberSaveable { mutableStateOf(Tab.Parties) }
    var screen by remember { mutableStateOf<Screen?>(null) }
    var characters by remember { mutableStateOf<List<CharacterInfo>>(emptyList()) }
    val parties by remember(uid) { partyRepository.myParties(uid) }.collectAsStateWithLifecycle(emptyList())

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

    when (val current = screen) {
        null -> Column(modifier = Modifier.fillMaxSize()) {
            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                when (tab) {
                    Tab.Characters -> CharactersTab(characters = characters, onEditCharacters = onEditCharacters)
                    Tab.Parties -> PartiesTab(
                        parties = parties,
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
                        icon = { Icon(item.icon, contentDescription = null) },
                        label = { Text(item.label) },
                    )
                }
            }
        }
        Screen.CreateParty -> CreatePartyScreen(
            uid = uid,
            characters = characters,
            myParties = parties,
            onCreated = { screen = Screen.PartyDetail(it) },
            onBack = { screen = null },
            parties = partyRepository,
        )
        Screen.JoinParty -> JoinPartyScreen(
            characters = characters,
            onJoined = { screen = Screen.PartyDetail(it) },
            onBack = { screen = null },
            parties = partyRepository,
        )
        is Screen.PartyDetail -> PartyScreen(
            uid = uid,
            partyId = current.partyId,
            onEditUnavailable = { screen = Screen.EditUnavailable(current.partyId, it) },
            onOpenSettlement = { screen = Screen.SettlementDetail(current.partyId, it) },
            onBack = { screen = null },
            parties = partyRepository,
        )
        Screen.Routine -> RoutineScreen(uid = uid, onDone = { screen = null })
        is Screen.SettlementDetail -> SettlementScreen(
            uid = uid,
            partyId = current.partyId,
            periodId = current.periodId,
            onBack = { screen = Screen.PartyDetail(current.partyId) },
            parties = partyRepository,
        )
        is Screen.EditUnavailable -> UnavailableScreen(
            uid = uid,
            partyId = current.partyId,
            target = current.target,
            otherParties = parties.filter { it.id != current.partyId },
            onDone = { screen = Screen.PartyDetail(current.partyId) },
            parties = partyRepository,
        )
    }
}
