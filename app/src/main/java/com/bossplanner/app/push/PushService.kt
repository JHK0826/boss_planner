package com.bossplanner.app.push

import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.bossplanner.app.MainActivity
import com.bossplanner.app.R
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class PushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        FirebaseAuth.getInstance().currentUser?.uid?.let { Push.saveToken(it, token) }
    }

    /** 앱이 켜져 있을 때 온 알림. 백그라운드일 때는 시스템이 직접 띄운다. */
    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        val manager = NotificationManagerCompat.from(this)
        if (!manager.areNotificationsEnabled()) return
        Push.ensureChannel(this)

        val partyId = message.data[EXTRA_PARTY_ID]
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_PARTY_ID, partyId)
        val pendingIntent = PendingIntent.getActivity(
            this,
            partyId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val built = NotificationCompat.Builder(this, getString(R.string.notification_channel_id))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(notification.title)
            .setContentText(notification.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(notification.body))
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()
        try {
            manager.notify(System.currentTimeMillis().toInt(), built)
        } catch (e: SecurityException) {
            // 알림 권한이 방금 꺼진 경우. 보여 줄 수 없으니 넘어간다.
        }
    }
}
