package com.dawntick.app.reminder

/**
 * 提醒动作表（R-07）：与 TS `apps/web/src/lib/reminder-actions.ts`、
 * Rust `apps/desktop/src-tauri/src/reminder_actions.rs` 保持同一组动作。
 *
 * 课前提醒只有贪睡/勿扰；待办、作业、考试、实验多一个「完成」。
 * 用表驱动，避免在投递与通知构建处写 if 链。
 */
internal object ReminderActionTable {
    const val SNOOZE = "snooze"
    const val DONE = "done"
    const val MUTE = "mute"

    const val SNOOZE_MINUTES = 10L
    const val MUTE_MINUTES = 60L

    private val CLASS_ACTIONS = listOf(SNOOZE, MUTE)
    private val EVENT_ACTIONS = listOf(SNOOZE, DONE, MUTE)

    private val ACTIONS_BY_KIND = mapOf(
        "class" to CLASS_ACTIONS,
        "todo" to EVENT_ACTIONS,
        "homework" to EVENT_ACTIONS,
        "exam" to EVENT_ACTIONS,
        "lab" to EVENT_ACTIONS,
    )

    private val LABELS = mapOf(
        SNOOZE to "贪睡 $SNOOZE_MINUTES 分钟",
        DONE to "完成",
        MUTE to "勿扰 $MUTE_MINUTES 分钟",
    )

    /** 未知类别按日程处理（Web 层不会传未知值，这里只做防御）。 */
    fun ids(kind: String): List<String> = ACTIONS_BY_KIND[kind] ?: EVENT_ACTIONS

    fun supports(kind: String, action: String): Boolean = ids(kind).contains(action)

    fun label(action: String): String = LABELS[action] ?: action
}
