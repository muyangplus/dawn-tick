package com.dawntick.app.lan

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 局域网同步（I-14）的 Android 服务端插件。
 *
 * 边界：
 * - 只做监听与请求转发：配对码、令牌、范围与业务数据全在 TS；
 * - 方法名与字段名逐字对应 apps/web/src/lib/plugins.ts 的 `LanSyncPlugin` 与
 *   apps/mobile/docs/plugins.contract.md，协议见 apps/mobile/docs/lan-sync.contract.md；
 * - `start` 用通配地址监听，resolve 前确认 socket 已 bind，返回 `{host, port, listening:true}`；
 *   失败时把原始异常 message 原样交给 TS（界面拼「开启配对失败：<原因>」）。
 *
 * 卡住的兜底：
 * - `start` 的网络操作在后台线程，另起一个 10 秒看门狗，超时就 reject 一句可照做的文案；
 * - 看门狗与真实结果用同一个 `AtomicBoolean` 抢答，保证 resolve / reject 只发生一次；
 * - UDP 广播启动失败只记日志，不影响监听成功的 resolve（发现是增强能力，不是开配对前提）。
 */
@CapacitorPlugin(name = "LanSync")
class LanSyncPlugin : Plugin() {
    private val lock = Any()
    private var server: LanSyncServer? = null

    /** 起监听；可选 `host` 指定本机网络地址，缺省自动选首选局域网。 */
    @PluginMethod
    fun start(call: PluginCall) {
        val host = call.getString("host")
        val settled = AtomicBoolean(false)
        // 绑定 socket 是网络操作：放到后台线程，避免主线程 NetworkOnMainThread
        val watchdog = Thread {
            try {
                Thread.sleep(START_TIMEOUT_MS)
            } catch (_: InterruptedException) {
                return@Thread
            }
            if (settled.compareAndSet(false, true)) {
                Log.w(TAG, "开启局域网配对超时（${START_TIMEOUT_MS}ms）")
                call.reject("开启配对超时：请确认已连接 Wi-Fi 后重试")
            }
        }.apply {
            isDaemon = true
            name = "lan-sync-start-watchdog"
            start()
        }
        Thread {
            try {
                val active = synchronized(lock) {
                    val existing = server
                    val requested = host?.trim()
                    if (existing != null && (requested.isNullOrEmpty() || existing.host == requested)) {
                        existing
                    } else {
                        // 与桌面 lan_sync_start 一致：地址变了就先停旧监听再起新的
                        existing?.stop()
                        server = null
                        val started = LanSyncServer.start(host)
                        server = started
                        started
                    }
                }
                // 二期发现：开配对期间广播设备名与 HTTP 端口，不含配对码。
                // 广播失败不影响开配对：监听与配对码已经可用。
                runCatching {
                    LanDiscoveryAdvertiser.start(active.host, active.port, LanDiscoveryCodec.deviceName())
                }.onFailure { error ->
                    Log.w(TAG, "局域网发现广播启动失败：${error.message ?: error.javaClass.simpleName}")
                }
                if (settled.compareAndSet(false, true)) {
                    call.resolve(JSObject().put("host", active.host).put("port", active.port).put("listening", true))
                }
            } catch (error: Throwable) {
                val reason = describe(error)
                Log.w(TAG, "开启局域网配对失败：$reason")
                if (settled.compareAndSet(false, true)) {
                    reject(call, reason, error)
                }
            } finally {
                watchdog.interrupt()
            }
        }.apply {
            isDaemon = true
            name = "lan-sync-start"
            start()
        }
    }

    /** 关监听并让等待中的连接立即结束；重复调用保持成功（幂等）。 */
    @PluginMethod
    fun stop(call: PluginCall) {
        stopServer()
        call.resolve()
    }

    /** 列出本机候选网络（地址 / 网卡名 / 分类 / 首选优先级），供「切换网络」下拉。 */
    @PluginMethod
    fun networks(call: PluginCall) {
        Thread {
            try {
                val array = JSArray()
                for (network in LanNetworks.list()) array.put(network.toJsObject())
                call.resolve(JSObject().put("networks", array))
            } catch (error: Throwable) {
                reject(call, error.message ?: "读取本机网络失败", error)
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    /** 扫描同网设备（UDP 广播，短超时）；只返回设备名 / 地址 / 端口。 */
    @PluginMethod
    fun scanDiscovery(call: PluginCall) {
        val timeoutMs = (call.data.opt("timeoutMs") as? Number)?.toInt() ?: 1500
        Thread {
            try {
                val array = JSArray()
                for (peer in LanDiscovery.scan(timeoutMs)) array.put(peer.toJsObject())
                call.resolve(JSObject().put("peers", array))
            } catch (error: Throwable) {
                reject(call, error.message ?: "扫描局域网设备失败", error)
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    /** 取一条待处理请求；队列空时 resolve 空对象，TS 侧按 null 处理。 */
    @PluginMethod
    fun poll(call: PluginCall) {
        val request = synchronized(lock) { server?.poll() }
        if (request == null) {
            call.resolve()
            return
        }
        call.resolve(request.toJsObject())
    }

    /** 回写 TS 的处理结果；请求已超时（10 秒）时 reject。 */
    @PluginMethod
    fun respond(call: PluginCall) {
        // 桥过来的数字可能是 Integer/Long/Double，统一按 Number 取，避免 getLong 只认 Long
        val id = (call.data.opt("id") as? Number)?.toLong()
        val status = (call.data.opt("status") as? Number)?.toInt()
        val body = call.getString("body")
        if (id == null || status == null || body == null) {
            call.reject("缺少 id / status / body")
            return
        }
        val active = synchronized(lock) { server }
        if (active == null) {
            call.reject("局域网同步服务没有开启")
            return
        }
        try {
            active.respond(id, status, body)
            call.resolve()
        } catch (error: Exception) {
            reject(call, error.message ?: "回应请求失败", error)
        }
    }

    /** 页面销毁时停服务与广播。 */
    override fun handleOnDestroy() {
        stopServer()
    }

    private fun stopServer() {
        runCatching { LanDiscoveryAdvertiser.stop() }
        runCatching {
            synchronized(lock) {
                server?.stop()
                server = null
            }
        }
    }

    private fun reject(call: PluginCall, message: String, error: Throwable?) {
        if (error is Exception) call.reject(message, error) else call.reject(message)
    }

    /** 原始异常 message 优先；没有 message 时退回异常类名，保证 TS 拿到可读原因。 */
    private fun describe(error: Throwable): String {
        val message = error.message?.trim()
        return if (message.isNullOrEmpty()) error.javaClass.simpleName else message
    }

    companion object {
        private const val TAG = "DawnTickLanSync"

        /** 卡住时最多等 10 秒；TS 侧另有 8 秒超时，先于这里回到可重试状态。 */
        const val START_TIMEOUT_MS = 10_000L
    }
}
