package com.bossplanner.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
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

private sealed interface Screen {
    data object Home : Screen
    data object CreateParty : Screen
    data object JoinParty : Screen
    data class PartyDetail(val partyId: String) : Screen
    data class EditUnavailable(val partyId: String, val target: UnavailableTarget) : Screen
    data class SettlementDetail(val partyId: String, val periodId: String) : Screen
}

/** 온보딩이 끝난 뒤의 화면들. 홈 → 파티 상세 → 불가 시간 입력 순으로 들어간다. */
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
    var screen by remember { mutableStateOf<Screen>(Screen.Home) }
    var characters by remember { mutableStateOf<List<CharacterInfo>>(emptyList()) }
    val parties by remember(uid) { partyRepository.myParties(uid) }.collectAsStateWithLifecycle(emptyList())
    val raids by remember(uid) { partyRepository.myRaids(uid) }.collectAsStateWithLifecycle(emptyList())

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
        Screen.Home -> HomeScreen(
            profile = profile,
            characters = characters,
            parties = parties,
            raids = raids,
            onOpenParty = { screen = Screen.PartyDetail(it) },
            onCreateParty = { screen = Screen.CreateParty },
            onJoinParty = { screen = Screen.JoinParty },
            onEditCharacters = onEditCharacters,
            onEditApiKey = onEditApiKey,
            onSignOut = onSignOut,
        )
        Screen.CreateParty -> CreatePartyScreen(
            characters = characters,
            onCreated = { screen = Screen.PartyDetail(it) },
            onBack = { screen = Screen.Home },
            parties = partyRepository,
        )
        Screen.JoinParty -> JoinPartyScreen(
            characters = characters,
            onJoined = { screen = Screen.PartyDetail(it) },
            onBack = { screen = Screen.Home },
            parties = partyRepository,
        )
        is Screen.PartyDetail -> PartyScreen(
            uid = uid,
            partyId = current.partyId,
            onEditUnavailable = { screen = Screen.EditUnavailable(current.partyId, it) },
            onOpenSettlement = { screen = Screen.SettlementDetail(current.partyId, it) },
            onBack = { screen = Screen.Home },
            parties = partyRepository,
        )
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
            onDone = { screen = Screen.PartyDetail(current.partyId) },
            parties = partyRepository,
        )
    }
}
