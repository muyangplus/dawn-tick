package com.dawntick.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
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

/**
 * 把小组件直接放到桌面：调用系统的 requestPinAppWidget，弹出「添加到主屏幕」确认。
 * 启动器不支持时返回 supported=false，由界面给出长按桌面的手动引导。
 */
@CapacitorPlugin(name = "DawnTickWidget")
class WidgetPinPlugin : Plugin() {
    @PluginMethod
    fun requestPin(call: PluginCall) {
        val result = JSObject()
        val key = call.getString("provider") ?: "next"
        val provider = WIDGET_PROVIDERS[key]
        if (provider == null) {
            call.reject("unknown widget provider: $key")
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            result.put("supported", false)
            result.put("reason", "系统版本低于 Android 8，请在桌面小组件列表里添加")
            call.resolve(result)
            return
        }
        val manager = AppWidgetManager.getInstance(context)
        if (!manager.isRequestPinAppWidgetSupported) {
            result.put("supported", false)
            result.put("reason", "当前启动器不支持一键添加，请长按桌面手动添加")
            call.resolve(result)
            return
        }
        val requested = manager.requestPinAppWidget(ComponentName(context, provider), null, null)
        result.put("supported", true)
        result.put("requested", requested)
        call.resolve(result)
    }
}
