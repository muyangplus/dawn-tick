package com.dawntick.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import com.dawntick.app.MainActivity
import com.dawntick.app.R
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * 小组件每行文案顺序（与日程页日程时间线一致）：
 * 「时间 标题」，课程再加「 · 地点」；正在上课、下一节课与今日课表用「起–止」，本周概览用节次，
 * 考试用日期；停课在标题后加「（停课）」。
 * 例：08:00–09:40 高等数学 · A101；周一  1-2 高等数学 · A101；2026-01-08 数据结构（停课）；2026-01-08 大学英语
 *
 * 不出现省略号：每行高度固定为 widget_row_height，一行能放几行由小组件可用高度除行高向下取整得出，
 * 只渲染前 N 行，放不下的整行不渲染；标题放不下由系统换行，换行顶出的部分由根布局裁掉。
 */
object WidgetRenderer {
    private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())
    // 与 packages/core/src/time.ts 的 WEEKDAY_LABELS 同源（Kotlin 侧无法直接引用 TS 常量，改文案时两边一起改）。
    private val weekdays = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")
    private const val TIME_SEPARATOR = "–"

    /** 与 widget_*.xml 的 android:padding 一致。 */
    private const val ROOT_PADDING_DP = 12
    /** 与 @dimen/widget_header_height 一致。 */
    private const val HEADER_DP = 16
    /** 与 @dimen/widget_count_height 一致，不含倒计时行的布局传 0。 */
    private const val COUNT_DP = 22
    /** 与 @dimen/widget_row_height 一致。 */
    private const val ROW_DP = 22
    /** 与 appwidget-provider 的 minHeight 一致，系统未给出高度时按它算行数。 */
    private const val FALLBACK_WIDGET_HEIGHT_DP = 110

    /**
     * 内置回退色：旧快照（R-04 之前，没有 colors）时使用，取 vivid 预设的语义色。
     * 快照带 colors 时以快照为准（surface / ink / muted / accent 都随主题预设），这里只兜底。
     */
    private const val INK_LIGHT = 0xFF1F1B24.toInt()
    private const val MUTED_LIGHT = 0xFF6B6475.toInt()
    private const val ACCENT_LIGHT = 0xFFB3261E.toInt()
    private const val INK_DARK = 0xFFF3EFF6.toInt()
    private const val MUTED_DARK = 0xFFA79FB3.toInt()
    private const val ACCENT_DARK = 0xFFFF8A8A.toInt()
    private const val SURFACE_LIGHT = 0xFFFFFFFF.toInt()
    private const val SURFACE_DARK = 0xFF1E1A26.toInt()

    /** 快照缺失 colors 时的一整套回退配色，按明暗模式二选一（不用 if 链逐色判断）。 */
    private data class FallbackPalette(
        val ink: Int,
        val muted: Int,
        val accent: Int,
        val surface: Int,
    )

    private val LIGHT_FALLBACK = FallbackPalette(INK_LIGHT, MUTED_LIGHT, ACCENT_LIGHT, SURFACE_LIGHT)
    private val DARK_FALLBACK = FallbackPalette(INK_DARK, MUTED_DARK, ACCENT_DARK, SURFACE_DARK)

    private fun fallbackPalette(dark: Boolean): FallbackPalette = when (dark) {
        true -> DARK_FALLBACK
        false -> LIGHT_FALLBACK
    }

    private fun isNightMode(context: Context): Boolean =
        (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    /** 快照色是 `#RRGGBB` / `#AARRGGBB`；空串、旧快照或非法值时返回 null，由调用方回退常量。 */
    private fun parseColor(value: String?): Int? {
        if (value.isNullOrEmpty()) return null
        return try {
            Color.parseColor(value)
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /** 旧快照没有 colors.surface 时按背景设置回退三态 drawable；新快照直接用 surface 上色。 */

    private fun applyTheme(
        views: RemoteViews,
        context: Context,
        snapshot: WidgetSnapshot?,
        primaryIds: IntArray,
        mutedIds: IntArray,
        accentIds: IntArray = intArrayOf(),
    ) {
        val background = snapshot?.background ?: "light"
        val dark = when (background) {
            "dark" -> true
            "transparent" -> isNightMode(context)
            else -> false
        }
        val colors = snapshot?.colors
        val fallback = fallbackPalette(dark)
        // 快照色优先（随主题预设走），缺失或非法时回退内置常量
        val ink = parseColor(colors?.ink) ?: fallback.ink
        val muted = parseColor(colors?.muted) ?: fallback.muted
        // accent 是 R-04 新字段；旧快照只有 danger，按同一槽位回退
        val accent = parseColor(colors?.accent) ?: parseColor(colors?.danger) ?: fallback.accent
        for (id in primaryIds) views.setTextColor(id, ink)
        for (id in mutedIds) views.setTextColor(id, muted)
        for (id in accentIds) views.setTextColor(id, accent)

        // 卡面：快照 surface（透明底带 alpha）优先；旧快照回退按明暗取的回退色。
        // RemoteViews 没有 setBackgroundResource，只能用 setInt 调受支持的 View 方法，这里统一走 setBackgroundColor。
        val surface = parseColor(colors?.surface) ?: fallback.surface
        views.setInt(R.id.widget_surface, "setBackgroundColor", surface)
    }

    private fun dp(context: Context, value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        context.resources.displayMetrics,
    ).toInt()

    /**
     * 小组件能放下的行数 =（可用高度 − 上下内边距 − 标题行 − 倒计时行）÷ 行高，向下取整。
     * 行数再受布局里写死的行槽上限 maxRows 限制。
     * 高度取 minHeight/maxHeight 里小的那个，避免按拉大后的高度多算行。
     */
    private fun rowCapacity(context: Context, appWidgetId: Int, maxRows: Int, countDp: Int): Int {
        val manager = AppWidgetManager.getInstance(context)
        val options: Bundle? =
            if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) null
            else manager.getAppWidgetOptions(appWidgetId)
        val minHeight = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) ?: 0
        val maxHeight = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) ?: 0
        val heights = listOf(minHeight, maxHeight).filter { it > 0 }
        // 系统给的高度是 dp，下面的 used 与 rowHeight 都是 px：先换到 px 再相减
        val heightDp = if (heights.isEmpty()) FALLBACK_WIDGET_HEIGHT_DP else heights.min()
        val widgetHeight = dp(context, heightDp)

        val used = dp(context, ROOT_PADDING_DP * 2 + HEADER_DP + countDp)
        val rowHeight = dp(context, ROW_DP)
        if (rowHeight <= 0) return 0
        return ((widgetHeight - used) / rowHeight).coerceIn(0, maxRows)
    }

    /** 按行数上限写行文本；超出上限的行整行不渲染，没有内容的行也不渲染。 */
    private fun fillRows(views: RemoteViews, rowIds: IntArray, capacity: Int, texts: List<String>) {
        for ((index, rowId) in rowIds.withIndex()) {
            val text = texts.getOrNull(index)
            if (index >= capacity || text.isNullOrEmpty()) {
                views.setViewVisibility(rowId, View.GONE)
            } else {
                views.setViewVisibility(rowId, View.VISIBLE)
                views.setTextViewText(rowId, text)
            }
        }
    }

    fun buildNext(context: Context, snapshot: WidgetSnapshot?, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_next)
        applyTheme(
            views,
            context,
            snapshot,
            primaryIds = intArrayOf(R.id.widget_row1, R.id.widget_row2, R.id.widget_row3),
            mutedIds = intArrayOf(R.id.widget_label),
            accentIds = intArrayOf(R.id.widget_count),
        )
        val capacity = rowCapacity(context, appWidgetId, maxRows = 3, countDp = COUNT_DP)
        val current = snapshot?.current
        val next = snapshot?.next
        val primary = current?.takeIf { it.startsAt > 0 } ?: next?.takeIf { it.startsAt > 0 }
        views.setTextViewText(
            R.id.widget_label,
            context.getString(if (current != null) R.string.widget_in_class else R.string.widget_next_label),
        )
        val texts = if (primary == null) {
            views.setTextViewText(R.id.widget_count, "")
            listOf(context.getString(R.string.widget_no_lesson))
        } else {
            views.setTextViewText(
                R.id.widget_count,
                if (current != null) remaining(current.endsAt) else countdown(primary.startsAt),
            )
            listOf(lessonLine(primary.startsAt, primary.endsAt, primary.title, primary.room))
        }
        fillRows(views, intArrayOf(R.id.widget_row1, R.id.widget_row2, R.id.widget_row3), capacity, texts)
        views.setOnClickPendingIntent(R.id.widget_root, openApp(context))
        return views
    }

    fun buildToday(context: Context, snapshot: WidgetSnapshot?, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_today)
        val rowIds = intArrayOf(
            R.id.widget_row1,
            R.id.widget_row2,
            R.id.widget_row3,
            R.id.widget_row4,
            R.id.widget_row5,
        )
        applyTheme(
            views,
            context,
            snapshot,
            primaryIds = rowIds,
            mutedIds = intArrayOf(R.id.widget_header, R.id.widget_empty),
        )
        val capacity = rowCapacity(context, appWidgetId, maxRows = rowIds.size, countDp = 0)
        val lessons = snapshot?.today.orEmpty()
        fillRows(
            views,
            rowIds,
            capacity,
            lessons.map { lessonLine(it.startsAt, it.endsAt, it.title, it.room) },
        )
        views.setTextViewText(
            R.id.widget_header,
            if (snapshot == null) context.getString(R.string.widget_no_data)
            else context.getString(R.string.widget_today_header, snapshot.week),
        )
        views.setViewVisibility(R.id.widget_empty, if (lessons.isEmpty()) View.VISIBLE else View.GONE)
        views.setOnClickPendingIntent(R.id.widget_root, openApp(context))
        return views
    }

    /** 4×4 一周概览：一节课一行，放不下的整行不渲染；放不下时标题补「还有 N 节」。 */
    fun buildWeekOverview(context: Context, snapshot: WidgetSnapshot?, appWidgetId: Int): RemoteViews {
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
        val capacity = rowCapacity(context, appWidgetId, maxRows = rowIds.size, countDp = 0)
        val grid = snapshot?.grid.orEmpty()
        // 先按周几、再按节次排，取能放下的前 capacity 行；放不下的整行与空行都不渲染
        val texts = weekdays.flatMapIndexed { index, weekday ->
            grid.filter { it.dayOfWeek == index + 1 }
                .sortedBy { it.periodStart }
                .map { lesson -> weekLessonLine(context, weekday, lesson) }
        }
        fillRows(
            views,
            rowIds,
            capacity,
            texts.ifEmpty {
                listOf(
                    if (snapshot == null) context.getString(R.string.widget_no_data)
                    else context.getString(R.string.widget_week_no_lesson),
                )
            },
        )
        views.setTextViewText(
            R.id.widget_week_header,
            when {
                snapshot == null -> context.getString(R.string.widget_no_data)
                // 放不下的课整行不渲染，用标题补一句「还有 N 节」，避免看起来只有这些课
                texts.size > capacity ->
                    context.getString(R.string.widget_week_header, snapshot.week) +
                        " · " + context.getString(R.string.widget_week_more, texts.size - capacity)
                else -> context.getString(R.string.widget_week_header, snapshot.week)
            },
        )
        views.setOnClickPendingIntent(R.id.widget_root, openApp(context))
        return views
    }

    /** 一周概览的一行：周几 + 节次 + 标题 + 地点；停课在标题后加后缀。 */
    private fun weekLessonLine(context: Context, weekday: String, lesson: WidgetGridLesson): String {
        val period =
            if (lesson.periodEnd > lesson.periodStart) "${lesson.periodStart}-${lesson.periodEnd}"
            else "${lesson.periodStart}"
        val suffix = if (lesson.cancelled) context.getString(R.string.widget_cancelled_suffix) else ""
        val room = if (lesson.room.isNullOrEmpty()) "" else " · ${lesson.room}"
        return "$weekday  $period ${lesson.title}$suffix$room"
    }

    /** 2×2 考试倒计时：按开考时间列出未开始的考试，天数单独一行。 */
    fun buildExamCountdown(context: Context, snapshot: WidgetSnapshot?, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_exam)
        applyTheme(
            views,
            context,
            snapshot,
            primaryIds = intArrayOf(R.id.widget_row1, R.id.widget_row2),
            mutedIds = intArrayOf(R.id.widget_exam_label),
            accentIds = intArrayOf(R.id.widget_exam_days),
        )
        val capacity = rowCapacity(context, appWidgetId, maxRows = 2, countDp = COUNT_DP)
        val now = System.currentTimeMillis()
        val exams = snapshot?.exams.orEmpty().filter { it.startAt > now }.sortedBy { it.startAt }
        val nearest = exams.firstOrNull()
        views.setTextViewText(
            R.id.widget_exam_days,
            if (nearest == null) "" else daysLeft(nearest.startAt),
        )
        val texts = if (exams.isEmpty()) {
            listOf(context.getString(R.string.widget_exam_none))
        } else {
            exams.map { exam -> examLine(exam.date, exam.title) }
        }
        fillRows(views, intArrayOf(R.id.widget_row1, R.id.widget_row2), capacity, texts)
        views.setOnClickPendingIntent(R.id.widget_root, openApp(context))
        return views
    }

    /** 课程行：08:00–09:40 高等数学 · A101。 */
    private fun lessonLine(startsAt: Long, endsAt: Long, title: String, room: String?): String = buildString {
        append(timeText(startsAt, endsAt))
        append(' ')
        append(title)
        if (!room.isNullOrEmpty()) append(" · ").append(room)
    }

    /** 考试行：2026-01-08 大学英语。 */
    private fun examLine(date: String, title: String): String = buildString {
        if (date.isNotEmpty()) append(date).append(' ')
        append(title)
    }

    private fun timeText(startsAt: Long, endsAt: Long): String = buildString {
        append(timeFormat.format(Date(startsAt)))
        if (endsAt > startsAt) {
            append(TIME_SEPARATOR)
            append(timeFormat.format(Date(endsAt)))
        }
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

    /** 距课程结束的剩余时间，格式与倒计时一致；课程已结束时返回 00:00。 */
    private fun remaining(endsAt: Long): String {
        val diff = endsAt - System.currentTimeMillis()
        if (diff <= 0) return "00:00"
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
