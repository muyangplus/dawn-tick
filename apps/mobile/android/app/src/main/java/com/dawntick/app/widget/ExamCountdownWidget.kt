package com.dawntick.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/** 2×2 主屏小组件：考试倒计时。 */
class ExamCountdownWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        val snapshot = WidgetStore.load(context)
        for (id in appWidgetIds) {
            manager.updateAppWidget(id, WidgetRenderer.buildExamCountdown(context, snapshot, id))
        }
    }
}
