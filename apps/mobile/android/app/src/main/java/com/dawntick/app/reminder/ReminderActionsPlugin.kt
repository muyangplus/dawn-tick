package com.dawntick.app.reminder

import android.Manifest
import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 提醒动作插件（R-07）：课前提醒与日程提醒的定时、投递与通知动作。
 *
 * 边界：
 * - 只接管「提醒」投递；LocalNotifications 的其它用途（即时通知等）保持原样；
 * - 动作语义在原生侧先执行一次（贪睡重排、完成/勿扰取消），同时把动作交给 JS，
 *   JS 负责写回 `events.done` 与维护勿扰窗口；
 * - 插件名 / 方法名 / 字段与 apps/web/src/lib/plugins.ts、apps/mobile/docs/plugins.contract.md 逐字一致。
 */
@CapacitorPlugin(name = "ReminderActions")
class ReminderActionsPlugin : Plugin() {
    private var actionReceiver: BroadcastReceiver? = null

    override fun load() {
        ReminderNotifier.ensureChannel(context)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context?, intent: Intent?) {
                if (intent == null) return
                val id = intent.getLongExtra(ReminderStore.EXTRA_ID, -1L)
                val action = intent.getStringExtra(ReminderStore.EXTRA_ACTION) ?: return
                if (id < 0) return
                val targetId = intent.getStringExtra(ReminderStore.EXTRA_TARGET) ?: ""
                val kind = intent.getStringExtra(ReminderStore.EXTRA_KIND) ?: "class"
                if (!hasListeners(EVENT_ACTION)) return
                ReminderStore.removeQueuedAction(context, id, action)
                notifyListeners(
                    EVENT_ACTION,
                    JSObject()
                        .put("id", id)
                        .put("action", action)
                        .put("targetId", targetId)
                        .put("kind", kind),
                )
            }
        }
        ContextCompat.registerReceiver(
            context,
            receiver,
            IntentFilter(ReminderStore.ACTION_PERFORMED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        actionReceiver = receiver
    }

    override fun handleOnDestroy() {
        actionReceiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (_: IllegalArgumentException) {
                // 已经注销：重复销毁时忽略
            }
        }
        actionReceiver = null
    }

    /**
     * 排定一条提醒。
     * 参数：`id`（通知 id）、`title`、`body`、`at`（epoch 毫秒）、`kind`
     * （`class` / `todo` / `homework` / `exam` / `lab`）、`targetId`（课程或 events.id，用于勿扰）。
     */
    @PluginMethod
    fun schedule(call: PluginCall) {
        val id = (call.data.opt("id") as? Number)?.toLong()
        val at = (call.data.opt("at") as? Number)?.toLong()
        val title = call.getString("title")
        if (id == null || at == null || title == null) {
            call.reject("缺少 id / at / title")
            return
        }
        val record = ReminderRecord(
            id = id,
            title = title,
            body = call.getString("body") ?: "",
            at = at,
            kind = call.getString("kind") ?: "class",
            targetId = call.getString("targetId") ?: "",
        )
        ReminderStore.put(context, record)
        ReminderAlarms.schedule(context, record)
        call.resolve()
    }

    /** 取消一条提醒（完成/勿扰或提醒被删除时）。 */
    @PluginMethod
    fun cancel(call: PluginCall) {
        val id = (call.data.opt("id") as? Number)?.toLong()
        if (id == null) {
            call.reject("缺少 id")
            return
        }
        ReminderStore.remove(context, id)
        ReminderAlarms.cancel(context, id)
        ReminderNotifier.cancel(context, id)
        call.resolve()
    }

    /** 通知权限与精确闹钟状态：只报告，不弹系统弹窗。 */
    @PluginMethod
    fun requestPermissionInfo(call: PluginCall) {
        val notifications = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val exactAlarm = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
        call.resolve(
            JSObject()
                .put("notifications", if (notifications) "granted" else "denied")
                .put("exactAlarm", if (exactAlarm) "granted" else "denied"),
        )
    }

    /** 取走进程不在线时堆积的动作；返回 `{ actions: [{id, action, targetId, kind}] }`。 */
    @PluginMethod
    fun pollActions(call: PluginCall) {
        val actions = JSArray()
        for (item in ReminderStore.drainActions(context)) {
            actions.put(
                JSObject()
                    .put("id", item.id)
                    .put("action", item.action)
                    .put("targetId", item.targetId)
                    .put("kind", item.kind),
            )
        }
        call.resolve(JSObject().put("actions", actions))
    }

    private companion object {
        const val EVENT_ACTION = "actionPerformed"
    }
}
