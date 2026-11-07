package com.dawntick.app.school

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.dawntick.app.diag.NativeLog
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 打开内嵌教务窗口，把页面内容交回 Web 层。
 *
 * 契约（插件名、方法名、返回字段）见 apps/web/src/lib/plugins.ts 与 apps/mobile/docs/plugins.contract.md。
 */
@CapacitorPlugin(name = "SchoolWindow")
class SchoolWindowPlugin : Plugin() {
    /** 当前平台是否支持内嵌教务窗口；Web 侧据此决定是否显示入口。 */
    @PluginMethod
    fun available(call: PluginCall) {
        call.resolve(JSObject().put("platform", "android").put("supported", true))
    }

    @PluginMethod
    fun open(call: PluginCall) {
        val url = call.getString("url")
        NativeLog.info(context, TAG, "open 入口 url=${NativeLog.redactUrl(url)} length=${url?.length ?: 0}")
        if (url.isNullOrBlank()) {
            NativeLog.warn(context, TAG, "open 缺少教务地址")
            call.reject("缺少教务地址")
            return
        }

        val intent = try {
            Intent(context, SchoolWebActivity::class.java).putExtra("url", url)
        } catch (error: Exception) {
            // 正常情况构造不会失败；真失败时把原始原因交回 Web 层，而不是静默无反应
            NativeLog.error(context, TAG, "构造 SchoolWebActivity Intent 失败", error)
            call.reject(NativeLog.describe(error))
            return
        }
        NativeLog.info(context, TAG, "Intent 构造成功 target=SchoolWebActivity")

        try {
            startActivityForResult(call, intent, "onSchoolWindowResult")
            NativeLog.info(context, TAG, "startActivityForResult 已发起")
        } catch (error: Exception) {
            // 例如 Activity 被系统回收、启动器拒绝启动等：reject 原始 message，界面能显示具体原因
            NativeLog.error(context, TAG, "startActivityForResult 失败", error)
            call.reject(NativeLog.describe(error))
        }
    }

    @ActivityCallback
    fun onSchoolWindowResult(call: PluginCall, result: ActivityResult) {
        val payload = if (result.resultCode == Activity.RESULT_OK) {
            result.data?.getStringExtra("payload") ?: ""
        } else {
            ""
        }
        NativeLog.info(
            context,
            TAG,
            "窗口结束 resultCode=${result.resultCode} payloadBytes=${payload.length}",
        )
        call.resolve(JSObject().put("payload", payload))
    }

    private companion object {
        const val TAG = "SchoolWindow"
    }
}
