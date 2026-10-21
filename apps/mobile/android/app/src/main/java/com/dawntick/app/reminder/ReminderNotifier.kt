package com.dawntick.app.reminder

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.dawntick.app.MainActivity

/**
 * 提醒通知的构建与投递（R-07）：只接管提醒通知，A-* 的 LocalNotifications 其它用途保持原样。
 *
 * 通知上的三个按钮由 [ReminderActionTable] 决定；点按钮发的是显式广播，
 * 交给 [ReminderActionReceiver] 处理后再通过动态广播通知 WebView。
 */
internal object ReminderNotifier {
    const val CHANNEL_ID = "dawntick-reminders"
    private const val CHANNEL_NAME = "提醒"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
            description = "课前提醒与日程提醒"
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    fun show(context: Context, record: ReminderRecord) {
        ensureChannel(context)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(record.title)
            .setContentText(record.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(record.body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openIntent(context))

        for ((index, action) in ReminderActionTable.ids(record.kind).withIndex()) {
            builder.addAction(0, ReminderActionTable.label(action), actionIntent(context, record.id, action, index))
        }

        try {
            NotificationManagerCompat.from(context).notify(record.id.toInt(), builder.build())
        } catch (_: SecurityException) {
            // 用户没给 POST_NOTIFICATIONS：静默失败，权限状态由设置页负责提示
        }
    }

    fun cancel(context: Context, id: Long) {
        try {
            NotificationManagerCompat.from(context).cancel(id.toInt())
        } catch (_: SecurityException) {
            // 同上：没有权限时本来就没有通知
        }
    }

    private fun actionIntent(context: Context, id: Long, action: String, index: Int): PendingIntent {
        val intent = Intent(context, ReminderActionReceiver::class.java).apply {
            this.action = ReminderStore.ACTION_BUTTON
            putExtra(ReminderStore.EXTRA_ID, id)
            putExtra(ReminderStore.EXTRA_ACTION, action)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        // 通知 id 与动作序号拼出唯一 requestCode，避免多个动作互相覆盖
        return PendingIntent.getBroadcast(context, (id % 1_000_000L).toInt() * 10 + index, intent, flags)
    }

    private fun openIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
