package com.dawntick.app.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 解锁屏幕时刷新小组件，弥补系统 30 分钟周期刷新的延迟。 */
class WidgetRefreshReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_USER_PRESENT) return
        WidgetRefresher.refreshAll(context)
    }
}
