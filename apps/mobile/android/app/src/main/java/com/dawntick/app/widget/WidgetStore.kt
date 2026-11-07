package com.dawntick.app.widget

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import com.dawntick.app.diag.NativeLog
import org.json.JSONObject
import java.io.File

/**
 * 快照结构由 Web 层 `apps/web/src/widget-snapshot.ts` 定义，本文件只做读取。
 * 字段名与 JSON 键名必须与该文件里的接口一致，由 `tools/verify/check-widget-contract.mjs` 校验。
 */
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
    /** 该课所在日期是否被停课。 */
    val cancelled: Boolean,
)

data class WidgetExam(
    val title: String,
    val date: String,
    val startAt: Long,
)

/**
 * 设计令牌语义色；旧快照没有该对象，渲染器回退内置常量。
 * 字段名与 `apps/web/src/widget-snapshot.ts` 的 WidgetColors 一一对应，由契约脚本校验。
 */
data class WidgetColors(
    val ink: String,
    val muted: String,
    /** 卡面底色（#RRGGBB 或透明底的 #AARRGGBB）。 */
    val surface: String,
    /** 强调色：与悬浮窗倒计时一致的 primaryStrong。 */
    val accent: String,
    /** A-15 旧字段；新快照仍携带，旧版 APK 用它取强调色。 */
    val danger: String,
)

data class WidgetSnapshot(
    val updatedAt: Long,
    val week: Int,
    /** 快照写入时的时区；小组件目前按设备时区渲染，保留字段供后续按快照时区格式化。 */
    val timeZone: String,
    val background: String,
    val colors: WidgetColors?,
    /** 当前正在进行中的课程，没有进行中的课程时为 null。 */
    val current: WidgetLesson?,
    val next: WidgetLesson?,
    val today: List<WidgetLesson>,
    val grid: List<WidgetGridLesson>,
    val exams: List<WidgetExam>,
)

/**
 * 一次读取的状态，用来区分「本来就没数据」与「有库但读不出来」：
 * - [NO_DATABASE] / [NO_SNAPSHOT]：渲染「尚未创建学期」；
 * - [OPEN_FAILED] / [PARSE_FAILED]：渲染「读取数据失败，请打开晓刻后重试」。
 */
enum class WidgetReadStatus {
    OK,
    NO_DATABASE,
    NO_SNAPSHOT,
    OPEN_FAILED,
    PARSE_FAILED,
}

/** 读取结果：快照 + 状态 + 失败原因（已同时写入 NativeLog）。 */
data class WidgetReadResult(
    val snapshot: WidgetSnapshot?,
    val status: WidgetReadStatus,
    /** `类名: message`；成功或没有数据时为 null。 */
    val error: String? = null,
) {
    /** 库/快照存在但读取失败：显示重试文案，而不是「尚未创建学期」。 */
    val failed: Boolean
        get() = status == WidgetReadStatus.OPEN_FAILED || status == WidgetReadStatus.PARSE_FAILED
}

/** 读取 Web 层写入 app_meta.widget_snapshot 的快照，避免小组件重复实现课表逻辑。 */
object WidgetStore {
    private const val SNAPSHOT_KEY = "widget_snapshot"
    private const val TAG = "WidgetStore"

    private val databaseCandidates = listOf(
        "dawn_tick",
        "dawn_tick.db",
        "dawn_tickSQLite.db",
        "dawn_tickSQLite",
    )

    fun load(context: Context): WidgetReadResult {
        val candidates = databaseCandidates.map { context.getDatabasePath(it) }
        val existing = candidates.filter { it.exists() }
        if (existing.isEmpty()) {
            NativeLog.info(context, TAG, "候选库都不存在 ${candidates.joinToString { it.name }}")
            return WidgetReadResult(null, WidgetReadStatus.NO_DATABASE)
        }
        NativeLog.info(
            context,
            TAG,
            "存在候选库 ${existing.joinToString { it.name }}（候选共 ${candidates.size} 个）",
        )

        var openError: String? = null
        var parseError: String? = null
        for (file in existing) {
            val value = readValue(context, file)
            if (value.error != null) {
                NativeLog.warn(context, TAG, "候选库 ${file.name} 打开/查询失败：${value.error}")
                if (openError == null) openError = value.error
                continue
            }
            if (!value.found) {
                NativeLog.info(context, TAG, "候选库 ${file.name} 没有 $SNAPSHOT_KEY 行")
                continue
            }
            if (value.json.isNullOrBlank()) {
                NativeLog.warn(context, TAG, "候选库 ${file.name} 的 $SNAPSHOT_KEY 为空")
                continue
            }
            val snapshot = try {
                parseSnapshot(value.json)
            } catch (error: Exception) {
                NativeLog.error(context, TAG, "解析 ${file.name} 的 $SNAPSHOT_KEY JSON 失败", error)
                if (parseError == null) parseError = NativeLog.describe(error)
                continue
            }
            NativeLog.info(
                context,
                TAG,
                "读取成功 file=${file.name} bytes=${value.json.length} week=${snapshot.week}",
            )
            return WidgetReadResult(snapshot, WidgetReadStatus.OK)
        }

        // 有库文件但没有可用快照：优先报「解析失败」，其次「打开失败」，都没有才算没数据
        return when {
            parseError != null -> {
                NativeLog.warn(context, TAG, "快照存在但解析失败：$parseError")
                WidgetReadResult(null, WidgetReadStatus.PARSE_FAILED, parseError)
            }
            openError != null -> {
                NativeLog.warn(context, TAG, "候选库存在但读取失败：$openError")
                WidgetReadResult(null, WidgetReadStatus.OPEN_FAILED, openError)
            }
            else -> {
                NativeLog.info(context, TAG, "候选库都没有可用的 $SNAPSHOT_KEY，按尚未创建学期处理")
                WidgetReadResult(null, WidgetReadStatus.NO_SNAPSHOT)
            }
        }
    }

