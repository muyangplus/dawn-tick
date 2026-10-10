package com.dawntick.app.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.dawntick.app.MainActivity
import com.dawntick.app.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object WidgetRenderer {
    private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())

    fun buildNext(context: Context, snapshot: WidgetSnapshot?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_next)
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
                views.setViewVisibility(rowId, android.view.View.GONE)
            } else {
                views.setViewVisibility(rowId, android.view.View.VISIBLE)
                val text = buildString {
                    append(timeFormat.format(Date(lesson.startsAt)))
                    append(' ')
                    append(lesson.title)
                    if (!lesson.room.isNullOrEmpty()) append(" · ").append(lesson.room)
                }
                views.setTextViewText(rowId, text)
            }
        }
        val header = if (snapshot == null) {
            context.getString(R.string.widget_no_data)
        } else {
            context.getString(R.string.widget_today_header, snapshot.week)
        }
        views.setTextViewText(R.id.widget_header, header)
        views.setViewVisibility(
            R.id.widget_empty,
            if (lessons.isEmpty()) android.view.View.VISIBLE else android.view.View.GONE,
        )
        views.setOnClickPendingIntent(R.id.widget_root, openApp(context))
        return views
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
