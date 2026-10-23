package com.dawntick.app.lan

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * 局域网同步（I-14）的 Android 传输层：只做监听、排队、取请求与回响应。
 *
 * 边界：
 * - 只绑定本机局域网 IPv4 与系统分配的端口，只接受局域网来源；
 * - 配对码、令牌、范围与数据导出导入全在 TS（apps/web/src/lan-sync*.ts），
 *   这里不读数据库、不解释业务 JSON，只把请求编号入队，等 TS 的 poll/respond；
 * - 协议与两端对照见 apps/mobile/docs/lan-sync.contract.md。
 */
data class LanRequest(
    val id: Long,
    val method: String,
    val path: String,
    val query: String,
    val authorization: String?,
    val body: String,
    val receivedAt: Long,
) {
    /** 字段名与 Rust `lan_sync_poll`、TS `LanSyncRequest` 逐字一致。 */
    /** 转成 Capacitor 的 JSObject：call.resolve 只认 JSObject，JSONObject 不兼容。 */
    fun toJsObject(): com.getcapacitor.JSObject = com.getcapacitor.JSObject()
        .put("id", id)
        .put("method", method)
        .put("path", path)
        .put("query", query)
        .put("body", body)
        .put("receivedAt", receivedAt)
        .apply { authorization?.let { put("authorization", it) } }
}

