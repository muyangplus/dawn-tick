package com.dawntick.app.reminder

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * 提醒的定时（R-07）：用 AlarmManager 精确闹钟投递，应用关闭后仍可送达。
 * 精确闹钟未授权时退化为 `setAndAllowWhileIdle`，时间可能被系统延后。
 */
internal object ReminderAlarms {
    fun schedule(context: Context, record: ReminderRecord) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = pendingIntent(context, record.id)
        val at = maxOf(record.at, System.currentTimeMillis() + 200L)
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
        try {
            if (exact) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            }
        } catch (_: SecurityException) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        }
    }

    fun cancel(context: Context, id: Long) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = pendingIntent(context, id)
        pending.cancel()
        manager.cancel(pending)
    }

    private fun pendingIntent(context: Context, id: Long): PendingIntent {
        val intent = Intent(context, ReminderAlarmReceiver::class.java).apply {
            action = ReminderStore.ACTION_ALARM
            putExtra(ReminderStore.EXTRA_ID, id)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, id.toInt(), intent, flags)
    }
}
