package com.bossplanner.app.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.bossplanner.app.R
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

/** 알림 데이터에 담겨 오는 파티 ID. 알림을 누르면 그 파티 화면을 연다. */
const val EXTRA_PARTY_ID = "partyId"

object Push {
    fun ensureChannel(context: Context) {
        val channel = NotificationChannel(
            context.getString(R.string.notification_channel_id),
            context.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /**
     * 이 기기의 FCM 토큰을 users/{uid}/devices/{token}에 저장한다.
     * 토큰을 문서 ID로 써서 같은 기기가 두 번 등록되지 않게 한다.
     */
    suspend fun register(uid: String) {
        saveToken(uid, FirebaseMessaging.getInstance().token.await())
    }

    fun saveToken(uid: String, token: String) {
        deviceRef(uid, token).set(mapOf("platform" to "android", "updatedAt" to FieldValue.serverTimestamp()))
    }

    /** 로그아웃할 때 이 기기로 알림이 가지 않게 토큰을 지운다. */
    suspend fun unregister(uid: String) {
        deviceRef(uid, FirebaseMessaging.getInstance().token.await()).delete().await()
    }

    private fun deviceRef(uid: String, token: String) =
        FirebaseFirestore.getInstance().collection("users").document(uid).collection("devices").document(token)
}
