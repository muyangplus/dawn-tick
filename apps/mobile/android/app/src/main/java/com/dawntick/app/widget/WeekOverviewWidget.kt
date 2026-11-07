package com.dawntick.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/** 4×4 主屏小组件：一周概览。 */
class WeekOverviewWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        val read = WidgetStore.load(context)
        for (id in appWidgetIds) {
            manager.updateAppWidget(id, WidgetRenderer.buildWeekOverview(context, read, id))
        }
    }
}