class LanSyncServer private constructor(
    val host: String,
    val port: Int,
    private val serverSocket: ServerSocket,
) {
    private class Reply(val status: Int, val body: String)

    private class RequestHead(
        val method: String,
        val path: String,
        val query: String,
        val authorization: String?,
        val contentLength: Int,
    )

    private class RequestException(val status: Int, message: String) : Exception(message)

    private val running = AtomicBoolean(true)
    private val queue = LinkedBlockingQueue<LanRequest>(MAX_PENDING)
    private val waiters = ConcurrentHashMap<Long, ArrayBlockingQueue<Reply>>()
    private val nextId = AtomicLong(0)
    private val acceptThread = Thread { acceptLoop() }.apply {
        isDaemon = true
        name = "lan-sync-accept"
        start()
    }

    /** 取一条待处理请求；队列空时 null。 */
    fun poll(): LanRequest? = queue.poll()

    /** 回写 TS 的处理结果；请求已超时或不存在时抛错。 */
    fun respond(id: Long, status: Int, body: String) {
        if (status !in 100..599) throw IllegalArgumentException("HTTP 状态码不合法：$status")
        if (body.toByteArray(Charsets.UTF_8).size > MAX_RESPONSE_BYTES) {
            throw IllegalArgumentException("响应体超过 20MB 上限")
        }
        val waiter = waiters.remove(id) ?: throw IllegalStateException("请求已超时或不存在")
        waiter.offer(Reply(status, body))
    }

    /** 停止监听：关 socket 让 accept 退出，并清空队列与等待中的连接。 */
    fun stop() {
        if (!running.compareAndSet(true, false)) return
        runCatching { serverSocket.close() }
        waiters.clear()
        queue.clear()
    }

    private fun acceptLoop() {
        while (running.get()) {
            val client = try {
                serverSocket.accept()
            } catch (error: SocketException) {
                break
            } catch (error: Exception) {
                if (!running.get()) break else continue
            }
            Thread { handle(client) }.apply {
                isDaemon = true
                start()
            }
        }
    }

    private fun handle(client: Socket) {
        client.use { socket ->
            socket.soTimeout = READ_TIMEOUT_MS
            try {
                if (!isLanAddress(socket.inetAddress)) {
                    writeJson(socket, 403, errorBody("forbidden", "只接受同一局域网内的请求"))
                    return
                }
                val head = readHead(socket.getInputStream()) ?: run {
                    writeJson(socket, 400, errorBody("bad_request", "请求不完整"))
                    return
                }
                if (head.method == "OPTIONS") {
                    writeEmpty(socket, 204)
                    return
                }
                val expected = expectedMethod(head.path)
                if (expected == null) {
                    writeJson(socket, 404, errorBody("not_found", "没有该接口"))
                    return
                }
                if (head.method != expected) {
                    writeJson(socket, 405, errorBody("method_not_allowed", "请求方法不对"))
                    return
                }
                val body = readBody(socket.getInputStream(), head.contentLength)
                val id = nextId.incrementAndGet()
                val waiter = ArrayBlockingQueue<Reply>(1)
                waiters[id] = waiter
                val request = LanRequest(
                    id = id,
                    method = head.method,
                    path = head.path,
                    query = head.query,
                    authorization = head.authorization,
                    body = body,
                    receivedAt = System.currentTimeMillis(),
                )
                if (!queue.offer(request)) {
                    waiters.remove(id)
                    writeJson(socket, 503, errorBody("busy", "请求队列已满，请稍后重试"))
                    return
                }
                val reply = waiter.poll(RESPONSE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                if (reply == null) {
                    waiters.remove(id)
                    queue.removeIf { item -> item.id == id }
                    writeJson(socket, 504, errorBody("timeout", "本机没有在 10 秒内处理请求"))
                } else {
                    writeJson(socket, reply.status, reply.body)
                }
            } catch (error: RequestException) {
                runCatching { writeJson(socket, error.status, errorBody(codeFor(error.status), error.message ?: "请求不合法")) }
            } catch (error: Exception) {
                runCatching { writeJson(socket, 400, errorBody("bad_request", error.message ?: "请求解析失败")) }
            }
        }
    }

    /** 逐字节读到 `\r\n\r\n`，再解析请求行与头；超长或格式不对抛 RequestException。 */
    private fun readHead(input: InputStream): RequestHead? {
        val buffer = ByteArrayOutputStream()
        val tail = intArrayOf(-1, -1, -1, -1)
        while (true) {
            val byte = input.read()
            if (byte < 0) return null
            buffer.write(byte)
            tail[0] = tail[1]
            tail[1] = tail[2]
            tail[2] = tail[3]
            tail[3] = byte
            if (tail[0] == 13 && tail[1] == 10 && tail[2] == 13 && tail[3] == 10) break
            if (buffer.size() > HEADER_LIMIT) throw RequestException(431, "请求头过大")
        }
        val text = buffer.toString("UTF-8")
        val end = text.indexOf("\r\n\r\n")
        val lines = text.substring(0, if (end < 0) text.length else end).split("\r\n")
        val requestLine = lines.firstOrNull() ?: throw RequestException(400, "缺少请求行")
        val parts = requestLine.split(" ")
        if (parts.size < 3) throw RequestException(400, "不是 HTTP 请求")
        val method = parts[0]
        if (method != "GET" && method != "POST" && method != "OPTIONS") {
            throw RequestException(405, "不支持的请求方法")
        }
        val target = parts[1]
        if (!target.startsWith("/")) throw RequestException(400, "请求路径不正确")
        val queryIndex = target.indexOf('?')
        val path = if (queryIndex < 0) target else target.substring(0, queryIndex)
        val query = if (queryIndex < 0) "" else target.substring(queryIndex + 1)
        var authorization: String? = null
        var contentLength = 0
        for (line in lines.drop(1)) {
            val separator = line.indexOf(':')
            if (separator <= 0) continue
            val name = line.substring(0, separator).trim()
            val value = line.substring(separator + 1).trim()
            when {
                name.equals("authorization", ignoreCase = true) -> authorization = value
                name.equals("content-length", ignoreCase = true) -> {
                    val parsed = value.toIntOrNull() ?: throw RequestException(400, "Content-Length 不正确")
                    if (parsed > MAX_BODY_BYTES) throw RequestException(413, "请求体超过 5MB 上限")
                    contentLength = parsed
                }
            }
        }
        return RequestHead(method, path, query, authorization, contentLength)
    }

    private fun readBody(input: InputStream, length: Int): String {
        if (length == 0) return ""
        val body = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val read = input.read(body, offset, length - offset)
            if (read <= 0) throw RequestException(400, "请求体不完整")
            offset += read
        }
        return String(body, Charsets.UTF_8)
    }

    private fun expectedMethod(path: String): String? = when (path) {
        "/pair" -> "POST"
        "/export" -> "GET"
        "/import" -> "POST"
        else -> null
    }

    private fun writeEmpty(socket: Socket, status: Int) {
        val head = "HTTP/1.1 $status ${reason(status)}\r\n$CORS_HEADERS" + "Connection: close\r\n\r\n"
        socket.getOutputStream().apply {
            write(head.toByteArray(Charsets.UTF_8))
            flush()
        }
    }

    private fun writeJson(socket: Socket, status: Int, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $status ${reason(status)}\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: ${bytes.size}\r\n" +
            CORS_HEADERS +
            "Connection: close\r\n\r\n"
        socket.getOutputStream().apply {
            write(head.toByteArray(Charsets.UTF_8))
            write(bytes)
            flush()
        }
    }

    private fun errorBody(code: String, message: String): String =
        JSONObject().put("error", JSONObject().put("code", code).put("message", message)).toString()

    private fun codeFor(status: Int): String = when (status) {
        403 -> "forbidden"
        404 -> "not_found"
        405 -> "method_not_allowed"
        413 -> "payload_too_large"
        431, 400 -> "bad_request"
        503 -> "busy"
        504 -> "timeout"
        else -> "bad_request"
    }

    private fun reason(status: Int): String = when (status) {
        200 -> "OK"
        204 -> "No Content"
        400 -> "Bad Request"
        401 -> "Unauthorized"
        403 -> "Forbidden"
        404 -> "Not Found"
        405 -> "Method Not Allowed"
        409 -> "Conflict"
        413 -> "Payload Too Large"
        431 -> "Request Header Fields Too Large"
        500 -> "Internal Server Error"
        503 -> "Service Unavailable"
        504 -> "Gateway Timeout"
        else -> "OK"
    }

    companion object {
        const val MAX_BODY_BYTES = 5 * 1024 * 1024
        const val MAX_RESPONSE_BYTES = 20 * 1024 * 1024
        const val MAX_PENDING = 32
        const val RESPONSE_TIMEOUT_MS = 10_000L
        const val READ_TIMEOUT_MS = 5_000
        const val HEADER_LIMIT = 16 * 1024

        /** 每个响应都带 CORS 头：浏览器端要能当发起方直接 fetch 局域网地址。 */
        private const val CORS_HEADERS =
            "Access-Control-Allow-Origin: *\r\n" +
                "Access-Control-Allow-Headers: Authorization, Content-Type\r\n" +
                "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                "Cache-Control: no-store\r\n"

        /**
         * 绑定指定局域网 IPv4 与系统分配的端口；`host` 为空时自动选首选网络。
         * 绑定失败会抛出带地址的可读错误，由插件 reject 给 TS。
         */
        fun start(host: String? = null): LanSyncServer {
            val address = if (!host.isNullOrBlank()) {
                LanNetworks.findAddress(host)
                    ?: throw IllegalArgumentException("网络地址不在本机：${host.trim()}")
            } else {
                LanNetworks.preferredAddress()
                    ?: throw IllegalStateException("没有找到局域网地址，请先连接 Wi-Fi")
            }
            val socket = try {
                ServerSocket(0, 8, address)
            } catch (error: Throwable) {
                throw IllegalStateException(
                    "监听 ${address.hostAddress} 失败：${error.message ?: error.javaClass.simpleName}",
                    error,
                )
            }
            return LanSyncServer(address.hostAddress ?: "0.0.0.0", socket.localPort, socket)
        }

        private fun isLanAddress(address: InetAddress): Boolean {
            if (address.isLoopbackAddress || address.isSiteLocalAddress || address.isLinkLocalAddress) {
                return true
            }
            val octets = address.address
            // 100.64.0.0/10：运营商级 NAT，手机热点与部分校园网会出现
            return address is Inet4Address && octets.size == 4 &&
                (octets[0].toInt() and 0xFF) == 100 && (octets[1].toInt() and 0xFF) in 64..127
        }
    }
}
