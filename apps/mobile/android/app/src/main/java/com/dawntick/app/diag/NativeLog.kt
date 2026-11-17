package com.dawntick.app.diag

import android.content.Context
import android.net.Uri
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 原生侧诊断日志：追加写入 `filesDir/diag/native.log`，单文件上限 512KB，
 * 写满后滚动为 `native.log.1`（旧的 .1 直接删除，只留一代）。
 *
 * 用途：安卓真机上的插件调用失败（教务窗口、外部链接、小组件读不到快照）没有 logcat 时，
 * 用户可以在应用里导出这段文本定位问题。写入永远不抛异常：失败只降级到 logcat。
 *
 * 格式：`2026-11-07 14:20:10.123 I [WidgetStore] 消息`；消息里的换行折成空格，一条事件一行。
 * 线程安全：所有文件读写都在同一把锁里；[read] 返回最近 [MAX_LINES] 行。
 */
object NativeLog {
    /** 单文件上限；追加前超过就滚动，避免无限增长。 */
    private const val MAX_BYTES = 512 * 1024L
    /** 单次读取默认尾部字节数。 */
    private const val DEFAULT_READ_BYTES = 256 * 1024
    /** 单次读取上限，防止 Web 侧误传大值一次读爆内存。 */
    private const val MAX_READ_BYTES = 1024 * 1024
    /** 返回给 Web 侧的最大行数。 */
    private const val MAX_LINES = 200
    /** 单条消息上限：教务控制台/异常栈可能很长，截断避免一条日志吃掉整个文件。 */
    private const val MAX_MESSAGE_CHARS = 2000
    private const val DIR_NAME = "diag"
    private const val FILE_NAME = "native.log"
    private const val LOGCAT_TAG = "DawnTickNativeLog"

    private val lock = Any()
    private val timeFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    /** 日志文件位置：`<app files>/diag/native.log`；目录不存在时由写入侧创建。 */
    @JvmStatic
    fun logFile(context: Context): File = File(File(context.filesDir, DIR_NAME), FILE_NAME)

    @JvmStatic
    fun info(context: Context, tag: String, message: String) = append(context, "I", tag, message)

    @JvmStatic
    fun warn(context: Context, tag: String, message: String) = append(context, "W", tag, message)

    /** 记录错误；[cause] 不为空时把 `类名: message` 附在消息后面。 */
    @JvmStatic
    @JvmOverloads
    fun error(context: Context, tag: String, message: String, cause: Throwable? = null) {
        append(context, "E", tag, if (cause == null) message else "$message (${describe(cause)})")
    }

    /** 异常转一行：`类名: message`；message 为空时只有类名。外部链接失败提示直接用这段文本。 */
    @JvmStatic
    fun describe(cause: Throwable): String {
        val message = cause.message
        return if (message.isNullOrBlank()) {
            cause.javaClass.simpleName
        } else {
            "${cause.javaClass.simpleName}: $message"
        }
    }

    /**
     * URL 只保留 scheme / host / path：教务地址的查询串可能带登录 token，不写进诊断日志。
     * 解析失败时返回固定文案，调用方不必再判空。
     */
    @JvmStatic
    fun redactUrl(value: String?): String {
        if (value.isNullOrBlank()) return "(空)"
        return try {
            val uri = Uri.parse(value)
            val scheme = uri.scheme ?: return "(无 scheme)"
            val host = uri.host ?: ""
            val path = uri.path ?: ""
            "$scheme://$host$path"
        } catch (_: Exception) {
            "(无法解析)"
        }
    }

    /**
     * 读最近 [maxBytes] 字节（默认 256KB），最多 [MAX_LINES] 行；文件不存在返回空串。
     * 截断落在整行边界上：按字节切完丢掉第一段残缺行，避免 UTF-8 多字节字符被切坏。
     */
    @JvmStatic
    @JvmOverloads
    fun read(context: Context, maxBytes: Int = DEFAULT_READ_BYTES): String {
        val limit = maxBytes.coerceIn(4096, MAX_READ_BYTES)
        synchronized(lock) {
            val file = logFile(context)
            if (!file.exists()) return ""
            return try {
                val bytes = file.readBytes()
                val start = (bytes.size - limit).coerceAtLeast(0)
                var text = String(bytes, start, bytes.size - start, Charsets.UTF_8)
                if (start > 0) {
                    val newline = text.indexOf('\n')
                    text = if (newline >= 0) text.substring(newline + 1) else ""
                }
                text.lines().takeLast(MAX_LINES).joinToString("\n")
            } catch (error: Exception) {
                Log.w(LOGCAT_TAG, "读诊断日志失败", error)
                ""
            }
        }
    }

    /** 删除当前日志与滚动文件；不存在时也按成功处理。 */
    @JvmStatic
    fun clear(context: Context) {
        synchronized(lock) {
            val file = logFile(context)
            file.delete()
            File(file.path + ".1").delete()
        }
    }

    private fun append(context: Context, level: String, tag: String, message: String) {
        synchronized(lock) {
            try {
                val file = logFile(context)
                file.parentFile?.mkdirs()
                if (file.length() > MAX_BYTES) rotate(file)
                val text = "${timeFormat.format(Date())} $level [$tag] ${oneLine(message)}\n"
                FileOutputStream(file, true).use { output -> output.write(text.toByteArray(Charsets.UTF_8)) }
            } catch (error: Exception) {
                // 诊断日志本身不能再抛错：只降级到 logcat
                Log.w(LOGCAT_TAG, "写诊断日志失败 tag=$tag", error)
            }
        }
    }

    /** 滚动：`native.log` → `native.log.1`，旧 .1 先删；重命名失败时直接丢掉当前文件。 */
    private fun rotate(file: File) {
        val backup = File(file.path + ".1")
        backup.delete()
        if (!file.renameTo(backup)) file.delete()
    }

    private fun oneLine(message: String): String {
        val flattened = message.replace('\r', ' ').replace('\n', ' ')
        return if (flattened.length <= MAX_MESSAGE_CHARS) {
            flattened
        } else {
            flattened.substring(0, MAX_MESSAGE_CHARS) + "…"
        }
    }
}
