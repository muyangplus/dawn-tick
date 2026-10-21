package com.dawntick.app.reminder

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 提醒动作插件（R-07）的持久化：排定中的提醒、待交给 JS 的动作、勿扰窗口。
 *
 * 进程被杀后，AlarmManager 仍会拉起 [ReminderAlarmReceiver] 投递提醒；
 * 通知动作则先写入 [KEY_ACTIONS]，等 WebView 回来时由 `pollActions` 取走。
 * 边界：只存通知链路需要的字段，不碰课表/条目数据。
 */
internal data class ReminderRecord(
    val id: Long,
    val title: String,
    val body: String,
    val at: Long,
    val kind: String,
    val targetId: String,
)

internal data class PendingAction(
    val id: Long,
    val action: String,
    val targetId: String,
    val kind: String,
)

internal data class MuteRecord(val targetId: String, val until: Long)

internal object ReminderStore {
    private const val PREFS = "dawntick.reminders"
    private const val KEY_REMINDERS = "scheduled"
    private const val KEY_ACTIONS = "pending_actions"
    private const val KEY_MUTES = "mutes"

    /** 通知按钮/闹钟广播的 extra 键与 action。 */
    const val EXTRA_ID = "com.dawntick.app.reminder.ID"
    const val EXTRA_ACTION = "com.dawntick.app.reminder.ACTION"
    const val EXTRA_TARGET = "com.dawntick.app.reminder.TARGET"
    const val EXTRA_KIND = "com.dawntick.app.reminder.KIND"
    const val ACTION_ALARM = "com.dawntick.app.reminder.ALARM"
    const val ACTION_BUTTON = "com.dawntick.app.reminder.BUTTON"
    const val ACTION_PERFORMED = "com.dawntick.app.reminder.PERFORMED"

    private fun prefs(context: Context) = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun readArray(context: Context, key: String): JSONArray {
        val raw = prefs(context).getString(key, "[]") ?: "[]"
        return try {
            JSONArray(raw)
        } catch (_: Exception) {
            JSONArray()
        }
    }

    private fun writeArray(context: Context, key: String, rows: List<JSONObject>) {
        val array = JSONArray()
        for (row in rows) array.put(row)
        prefs(context).edit().putString(key, array.toString()).apply()
    }

    private fun reminderOf(json: JSONObject) = ReminderRecord(
        id = json.optLong("id"),
        title = json.optString("title"),
        body = json.optString("body"),
        at = json.optLong("at"),
        kind = json.optString("kind", "class"),
        targetId = json.optString("targetId"),
    )

    private fun toJson(record: ReminderRecord) = JSONObject()
        .put("id", record.id)
        .put("title", record.title)
        .put("body", record.body)
        .put("at", record.at)
        .put("kind", record.kind)
        .put("targetId", record.targetId)

    private fun actionOf(json: JSONObject) = PendingAction(
        id = json.optLong("id"),
        action = json.optString("action"),
        targetId = json.optString("targetId"),
        kind = json.optString("kind", "class"),
    )

    private fun toJson(action: PendingAction) = JSONObject()
        .put("id", action.id)
        .put("action", action.action)
        .put("targetId", action.targetId)
        .put("kind", action.kind)

    @Synchronized
    fun list(context: Context): List<ReminderRecord> {
        val rows = readArray(context, KEY_REMINDERS)
        return (0 until rows.length()).mapNotNull { index ->
            rows.optJSONObject(index)?.let { reminderOf(it) }
        }
    }

    @Synchronized
    fun find(context: Context, id: Long): ReminderRecord? =
        list(context).firstOrNull { it.id == id }

    @Synchronized
    fun put(context: Context, record: ReminderRecord) {
        val items = list(context).filterNot { it.id == record.id } + record
        writeArray(context, KEY_REMINDERS, items.map { toJson(it) })
    }

    @Synchronized
    fun remove(context: Context, id: Long) {
        val items = list(context).filterNot { it.id == id }
        writeArray(context, KEY_REMINDERS, items.map { toJson(it) })
    }

    /** 移除同一目标在 `before` 之前的所有提醒，返回被移除的记录（用于取消闹钟与通知）。 */
    @Synchronized
    fun removeBefore(context: Context, targetId: String, before: Long): List<ReminderRecord> {
        val items = list(context)
        val removed = items.filter { it.targetId == targetId && it.at < before }
        writeArray(context, KEY_REMINDERS, items.filterNot { it.targetId == targetId && it.at < before }.map { toJson(it) })
        return removed
    }

    @Synchronized
    fun queueAction(context: Context, action: PendingAction) {
        val rows = readArray(context, KEY_ACTIONS)
        val items = (0 until rows.length()).mapNotNull { rows.optJSONObject(it)?.let(::actionOf) }
        if (items.any { it.id == action.id && it.action == action.action }) return
        writeArray(context, KEY_ACTIONS, (items + action).map { toJson(it) })
    }

    /** 取走全部待处理动作：调用方负责处理，重复调用不会重复返回。 */
    @Synchronized
    fun drainActions(context: Context): List<PendingAction> {
        val rows = readArray(context, KEY_ACTIONS)
        val items = (0 until rows.length()).mapNotNull { rows.optJSONObject(it)?.let(::actionOf) }
        prefs(context).edit().putString(KEY_ACTIONS, "[]").apply()
        return items
    }

    /** JS 已在线收到该动作时从队列里移除，避免下次 poll 重复处理。 */
    @Synchronized
    fun removeQueuedAction(context: Context, id: Long, action: String) {
        val rows = readArray(context, KEY_ACTIONS)
        val items = (0 until rows.length()).mapNotNull { rows.optJSONObject(it)?.let(::actionOf) }
        var removed = false
        val kept = items.filterNot {
            if (!removed && it.id == id && it.action == action) {
                removed = true
                true
            } else {
                false
            }
        }
        if (removed) writeArray(context, KEY_ACTIONS, kept.map { toJson(it) })
    }

    @Synchronized
    fun addMute(context: Context, targetId: String, until: Long) {
        if (targetId.isEmpty()) return
        val now = System.currentTimeMillis()
        val items = muteList(context).filter { it.until > now && it.targetId != targetId } + MuteRecord(targetId, until)
        val rows = items.map { JSONObject().put("targetId", it.targetId).put("until", it.until) }
        writeArray(context, KEY_MUTES, rows)
    }

    @Synchronized
    fun isMuted(context: Context, targetId: String): Boolean {
        if (targetId.isEmpty()) return false
        val now = System.currentTimeMillis()
        return muteList(context).any { it.targetId == targetId && it.until > now }
    }

    private fun muteList(context: Context): List<MuteRecord> {
        val rows = readArray(context, KEY_MUTES)
        return (0 until rows.length()).mapNotNull { index ->
            rows.optJSONObject(index)?.let {
                MuteRecord(it.optString("targetId"), it.optLong("until"))
            }
        }
    }
}
