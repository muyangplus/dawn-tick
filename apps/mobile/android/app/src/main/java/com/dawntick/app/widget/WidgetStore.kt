package com.dawntick.app.widget

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.io.File

data class WidgetLesson(
    val title: String,
    val room: String?,
    val startsAt: Long,
    val endsAt: Long,
)

data class WidgetGridLesson(
    val title: String,
    val room: String?,
    val color: String,
    val dayOfWeek: Int,
    val periodStart: Int,
    val periodEnd: Int,
)

data class WidgetExam(
    val title: String,
    val date: String,
    val startAt: Long,
)

data class WidgetSnapshot(
    val week: Int,
    val updatedAt: Long,
    val background: String,
    val next: WidgetLesson?,
    val today: List<WidgetLesson>,
    val grid: List<WidgetGridLesson>,
    val exams: List<WidgetExam>,
)

/** 读取 Web 层写入 app_meta.widget_snapshot 的快照，避免小组件重复实现课表逻辑。 */
object WidgetStore {
    private const val SNAPSHOT_KEY = "widget_snapshot"

    private val databaseCandidates = listOf(
        "dawn_tick",
        "dawn_tick.db",
        "dawn_tickSQLite.db",
        "dawn_tickSQLite",
    )

    fun load(context: Context): WidgetSnapshot? {
        val json = readSnapshot(context) ?: return null
        return try {
            val root = JSONObject(json)

            val today = mutableListOf<WidgetLesson>()
            root.optJSONArray("today")?.let { array ->
                for (index in 0 until array.length()) {
                    array.optJSONObject(index)?.let { today.add(parseLesson(it)) }
                }
            }

            val grid = mutableListOf<WidgetGridLesson>()
            root.optJSONArray("grid")?.let { array ->
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index) ?: continue
                    grid.add(
                        WidgetGridLesson(
                            title = item.optString("title"),
                            room = item.optString("room").ifEmpty { null },
                            color = item.optString("color"),
                            dayOfWeek = item.optInt("dayOfWeek", 1),
                            periodStart = item.optInt("periodStart", 1),
                            periodEnd = item.optInt("periodEnd", 1),
                        ),
                    )
                }
            }

            val exams = mutableListOf<WidgetExam>()
            root.optJSONArray("exams")?.let { array ->
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index) ?: continue
                    exams.add(
                        WidgetExam(
                            title = item.optString("title"),
                            date = item.optString("date"),
                            startAt = item.optLong("startAt"),
                        ),
                    )
                }
            }

            WidgetSnapshot(
                week = root.optInt("week", 0),
                updatedAt = root.optLong("updatedAt", 0L),
                background = root.optString("background", "light"),
                next = root.optJSONObject("next")?.let { parseLesson(it) },
                today = today,
                grid = grid,
                exams = exams,
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun parseLesson(item: JSONObject): WidgetLesson = WidgetLesson(
        title = item.optString("title"),
        room = if (item.isNull("room")) null else item.optString("room").ifEmpty { null },
        startsAt = item.optLong("startsAt"),
        endsAt = item.optLong("endsAt"),
    )

    private fun readSnapshot(context: Context): String? {
        for (name in databaseCandidates) {
            val file: File = context.getDatabasePath(name)
            if (!file.exists()) continue
            try {
                SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
                    database.query(
                        "app_meta",
                        arrayOf("value"),
                        "key = ?",
                        arrayOf(SNAPSHOT_KEY),
                        null,
                        null,
                        null,
                    ).use { cursor ->
                        if (cursor.moveToFirst()) return cursor.getString(0)
                    }
                }
            } catch (_: Exception) {
                // 尝试下一个候选文件名
            }
        }
        return null
    }
}
