package com.dawntick.app.ai

import com.dawntick.app.R
import com.dawntick.app.diag.NativeLog
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * AI 流式请求插件：CapacitorHttp 会把响应整段缓冲，SSE 逐字输出走这条原生通道。
 *
 * `start` 立即 resolve，之后按请求 id 通过 `aiStream` 事件依次推送 `status` → 若干 `chunk` → `end` 或 `error`。
 * 契约见 apps/web/src/lib/plugins.ts 与 apps/mobile/docs/plugins.contract.md；请求头带 API Key，不进日志。
 */
@CapacitorPlugin(name = "AiStream")
class AiStreamPlugin : Plugin() {
    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private val connections = ConcurrentHashMap<String, HttpURLConnection>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()

    /** 发起请求：参数 `id`、`url`、`headers`、`body`。 */
    @PluginMethod
    fun start(call: PluginCall) {
        val id = call.getString("id")
        val url = call.getString("url")
        val body = call.getString("body") ?: ""
        if (id.isNullOrEmpty() || url.isNullOrEmpty()) {
            NativeLog.warn(context, SCOPE, "AiStreamPlugin.start 缺少参数 id 或 url")
            call.reject(context.getString(R.string.ai_stream_missing_args))
            return
        }
        val parsed = try {
            URL(url)
        } catch (error: Exception) {
            NativeLog.warn(context, SCOPE, "AiStreamPlugin.start 地址无效 cause=${error.javaClass.simpleName}")
            call.reject(context.getString(R.string.ai_stream_bad_url))
            return
        }
        if (parsed.protocol != "https" && parsed.protocol != "http") {
            NativeLog.warn(context, SCOPE, "AiStreamPlugin.start 不支持的协议 protocol=${parsed.protocol}")
            call.reject(context.getString(R.string.ai_stream_bad_url))
            return
        }
        val headers = mutableMapOf<String, String>()
        call.getObject("headers")?.let { obj ->
            for (key in obj.keys()) obj.getString(key)?.let { headers[key] = it }
        }
        cancelled.remove(id)
        call.resolve()
        executor.execute { run(id, parsed, headers, body) }
    }

    /** 取消：断开连接，之后不再推送这个 id 的事件。 */
    @PluginMethod
    fun cancel(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrEmpty()) {
            NativeLog.warn(context, SCOPE, "AiStreamPlugin.cancel 缺少参数 id")
            call.reject(context.getString(R.string.ai_stream_missing_args))
            return
        }
        cancelled.add(id)
        connections.remove(id)?.disconnect()
        call.resolve()
    }

    override fun handleOnDestroy() {
        executor.shutdownNow()
        connections.values.forEach { it.disconnect() }
        connections.clear()
        super.handleOnDestroy()
    }

    private fun emit(id: String, type: String, fill: (JSObject) -> Unit = {}) {
        if (cancelled.contains(id)) return
        val event = JSObject().put("id", id).put("type", type)
        fill(event)
        notifyListeners(EVENT, event)
    }

    private fun run(id: String, url: URL, headers: Map<String, String>, body: String) {
        var connection: HttpURLConnection? = null
        try {
            connection = url.openConnection() as HttpURLConnection
            connections[id] = connection
            val bytes = body.toByteArray(Charsets.UTF_8)
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(bytes.size)
            for ((key, value) in headers) connection.setRequestProperty(key, value)
            connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            emit(id, "status") { it.put("status", status) }
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            if (stream != null) {
                InputStreamReader(stream, Charsets.UTF_8).use { reader ->
                    val buffer = CharArray(BUFFER_CHARS)
                    while (!cancelled.contains(id)) {
                        val read = reader.read(buffer)
                        if (read < 0) break
                        if (read > 0) emit(id, "chunk") { it.put("text", String(buffer, 0, read)) }
                    }
                }
            }
            emit(id, "end")
        } catch (error: Exception) {
            // 取消时断开连接会抛异常，属预期分支
            if (cancelled.contains(id)) return
            NativeLog.warn(context, SCOPE, "AiStreamPlugin 请求失败 cause=${error.javaClass.simpleName}")
            val message = context.getString(R.string.ai_stream_failed, error.javaClass.simpleName)
            emit(id, "error") { it.put("message", message) }
        } finally {
            connections.remove(id)
            connection?.disconnect()
            cancelled.remove(id)
        }
    }

    private companion object {
        const val SCOPE = "app"
        const val EVENT = "aiStream"
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 120_000
        const val BUFFER_CHARS = 2048
    }
}
