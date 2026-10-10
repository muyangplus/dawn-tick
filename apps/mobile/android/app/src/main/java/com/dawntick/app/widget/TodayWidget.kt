package com.dawntick.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/** 4×2 主屏小组件：今日课表。 */
class TodayWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        val snapshot = WidgetStore.load(context)
        for (id in appWidgetIds) {
            manager.updateAppWidget(id, WidgetRenderer.buildToday(context, snapshot))
        }
    }
}
