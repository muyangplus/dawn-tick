package com.dawntick.app.school

import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/** 打开内嵌教务窗口，把页面内容交回 Web 层。 */
@CapacitorPlugin(name = "SchoolWindow")
class SchoolWindowPlugin : Plugin() {
    @PluginMethod
    fun open(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) {
            call.reject("缺少教务地址")
            return
        }
        val intent = Intent(context, SchoolWebActivity::class.java)
        intent.putExtra("url", url)
        startActivityForResult(call, intent, "onSchoolWindowResult")
    }

    @ActivityCallback
    fun onSchoolWindowResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            val payload = result.data?.getStringExtra("payload") ?: ""
            call.resolve(JSObject().put("payload", payload))
        } else {
            call.resolve(JSObject().put("payload", ""))
        }
    }
}
