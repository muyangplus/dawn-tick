package com.dawntick.app.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.view.View
import android.widget.RemoteViews
import com.dawntick.app.MainActivity
import com.dawntick.app.R
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

object WidgetRenderer {
    private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())
    private val weekdays = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

    private const val INK_LIGHT = 0xFF1F1B24.toInt()
    private const val MUTED_LIGHT = 0xFF6B6475.toInt()
    private const val INK_DARK = 0xFFF3EFF6.toInt()
    private const val MUTED_DARK = 0xFFA79FB3.toInt()
    private const val DANGER_DARK_MODE = 0xFFFF8A8A.toInt()
    private const val DANGER_LIGHT_MODE = 0xFFB3261E.toInt()

    private fun isNightMode(context: Context): Boolean =
        (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    private fun backgroundResource(background: String): Int = when (background) {
        "dark" -> R.drawable.widget_bg_dark
        "transparent" -> R.drawable.widget_bg_transparent
        else -> R.drawable.widget_bg_light
    }

    private fun applyTheme(
        views: RemoteViews,
        context: Context,
        snapshot: WidgetSnapshot?,
        primaryIds: IntArray,
        mutedIds: IntArray,
        accentIds: IntArray = intArrayOf(),
    ) {
        val background = snapshot?.background ?: "light"
        views.setInt(R.id.widget_root, "setBackgroundResource", backgroundResource(background))
        val dark = background == "dark" || (background == "transparent" && isNightMode(context))
        val ink = if (dark) INK_DARK else INK_LIGHT
        val muted = if (dark) MUTED_DARK else MUTED_LIGHT
        val accent = if (dark) DANGER_DARK_MODE else DANGER_LIGHT_MODE
        for (id in primaryIds) views.setTextColor(id, ink)
        for (id in mutedIds) views.setTextColor(id, muted)
        for (id in accentIds) views.setTextColor(id, accent)
    }

    fun buildNext(context: Context, snapshot: WidgetSnapshot?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_next)
        applyTheme(
            views,
            context,
            snapshot,
            primaryIds = intArrayOf(R.id.widget_title),
            mutedIds = intArrayOf(R.id.widget_label, R.id.widget_meta),
        )
        val next = snapshot?.next
        if (next == null) {
            views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_no_lesson))
            views.setTextViewText(R.id.widget_count, "")
            views.setTextViewText(R.id.widget_meta, "")
        } else {
            views.setTextViewText(R.id.widget_title, next.title)
            views.setTextViewText(R.id.widget_count, countdown(next.startsAt))
            val meta = buildString {
                append(timeFormat.format(Date(next.startsAt)))
                if (!next.room.isNullOrEmpty()) append(" · ").append(next.room)
            }
            views.setTextViewText(R.id.widget_meta, meta)
        }
        views.setOnClickPendingIntent(R.id.widget_root, openApp(context))
        return views
    }

    fun buildToday(context: Context, snapshot: WidgetSnapshot?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_today)
        applyTheme(
            views,
            context,
            snapshot,
            primaryIds = intArrayOf(
                R.id.widget_row1,
                R.id.widget_row2,
                R.id.widget_row3,
                R.id.widget_row4,
                R.id.widget_row5,
            ),
            mutedIds = intArrayOf(R.id.widget_header, R.id.widget_empty),
        )
        val rows = intArrayOf(
            R.id.widget_row1,
            R.id.widget_row2,
            R.id.widget_row3,
            R.id.widget_row4,
            R.id.widget_row5,
        )
        val lessons = snapshot?.today.orEmpty()
        for ((index, rowId) in rows.withIndex()) {
            val lesson = lessons.getOrNull(index)
            if (lesson == null) {
                views.setViewVisibility(rowId, View.GONE)
            } else {
                views.setViewVisibility(rowId, View.VISIBLE)
                views.setTextViewText(rowId, lessonLine(lesson.startsAt, lesson.title, lesson.room))
            }
        }
        views.setTextViewText(
            R.id.widget_header,
            if (snapshot == null) context.getString(R.string.widget_no_data)
            else context.getString(R.string.widget_today_header, snapshot.week),
        )
        views.setViewVisibility(R.id.widget_empty, if (lessons.isEmpty()) View.VISIBLE else View.GONE)
        views.setOnClickPendingIntent(R.id.widget_root, openApp(context))
        return views
    }

    /** 4×4 一周概览：每天一行，最多显示三节。 */
    fun buildWeekOverview(context: Context, snapshot: WidgetSnapshot?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_week)
        val rowIds = intArrayOf(
            R.id.widget_week_row1,
            R.id.widget_week_row2,
            R.id.widget_week_row3,
            R.id.widget_week_row4,
            R.id.widget_week_row5,
            R.id.widget_week_row6,
            R.id.widget_week_row7,
        )
        applyTheme(views, context, snapshot, primaryIds = rowIds, mutedIds = intArrayOf(R.id.widget_week_header))
        val grid = snapshot?.grid.orEmpty()
        for ((index, rowId) in rowIds.withIndex()) {
            val day = index + 1
            val lessons = grid.filter { it.dayOfWeek == day }.sortedBy { it.periodStart }
            if (lessons.isEmpty()) {
                views.setTextViewText(rowId, context.getString(R.string.widget_week_empty_row, weekdays[index]))
            } else {
                val text = lessons.take(3).joinToString(" · ") { "${it.periodStart} ${it.title}" }
                views.setTextViewText(rowId, "${weekdays[index]}  $text")
            }
        }
        views.setTextViewText(
            R.id.widget_week_header,
            if (snapshot == null) context.getString(R.string.widget_no_data)
            else context.getString(R.string.widget_week_header, snapshot.week),
        )
        views.setOnClickPendingIntent(R.id.widget_root, openApp(context))
        return views
    }

    /** 2×2 考试倒计时：取最近一场未开始的考试。 */
    fun buildExamCountdown(context: Context, snapshot: WidgetSnapshot?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_exam)
        applyTheme(
            views,
            context,
            snapshot,
            primaryIds = intArrayOf(R.id.widget_exam_title),
            mutedIds = intArrayOf(R.id.widget_exam_label, R.id.widget_exam_date),
            accentIds = intArrayOf(R.id.widget_exam_days),
        )
        val now = System.currentTimeMillis()
        val exam = snapshot?.exams.orEmpty().filter { it.startAt > now }.minByOrNull { it.startAt }
        if (exam == null) {
            views.setTextViewText(R.id.widget_exam_title, context.getString(R.string.widget_exam_none))
            views.setTextViewText(R.id.widget_exam_days, "")
            views.setTextViewText(R.id.widget_exam_date, "")
        } else {
            views.setTextViewText(R.id.widget_exam_title, exam.title)
            views.setTextViewText(R.id.widget_exam_days, daysLeft(exam.startAt))
            views.setTextViewText(R.id.widget_exam_date, exam.date)
        }
        views.setOnClickPendingIntent(R.id.widget_root, openApp(context))
        return views
    }

    private fun lessonLine(startsAt: Long, title: String, room: String?): String = buildString {
        append(timeFormat.format(Date(startsAt)))
        append(' ')
        append(title)
        if (!room.isNullOrEmpty()) append(" · ").append(room)
    }

    private fun countdown(startsAt: Long): String {
        val diff = startsAt - System.currentTimeMillis()
        if (diff <= 0) return "即将开始"
        val totalSeconds = diff / 1000
        val hours = totalSeconds / 3600
        val minutes = (totalSeconds % 3600) / 60
        val seconds = totalSeconds % 60
        return if (hours > 0) {
            String.format(Locale.getDefault(), "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            String.format(Locale.getDefault(), "%02d:%02d", minutes, seconds)
        }
    }

    private fun daysLeft(startsAt: Long): String {
        val calendarNow = Calendar.getInstance()
        val calendarExam = Calendar.getInstance().apply { timeInMillis = startsAt }
        val startOfToday = calendarNow.apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val startOfExam = calendarExam.apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val days = TimeUnit.MILLISECONDS.toDays(startOfExam - startOfToday)
        return if (days <= 0) "今天" else "$days 天"
    }

    private fun openApp(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
