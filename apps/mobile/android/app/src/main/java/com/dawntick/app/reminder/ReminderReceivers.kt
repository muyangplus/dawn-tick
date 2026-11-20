package com.dawntick.app.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.dawntick.app.diag.NativeLog

private const val SCOPE = "reminder"

/** 闹钟到点：取回排定记录并投递通知；静音窗口内直接丢弃。 */
class ReminderAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getLongExtra(ReminderStore.EXTRA_ID, -1L)
        if (id < 0) return
        NativeLog.debug(context, SCOPE, "ReminderAlarmReceiver.onReceive 闹钟到点 id=$id")
        val record = ReminderStore.find(context, id)
        if (record == null) {
            NativeLog.warn(context, SCOPE, "ReminderAlarmReceiver.onReceive 没有对应的提醒记录 id=$id")
            return
        }
        if (ReminderStore.isMuted(context, record.targetId)) {
            NativeLog.debug(context, SCOPE, "ReminderAlarmReceiver.onReceive 勿扰中，已丢弃提醒 id=$id")
            ReminderStore.remove(context, id)
            return
        }
        // 闹钟可能比排定时刻早一点醒（系统合并/重启），到点前就再排一次
        if (record.at > System.currentTimeMillis() + 1_000L) {
            ReminderAlarms.schedule(context, record)
            return
        }
        ReminderNotifier.show(context, record)
    }
}

/** 开机/应用更新后系统会清掉 AlarmManager 闹钟：把持久化里的提醒重新排一遍。 */
class ReminderBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val records = ReminderStore.list(context)
        for (record in records) {
            ReminderAlarms.schedule(context, record)
        }
        NativeLog.debug(context, SCOPE, "ReminderBootReceiver.onReceive 已重新排定提醒 count=${records.size} trigger=${intent.action}")
    }
}

/**
 * 通知动作按钮：先由原生立即执行（贪睡重排、完成/勿扰取消），
 * 再把动作写入队列并广播给 WebView；WebView 不在线时队列等下次 `pollActions`。
 */
class ReminderActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getLongExtra(ReminderStore.EXTRA_ID, -1L)
        val action = intent.getStringExtra(ReminderStore.EXTRA_ACTION) ?: return
        if (id < 0) return
        ReminderActionHandler.apply(context, id, action)
    }
}

internal object ReminderActionHandler {
    private val handlers: Map<String, (Context, ReminderRecord) -> Unit> = mapOf(
        ReminderActionTable.SNOOZE to { context, record -> snooze(context, record) },
        ReminderActionTable.DONE to { context, record -> done(context, record) },
        ReminderActionTable.MUTE to { context, record -> mute(context, record) },
    )

    fun apply(context: Context, id: Long, action: String): Boolean {
        val record = ReminderStore.find(context, id)
        if (record == null) {
            NativeLog.warn(context, SCOPE, "ReminderActionHandler.apply 没有对应的提醒记录 id=$id action=$action")
            return false
        }
        val handler = handlers[action]
        if (handler == null || !ReminderActionTable.supports(record.kind, action)) {
            NativeLog.warn(context, SCOPE, "ReminderActionHandler.apply 不支持的提醒动作 id=$id action=$action kind=${record.kind}")
            return false
        }
        handler(context, record)
        ReminderStore.queueAction(context, PendingAction(id, action, record.targetId, record.kind))
        ReminderActionBridge.notify(context, id, action, record.targetId, record.kind)
        NativeLog.info(context, SCOPE, "ReminderActionHandler.apply 已执行通知动作 id=$id action=$action kind=${record.kind}")
        return true
    }

    private fun snooze(context: Context, record: ReminderRecord) {
        val next = record.copy(at = System.currentTimeMillis() + ReminderActionTable.SNOOZE_MINUTES * 60_000L)
        ReminderStore.put(context, next)
        ReminderAlarms.schedule(context, next)
        ReminderNotifier.cancel(context, record.id)
    }

    private fun done(context: Context, record: ReminderRecord) {
        ReminderStore.remove(context, record.id)
        ReminderAlarms.cancel(context, record.id)
        ReminderNotifier.cancel(context, record.id)
    }

    private fun mute(context: Context, record: ReminderRecord) {
        val until = System.currentTimeMillis() + ReminderActionTable.MUTE_MINUTES * 60_000L
        ReminderStore.addMute(context, record.targetId, until)
        for (item in ReminderStore.removeBefore(context, record.targetId, until)) {
            ReminderAlarms.cancel(context, item.id)
            ReminderNotifier.cancel(context, item.id)
        }
    }
}

/** 把动作广播给 Capacitor 插件；插件在线时经 `notifyListeners` 交给 JS。 */
internal object ReminderActionBridge {
    fun notify(context: Context, id: Long, action: String, targetId: String, kind: String) {
        val intent = Intent(ReminderStore.ACTION_PERFORMED).apply {
            setPackage(context.packageName)
            putExtra(ReminderStore.EXTRA_ID, id)
            putExtra(ReminderStore.EXTRA_ACTION, action)
            putExtra(ReminderStore.EXTRA_TARGET, targetId)
            putExtra(ReminderStore.EXTRA_KIND, kind)
        }
        context.sendBroadcast(intent)
    }
}
