package com.dawntick.app.widget

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** 由 Web 层在数据变更后调用，实现小组件即时刷新。 */
@CapacitorPlugin(name = "WidgetRefresh")
class WidgetRefreshPlugin : Plugin() {
    @PluginMethod
    fun refresh(call: PluginCall) {
        WidgetRefresher.refreshAll(context)
        call.resolve()
    }
}
