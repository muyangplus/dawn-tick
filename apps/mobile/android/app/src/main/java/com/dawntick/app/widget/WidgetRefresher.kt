package com.dawntick.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context

/** 四个小组件的统一刷新入口。 */
object WidgetRefresher {
    fun refreshAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val snapshot = WidgetStore.load(context)

        val nextIds = manager.getAppWidgetIds(ComponentName(context, NextLessonWidget::class.java))
        for (id in nextIds) manager.updateAppWidget(id, WidgetRenderer.buildNext(context, snapshot, id))

        val todayIds = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
        for (id in todayIds) manager.updateAppWidget(id, WidgetRenderer.buildToday(context, snapshot, id))

        val weekIds = manager.getAppWidgetIds(ComponentName(context, WeekOverviewWidget::class.java))
        for (id in weekIds) manager.updateAppWidget(id, WidgetRenderer.buildWeekOverview(context, snapshot, id))

        val examIds = manager.getAppWidgetIds(ComponentName(context, ExamCountdownWidget::class.java))
        for (id in examIds) manager.updateAppWidget(id, WidgetRenderer.buildExamCountdown(context, snapshot, id))
    }
}
