package com.dawntick.app.widget

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * 小组件的时间/课程行文案格式化。
 *
 * 从 `WidgetRenderer` 拆出的纯文本部分：渲染器只管布局与配色，行格式集中在这里，
 * 既方便单独核对文案（与日程页时间线一致），也让单文件保持在 400 行以内。
 * 行格式：`08:00–09:40 高等数学 · A101`、`2026-01-08 大学英语`。
 */
object WidgetText {
    private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())
    private const val TIME_SEPARATOR = "–"

    /** 课程行：08:00–09:40 高等数学 · A101。 */
    fun lessonLine(startsAt: Long, endsAt: Long, title: String, room: String?): String = buildString {
        append(timeText(startsAt, endsAt))
        append(' ')
        append(title)
        if (!room.isNullOrEmpty()) append(" · ").append(room)
    }

    /** 考试行：2026-01-08 大学英语。 */
    fun examLine(date: String, title: String): String = buildString {
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

    fun countdown(startsAt: Long): String {
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
    fun remaining(endsAt: Long): String {
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

    fun daysLeft(startsAt: Long): String {
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
}