    /** 单个候选库的读取结果；[found] 为 false 表示没有快照行。 */
    private data class ValueRead(val json: String?, val found: Boolean, val error: String?)

    /**
     * 先按只读打开；只读打不开或没读到行时，如果存在 `-wal`/`-shm`，改用读写再试一次：
     * 应用对自己的数据库目录有写权限，读写打开会触发 WAL 回放，能读到还没 checkpoint 的快照。
     * 仍失败时保留失败原因，交给上层决定显示「读取失败」。
     */
    private fun readValue(context: Context, file: File): ValueRead {
        var outcome = query(file, SQLiteDatabase.OPEN_READONLY)
        val wal = File(file.path + "-wal")
        val shm = File(file.path + "-shm")
        // 打开失败、没有快照行、或者行的值为空，都说明只读视图可能没看到 WAL 里的提交
        val emptyResult = outcome.error != null || !outcome.found || outcome.json.isNullOrBlank()
        if (emptyResult && (wal.exists() || shm.exists())) {
            NativeLog.info(
                context,
                TAG,
                "只读读取未命中（${outcome.error ?: "无快照行"}），存在 -wal/-shm，改用 OPEN_READWRITE 重试",
            )
            val retried = query(file, SQLiteDatabase.OPEN_READWRITE)
            if (retried.error == null && retried.found && !retried.json.isNullOrBlank()) {
                NativeLog.info(context, TAG, "读写重试成功（WAL 已回放）file=${file.name}")
                outcome = retried
            } else {
                NativeLog.warn(context, TAG, "读写重试仍未读到：${retried.error ?: "无快照行"}")
                // 第一次只读失败、第二次也失败时，保留第一次原因（通常是只读模式拒绝 WAL）
                if (outcome.error == null && retried.error != null) outcome = retried
            }
        }
        return outcome
    }

    /** 打开库并查一行；异常转成 `类名: message`，不把异常抛给小组件渲染。 */
    private fun query(file: File, flags: Int): ValueRead = try {
        SQLiteDatabase.openDatabase(file.path, null, flags).use { database ->
            database.query(
                "app_meta",
                arrayOf("value"),
                "key = ?",
                arrayOf(SNAPSHOT_KEY),
                null,
                null,
                null,
            ).use { cursor ->
                if (cursor.moveToFirst()) {
                    ValueRead(cursor.getString(0), true, null)
                } else {
                    ValueRead(null, false, null)
                }
            }
        }
    } catch (error: Exception) {
        ValueRead(null, false, NativeLog.describe(error))
    }

    private fun parseSnapshot(json: String): WidgetSnapshot {
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
                        cancelled = item.optBoolean("cancelled", false),
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

        return WidgetSnapshot(
            updatedAt = root.optLong("updatedAt", 0L),
            week = root.optInt("week", 0),
            timeZone = root.optString("timeZone", ""),
            background = root.optString("background", "light"),
            colors = root.optJSONObject("colors")?.let { parseColors(it) },
            current = root.optJSONObject("current")?.let { parseLesson(it) },
            next = root.optJSONObject("next")?.let { parseLesson(it) },
            today = today,
            grid = grid,
            exams = exams,
        )
    }

    private fun parseLesson(item: JSONObject): WidgetLesson = WidgetLesson(
        title = item.optString("title"),
        room = if (item.isNull("room")) null else item.optString("room").ifEmpty { null },
        startsAt = item.optLong("startsAt"),
        endsAt = item.optLong("endsAt"),
    )

    /** 空串表示旧快照或字段缺失，渲染器会回退内置常量。 */
    private fun parseColors(item: JSONObject): WidgetColors = WidgetColors(
        ink = item.optString("ink"),
        muted = item.optString("muted"),
        surface = item.optString("surface"),
        accent = item.optString("accent"),
        danger = item.optString("danger"),
    )
}
