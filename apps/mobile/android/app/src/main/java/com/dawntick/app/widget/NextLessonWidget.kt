package com.dawntick.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/** 2×2 主屏小组件：下一节课与倒计时。 */
class NextLessonWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        val snapshot = WidgetStore.load(context)
        for (id in appWidgetIds) {
            manager.updateAppWidget(id, WidgetRenderer.buildNext(context, snapshot))
        }
    }
}
