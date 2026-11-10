package com.bossplanner.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bossplanner.app.data.AuthRepository
import com.bossplanner.app.data.UserProfile
import com.bossplanner.app.data.UserRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/** 온보딩 단계: 로그인 → API Key 등록 → 캐릭터 선택 → 홈 */
sealed interface Stage {
    data object Loading : Stage
    data object SignedOut : Stage
    data class NeedApiKey(val uid: String, val canCancel: Boolean) : Stage
    data class NeedCharacters(val uid: String, val profile: UserProfile, val canCancel: Boolean) : Stage
    data class Ready(val uid: String, val profile: UserProfile) : Stage
}

private enum class Editing { None, ApiKey, Characters }

@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModel(
    private val auth: AuthRepository = AuthRepository(),
    private val users: UserRepository = UserRepository(),
) : ViewModel() {

    private val editing = MutableStateFlow(Editing.None)

    private val session = auth.uid.flatMapLatest { uid ->
        if (uid == null) {
            flowOf<Pair<String, UserProfile>?>(null)
        } else {
            users.profile(uid)
                .map<UserProfile, Pair<String, UserProfile>?> { uid to it }
                .catch { emit(uid to UserProfile()) }
        }
    }

    val stage: StateFlow<Stage> = combine<Pair<String, UserProfile>?, Editing, Stage>(session, editing) { session, editing ->
        if (session == null) return@combine Stage.SignedOut
        val (uid, profile) = session
        when {
            !profile.apiKeyRegistered -> Stage.NeedApiKey(uid, canCancel = false)
            editing == Editing.ApiKey -> Stage.NeedApiKey(uid, canCancel = true)
            profile.selectedCharacterIds.isEmpty() -> Stage.NeedCharacters(uid, profile, canCancel = false)
            editing == Editing.Characters -> Stage.NeedCharacters(uid, profile, canCancel = true)
            else -> Stage.Ready(uid, profile)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Stage.Loading)

    fun editApiKey() { editing.value = Editing.ApiKey }
    fun editCharacters() { editing.value = Editing.Characters }
    fun doneEditing() { editing.value = Editing.None }

    fun signOut() {
        editing.value = Editing.None
        auth.signOut()
    }
}
