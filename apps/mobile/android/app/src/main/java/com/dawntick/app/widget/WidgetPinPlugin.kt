package com.dawntick.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.dawntick.app.diag.NativeLog
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** 桌面小组件的四种尺寸，与 AndroidManifest 里注册的 receiver 一一对应。 */
private val WIDGET_PROVIDERS = mapOf(
    "next" to NextLessonWidget::class.java,
    "today" to TodayWidget::class.java,
    "week" to WeekOverviewWidget::class.java,
    "exam" to ExamCountdownWidget::class.java,
)

/** 等系统确认添加的最长时间：超过就按「没收到确认」处理，再去查一次数量兜底。 */
private const val PIN_TIMEOUT_MS = 10_000L

/** 原生诊断日志标签。 */
private const val PIN_LOG_TAG = "WidgetPin"

/**
 * 把小组件放到桌面：调用系统的 requestPinAppWidget，弹出「添加到主屏幕」确认。
 * 结果要能分辨：启动器不支持、组件被停用、已经加过、用户取消或没弹窗、添加成功。
 *
 * 契约（插件名、方法名、返回字段）见 apps/web/src/lib/plugins.ts 与 apps/mobile/docs/plugins.contract.md。
 */
@CapacitorPlugin(name = "DawnTickWidget")
class WidgetPinPlugin : Plugin() {
    private var pendingCall: PluginCall? = null
    private var pendingProvider: String? = null
    private var pendingComponent: ComponentName? = null
    private var pendingBefore = 0
    private val handler = Handler(Looper.getMainLooper())
    private val timeout = Runnable { finishPending("cancelled", "没收到系统确认") }

    override fun load() {
        super.load()
        active = this
        NativeLog.info(context, PIN_LOG_TAG, "插件已加载")
    }

    override fun handleOnDestroy() {
        handler.removeCallbacks(timeout)
        pendingCall = null
        pendingProvider = null
        pendingComponent = null
        active = null
        super.handleOnDestroy()
    }

    /** 每种尺寸在桌面上的状态：设置页显示「已添加 / 已停用」，也用来判断要不要再弹系统确认。 */
    @PluginMethod
    fun readStates(call: PluginCall) {
        val manager = AppWidgetManager.getInstance(context)
        val result = JSObject()
        result.put("supported", supportsPin(manager))
        val widgets = JSArray()
        for ((key, cls) in WIDGET_PROVIDERS) {
            val component = ComponentName(context, cls)
            val item = JSObject()
            item.put("provider", key)
            item.put("added", manager.getAppWidgetIds(component).isNotEmpty())
            item.put("enabled", isComponentEnabled(component))
            widgets.put(item)
        }
        result.put("widgets", widgets)
        call.resolve(result)
    }

    @PluginMethod
    fun requestPin(call: PluginCall) {
        val key = call.getString("provider") ?: "next"
        NativeLog.info(context, PIN_LOG_TAG, "requestPin 入口 provider=$key sdk=${Build.VERSION.SDK_INT}")
        val cls = WIDGET_PROVIDERS[key]
        if (cls == null) {
            NativeLog.warn(context, PIN_LOG_TAG, "requestPin 未知组件 provider=$key")
            call.reject("unknown widget provider: $key")
            return
        }
        val manager = AppWidgetManager.getInstance(context)
        val component = ComponentName(context, cls)

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            NativeLog.warn(context, PIN_LOG_TAG, "requestPin 系统版本不支持 provider=$key")
            call.resolve(status("unsupported"))
            return
        }
        if (!isComponentEnabled(component)) {
            NativeLog.warn(context, PIN_LOG_TAG, "requestPin 组件被停用 provider=$key")
            call.resolve(status("disabled"))
            return
        }
        if (manager.getAppWidgetIds(component).isNotEmpty()) {
            NativeLog.info(context, PIN_LOG_TAG, "requestPin 已添加 provider=$key")
            call.resolve(status("already-added"))
            return
        }
        if (!manager.isRequestPinAppWidgetSupported) {
            NativeLog.warn(context, PIN_LOG_TAG, "requestPin 启动器不支持 provider=$key")
            call.resolve(status("unsupported"))
            return
        }
        // 上一次请求还没结束：先把它按「没收到确认」收尾，避免两个请求互相覆盖
        if (pendingCall != null) finishPending("cancelled", "上一次请求还没结束")
        val callback = PendingIntent.getBroadcast(
            context,
            key.hashCode(),
            Intent(context, WidgetPinResultReceiver::class.java)
                .setAction(ACTION_PIN_CONFIRMED)
                .putExtra(EXTRA_PROVIDER, key),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val requested = manager.requestPinAppWidget(component, Bundle(), callback)
        if (!requested) {
            NativeLog.warn(context, PIN_LOG_TAG, "requestPin 系统未弹出确认 provider=$key")
            call.resolve(status("rejected"))
            return
        }
        pendingCall = call
        pendingProvider = key
        pendingComponent = component
        pendingBefore = manager.getAppWidgetIds(component).size
        NativeLog.info(context, PIN_LOG_TAG, "requestPin 已请求系统确认 provider=$key before=$pendingBefore")
        handler.postDelayed(timeout, PIN_TIMEOUT_MS)
    }

    /** 用户确认添加后由广播转进来。 */
    private fun handleConfirmed(provider: String?) {
        if (pendingCall == null) return
        if (provider != null && provider != pendingProvider) return
        NativeLog.info(context, PIN_LOG_TAG, "收到系统确认 provider=${provider ?: pendingProvider}")
        finishPending("added", null)
    }

    /** 结束等待：超时后按数量兜底，数量变多说明其实已经加上。 */
    private fun finishPending(status: String, reason: String?) {
        val call = pendingCall ?: return
        pendingCall = null
        handler.removeCallbacks(timeout)
        var finalStatus = status
        if (status == "cancelled") {
            val component = pendingComponent
            if (component != null) {
                val count = AppWidgetManager.getInstance(context).getAppWidgetIds(component).size
                if (count > pendingBefore) finalStatus = "added"
            }
        }
        NativeLog.info(
            context,
            PIN_LOG_TAG,
            "requestPin 结束 status=$finalStatus provider=${pendingProvider ?: "-"} reason=${reason ?: "无"}",
        )
        val result = JSObject()
        result.put("status", finalStatus)
        if (reason != null) result.put("reason", reason)
        pendingProvider = null
        pendingComponent = null
        call.resolve(result)
    }

    private fun status(value: String): JSObject = JSObject().put("status", value)

    private fun isComponentEnabled(component: ComponentName): Boolean {
        val state = context.packageManager.getComponentEnabledSetting(component)
        return state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED &&
            state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER &&
            state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED
    }

    private fun supportsPin(manager: AppWidgetManager): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.isRequestPinAppWidgetSupported

    companion object {
        internal const val ACTION_PIN_CONFIRMED = "com.dawntick.app.widget.PIN_CONFIRMED"
        internal const val EXTRA_PROVIDER = "provider"
        @Volatile
        private var active: WidgetPinPlugin? = null

        internal fun onPinConfirmed(provider: String?) {
            val plugin = active ?: return
            plugin.handler.post { plugin.handleConfirmed(provider) }
        }
    }
}

/** 系统在用户确认添加后发回的广播：转给插件收尾。 */
class WidgetPinResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        WidgetPinPlugin.onPinConfirmed(intent?.getStringExtra(WidgetPinPlugin.EXTRA_PROVIDER))
    }
}
