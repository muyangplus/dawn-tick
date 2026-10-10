package com.dawntick.app.widget

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/** 解锁屏幕时刷新小组件，弥补系统 30 分钟周期刷新的延迟。 */
class WidgetRefreshReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_USER_PRESENT) return
        val manager = AppWidgetManager.getInstance(context)
        val snapshot = WidgetStore.load(context)

        val nextIds = manager.getAppWidgetIds(ComponentName(context, NextLessonWidget::class.java))
        for (id in nextIds) manager.updateAppWidget(id, WidgetRenderer.buildNext(context, snapshot))

        val todayIds = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
        for (id in todayIds) manager.updateAppWidget(id, WidgetRenderer.buildToday(context, snapshot))
    }
}
