package com.dawntick.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import com.dawntick.app.diag.NativeLog

/** 四个小组件的统一刷新入口。 */
object WidgetRefresher {
    private const val TAG = "WidgetRefresher"

    fun refreshAll(context: Context) {
        NativeLog.info(context, TAG, "刷新开始")
        val manager = AppWidgetManager.getInstance(context)
        val read = WidgetStore.load(context)

        val nextIds = manager.getAppWidgetIds(ComponentName(context, NextLessonWidget::class.java))
        for (id in nextIds) manager.updateAppWidget(id, WidgetRenderer.buildNext(context, read, id))

        val todayIds = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
        for (id in todayIds) manager.updateAppWidget(id, WidgetRenderer.buildToday(context, read, id))

        val weekIds = manager.getAppWidgetIds(ComponentName(context, WeekOverviewWidget::class.java))
        for (id in weekIds) manager.updateAppWidget(id, WidgetRenderer.buildWeekOverview(context, read, id))

        val examIds = manager.getAppWidgetIds(ComponentName(context, ExamCountdownWidget::class.java))
        for (id in examIds) manager.updateAppWidget(id, WidgetRenderer.buildExamCountdown(context, read, id))

        NativeLog.info(
            context,
            TAG,
            "刷新结束 status=${read.status} error=${read.error ?: "无"} " +
                "next=${nextIds.size} today=${todayIds.size} week=${weekIds.size} exam=${examIds.size}",
        )
    }
}
