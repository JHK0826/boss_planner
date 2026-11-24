package com.bossplanner.app.ui

import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 화면 아래에 잠깐 뜨는 알림(스낵바)으로 결과를 알린다. MainActivity가 앱 전체에 하나만 둔다. */
fun interface ShowMessage {
    fun show(text: String)
}

val LocalShowMessage = staticCompositionLocalOf { ShowMessage { } }

/**
 * 서버에 보내는 동작을 실행하고 결과를 알림으로 보여 준다.
 *
 * - 성공하면 success 문구를, 실패하면 errorMessage(e) 문구를 띄운다.
 * - 동작 자체는 화면을 벗어나도 끝까지 마친다(예: 탈퇴하면 화면이 바로 닫히지만 알림은 뜬다).
 *
 * @param onBusy 동작이 진행 중인지 화면에 알린다 (버튼 막기용)
 */
fun CoroutineScope.runAction(
    showMessage: ShowMessage,
    onBusy: (Boolean) -> Unit,
    success: String?,
    errorMessage: (Exception) -> String?,
    action: suspend () -> Unit,
) {
    onBusy(true)
    launch {
        try {
            withContext(NonCancellable) { action() }
            success?.let(showMessage::show)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            errorMessage(e)?.let(showMessage::show)
        } finally {
            onBusy(false)
        }
    }
}
