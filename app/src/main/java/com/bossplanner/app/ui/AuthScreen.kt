package com.bossplanner.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.AuthRepository
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.FirebaseAuthWeakPasswordException
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(auth: AuthRepository = AuthRepository()) {
    var signUpMode by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var displayName by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val valid = email.isNotBlank() && password.length >= 6 &&
        (!signUpMode || displayName.trim().length in 1..20)

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, alignment = androidx.compose.ui.Alignment.CenterVertically),
    ) {
        Text("보스 스케줄 매니저", style = MaterialTheme.typography.headlineMedium)
        Text(
            if (signUpMode) "이메일로 가입합니다." else "이메일로 로그인합니다.",
            style = MaterialTheme.typography.bodyMedium,
        )

        if (signUpMode) {
            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it.take(20) },
                label = { Text("닉네임 (파티원에게 보이는 이름)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        OutlinedTextField(
            value = email,
            onValueChange = { email = it.trim() },
            label = { Text("이메일") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("비밀번호 (6자 이상)") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Button(
            enabled = valid && !busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        if (signUpMode) auth.signUp(email, password, displayName.trim())
                        else auth.signIn(email, password)
                    } catch (e: Exception) {
                        error = authErrorMessage(e)
                    } finally {
                        busy = false
                    }
                }
            },
        ) {
            Text(if (busy) "처리 중…" else if (signUpMode) "가입하기" else "로그인")
        }

        TextButton(
            enabled = !busy,
            onClick = {
                signUpMode = !signUpMode
                error = null
            },
        ) {
            Text(if (signUpMode) "이미 계정이 있습니다" else "처음이신가요? 회원가입")
        }
    }
}

private fun authErrorMessage(e: Exception): String = when (e) {
    is FirebaseAuthWeakPasswordException -> "비밀번호는 6자 이상이어야 합니다."
    is FirebaseAuthUserCollisionException -> "이미 가입된 이메일입니다."
    is FirebaseAuthInvalidUserException -> "가입되지 않은 이메일입니다."
    is FirebaseAuthInvalidCredentialsException -> "이메일 또는 비밀번호가 올바르지 않습니다."
    is FirebaseNetworkException -> "네트워크에 연결할 수 없습니다."
    else -> "로그인하지 못했습니다. 잠시 후 다시 시도해 주세요."
}
