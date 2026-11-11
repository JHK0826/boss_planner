package com.bossplanner.app.ui

import androidx.compose.runtime.Composable
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
}

/** 온보딩이 끝난 뒤의 화면들. 홈 → 파티 상세 → 불가 시간 입력 순으로 들어간다. */
@Composable
fun MainScreen(
    uid: String,
    profile: UserProfile,
    onEditCharacters: () -> Unit,
    onEditApiKey: () -> Unit,
    onSignOut: () -> Unit,
    users: UserRepository = remember { UserRepository() },
    partyRepository: PartyRepository = remember { PartyRepository() },
) {
    var screen by remember { mutableStateOf<Screen>(Screen.Home) }
    var characters by remember { mutableStateOf<List<CharacterInfo>>(emptyList()) }
    val parties by remember(uid) { partyRepository.myParties(uid) }.collectAsStateWithLifecycle(emptyList())

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
            onBack = { screen = Screen.Home },
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
