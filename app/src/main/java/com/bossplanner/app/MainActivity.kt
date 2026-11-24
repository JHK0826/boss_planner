package com.bossplanner.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import com.bossplanner.app.ui.LocalShowMessage
import com.bossplanner.app.ui.ShowMessage
import kotlinx.coroutines.launch
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.bossplanner.app.ui.ApiKeyScreen
import com.bossplanner.app.ui.AuthScreen
import com.bossplanner.app.ui.CharacterSelectScreen
import com.bossplanner.app.push.EXTRA_PARTY_ID
import com.bossplanner.app.push.Push
import com.bossplanner.app.ui.MainScreen

class MainActivity : ComponentActivity() {
    /** 알림을 눌러 들어왔을 때 열 파티 */
    private var openPartyId by mutableStateOf<String?>(null)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_PARTY_ID)?.let { openPartyId = it }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Push.ensureChannel(this)
        if (savedInstanceState == null) openPartyId = intent.getStringExtra(EXTRA_PARTY_ID)
        enableEdgeToEdge()
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    // 결과 알림(스낵바)은 앱 전체에 하나만 두고, 화면이 바뀌어도 이어서 보이게 한다.
                    val snackbar = remember { SnackbarHostState() }
                    val scope = rememberCoroutineScope()
                    val showMessage = remember {
                        ShowMessage { text ->
                            scope.launch {
                                snackbar.currentSnackbarData?.dismiss()
                                snackbar.showSnackbar(text)
                            }
                        }
                    }
                    CompositionLocalProvider(LocalShowMessage provides showMessage) {
                        Box(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                            App(openPartyId = openPartyId, onPartyOpened = { openPartyId = null })
                            // 하단 메뉴 바 위에 뜨도록 띄운다.
                            SnackbarHost(snackbar, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 80.dp))
                        }
                    }
                }
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun App(openPartyId: String?, onPartyOpened: () -> Unit, viewModel: AppViewModel = viewModel()) {
    val stage by viewModel.stage.collectAsStateWithLifecycle()
    when (val current = stage) {
        Stage.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        Stage.SignedOut -> AuthScreen()
        is Stage.NeedApiKey -> ApiKeyScreen(
            onRegistered = viewModel::doneEditing,
            onCancel = if (current.canCancel) viewModel::doneEditing else null,
            onSignOut = viewModel::signOut,
        )
        is Stage.NeedCharacters -> CharacterSelectScreen(
            uid = current.uid,
            initiallySelected = current.profile.selectedCharacterIds,
            onSaved = viewModel::doneEditing,
            onCancel = if (current.canCancel) viewModel::doneEditing else null,
        )
        is Stage.Ready -> MainScreen(
            uid = current.uid,
            profile = current.profile,
            openPartyId = openPartyId,
            onPartyOpened = onPartyOpened,
            onEditCharacters = viewModel::editCharacters,
            onEditApiKey = viewModel::editApiKey,
            onSignOut = viewModel::signOut,
        )
    }
}
