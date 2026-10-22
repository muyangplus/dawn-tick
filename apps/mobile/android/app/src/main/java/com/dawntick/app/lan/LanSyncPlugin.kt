package com.dawntick.app.lan

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 局域网同步（I-14）的 Android 服务端插件。
 *
 * 边界：
 * - 只做监听与请求转发：配对码、令牌、范围与业务数据全在 TS；
 * - 方法名与字段名逐字对应 apps/web/src/lib/plugins.ts 的 `LanSyncPlugin` 与
 *   apps/mobile/docs/plugins.contract.md，协议见 apps/mobile/docs/lan-sync.contract.md。
 */
@CapacitorPlugin(name = "LanSync")
class LanSyncPlugin : Plugin() {
    private val lock = Any()
    private var server: LanSyncServer? = null

    /** 起监听；绑定在本机局域网地址上，端口由系统分配。 */
    @PluginMethod
    fun start(call: PluginCall) {
        // 绑定 socket 是网络操作：放到后台线程，避免主线程 NetworkOnMainThread
        Thread {
            try {
                val active = synchronized(lock) {
                    server ?: LanSyncServer.start().also { server = it }
                }
                // 二期发现：开配对期间广播设备名与 HTTP 端口，不含配对码
                LanDiscoveryAdvertiser.start(active.host, active.port, LanDiscoveryCodec.deviceName())
                call.resolve(JSObject().put("host", active.host).put("port", active.port))
            } catch (error: Exception) {
                call.reject(error.message ?: "开启局域网配对失败", error)
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    /** 关监听并让等待中的连接立即结束。 */
    @PluginMethod
    fun stop(call: PluginCall) {
        LanDiscoveryAdvertiser.stop()
        synchronized(lock) {
            server?.stop()
            server = null
        }
        call.resolve()
    }

    /** 扫描同网设备（UDP 广播，短超时）；只返回设备名 / 地址 / 端口。 */
    @PluginMethod
    fun scanDiscovery(call: PluginCall) {
        val timeoutMs = (call.data.opt("timeoutMs") as? Number)?.toInt() ?: 1500
        Thread {
            try {
                val array = com.getcapacitor.JSArray()
                for (peer in LanDiscovery.scan(timeoutMs)) array.put(peer.toJsObject())
                call.resolve(JSObject().put("peers", array))
            } catch (error: Exception) {
                call.reject(error.message ?: "扫描局域网设备失败", error)
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
            call.reject(error.message ?: "回应请求失败", error)
        }
    }

    /** 页面销毁时停服务与广播。 */
    override fun handleOnDestroy() {
        LanDiscoveryAdvertiser.stop()
        synchronized(lock) {
            server?.stop()
            server = null
        }
    }
}
