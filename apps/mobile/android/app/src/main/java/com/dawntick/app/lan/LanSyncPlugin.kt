package com.dawntick.app.lan

import android.util.Log
import com.dawntick.app.diag.NativeLog
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
 *   `host` 未传或已失效时回退 `LanNetworks.preferredAddress()`；仍失败时 reject
 *   「异常类: message」，界面拼「开启配对失败：<原因>」；
 * - `networks` 返回 `{networks, status}`：`networks` 是可配对的 IPv4 候选，`status` 是
 *   `ConnectivityManager` 的传输类型快照（`wifi/ethernet/mobile/vpn/ipv4Count/interfaceSummary`），
 *   供界面解释「为什么没有候选地址」；枚举失败仍 reject 可读原因，
 *   界面显示「读取本机网络失败：…」。候选为空时把全部网卡写日志（含 IPv6 / 回环），
 *   区分「没有网卡」与「只有 IPv6 / 移动数据」。
 *
 * 诊断：入口参数、网络摘要、bind 成功/失败、广播启动失败都写 `filesDir/diag/native.log`
 * （标签 `DawnTickLanSync`），真机没有 logcat 时也能导出定位。
 *
 * 卡住的兜底：
 * - `start` 的网络操作在后台线程，另起一个 10 秒看门狗，超时就 reject 一句可照做的文案；
 * - 看门狗与真实结果用同一个 `AtomicBoolean` 抢答，保证 resolve / reject 只发生一次；
 * - UDP 广播 / multicast lock 失败只记日志，不影响监听成功的 resolve。
 */
@CapacitorPlugin(name = "LanSync")
class LanSyncPlugin : Plugin() {
    private val lock = Any()
    private var server: LanSyncServer? = null

    /** 起监听；可选 `host` 指定本机网络地址，可选 `deviceId` 进 UDP 广播，缺省自动选首选局域网。 */
    @PluginMethod
    fun start(call: PluginCall) {
        val requested = call.getString("host")?.trim()?.takeIf { it.isNotEmpty() }
        val requestedDeviceId = normalizeLanDeviceId(call.getString("deviceId"))
        diagInfo("start 入口 host=${requested ?: "(自动选择)"} deviceId=${requestedDeviceId ?: "(无)"}")
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
                diagWarn("开启局域网配对超时（${START_TIMEOUT_MS}ms）")
                call.reject("开启配对超时：请确认已连接 Wi-Fi 后重试")
            }
        }.apply {
            isDaemon = true
            name = "lan-sync-start-watchdog"
            start()
        }
        Thread {
            try {
                val host = resolveHost(requested)
                val active = synchronized(lock) {
                    val existing = server
                    if (existing != null && (host == null || existing.host == host)) {
                        diagInfo("复用现有监听 ${existing.host}:${existing.port}")
                        existing
                    } else {
                        // 与桌面 lan_sync_start 一致：地址变了就先停旧监听再起新的
                        existing?.stop()
                        server = null
                        val started = LanSyncServer.start(host)
                        server = started
                        diagInfo("监听成功 ${started.host}:${started.port}")
                        started
                    }
                }
                // 二期发现：开配对期间广播设备名、HTTP 端口与稳定 deviceId，不含配对码。
                // 广播失败不影响开配对：监听与配对码已经可用。
                runCatching {
                    LanDiscoveryAdvertiser.start(
                        context,
                        active.host,
                        active.port,
                        LanDiscoveryCodec.deviceName(),
                        requestedDeviceId,
                    )
                    diagInfo("局域网发现广播已启动")
                }.onFailure { error ->
                    Log.w(TAG, "局域网发现广播启动失败：${error.message ?: error.javaClass.simpleName}")
                    diagWarn("局域网发现广播启动失败：${NativeLog.describe(error)}")
                }
                if (settled.compareAndSet(false, true)) {
                    call.resolve(JSObject().put("host", active.host).put("port", active.port).put("listening", true))
                }
            } catch (error: Throwable) {
                val reason = NativeLog.describe(error)
                Log.w(TAG, "开启局域网配对失败：$reason")
                diagError("开启局域网配对失败", error)
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

    /**
     * 解析实际使用的对外地址：用户选中地址仍在本机网卡上才用；否则回退首选局域网。
     * 返回 null 表示交给 `LanSyncServer.start` 走 `LanNetworks.preferredAddress()`。
     */
    private fun resolveHost(requested: String?): String? {
        if (requested == null) {
            diagInfo("未指定网络地址，使用首选局域网")
            return null
        }
        val stillPresent = runCatching { LanNetworks.findAddress(requested) != null }
            .onFailure { error ->
                diagWarn("校验指定地址失败：${NativeLog.describe(error)}")
            }
            .getOrDefault(false)
        if (stillPresent) return requested
        diagWarn("指定地址不在本机网卡上，回退首选局域网：$requested")
        return null
    }

    /** 关监听并让等待中的连接立即结束；重复调用保持成功（幂等）。 */
    @PluginMethod
    fun stop(call: PluginCall) {
        diagInfo("stop 入口")
        stopServer()
        call.resolve()
    }

    /** 列出本机候选网络（地址 / 网卡名 / 分类 / 首选优先级）与当前网络状态，供「切换网络」下拉与空态文案。 */
    @PluginMethod
    fun networks(call: PluginCall) {
        diagInfo("networks 入口")
        Thread {
            try {
                var list = LanNetworks.list()
                val interfaces = LanNetworks.interfaces()
                var summary = LanNetworks.interfaceSummary(interfaces)
                if (list.isEmpty()) {
                    // 部分 ROM 下 NetworkInterface 枚举为空但系统能拿到链路地址：用 ConnectivityManager 兜底
                    val fallback = LanNetworkStatusReader.linkCandidates(context)
                    if (fallback.isNotEmpty()) {
                        diagWarn("NetworkInterface 未枚举到候选，改用 ConnectivityManager 链路：${LanNetworks.summary(fallback)}")
                        list = fallback
                        summary = "ConnectivityManager 链路：${LanNetworks.summary(fallback)}"
                    }
                }
                val status = LanNetworkStatusReader.read(context, list.size, summary)
                diagInfo("networks 结果 ${list.size} 个：${LanNetworks.summary(list)}；状态 ${status.summary()}")
                if (list.isEmpty()) {
                    // 空候选时把全部网卡写日志：能看出是「没有网卡」还是「只有 IPv6 / 移动数据」
                    diagWarn("networks 为空，全部网卡：${LanNetworks.describeInterfaces(interfaces)}")
                }
                val array = JSArray()
                for (network in list) array.put(network.toJsObject())
                call.resolve(JSObject().put("networks", array).put("status", status.toJsObject()))
            } catch (error: Throwable) {
                val reason = NativeLog.describe(error)
                diagError("networks 失败", error)
                reject(call, reason, error)
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
        diagInfo("scanDiscovery 入口 timeoutMs=$timeoutMs")
        Thread {
            try {
                val peers = LanDiscovery.scan(context, timeoutMs)
                diagInfo("scanDiscovery 结果 ${peers.size} 个")
                val array = JSArray()
                for (peer in peers) array.put(peer.toJsObject())
                call.resolve(JSObject().put("peers", array))
            } catch (error: Throwable) {
                val reason = NativeLog.describe(error)
                diagError("scanDiscovery 失败", error)
                reject(call, reason, error)
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
            reject(call, NativeLog.describe(error), error)
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
        diagInfo("stop 完成")
    }

    private fun reject(call: PluginCall, message: String, error: Throwable?) {
        if (error is Exception) call.reject(message, error) else call.reject(message)
    }

    private fun diagInfo(message: String) {
        runCatching { NativeLog.info(context, TAG, message) }
    }

    private fun diagWarn(message: String) {
        runCatching { NativeLog.warn(context, TAG, message) }
    }

    private fun diagError(message: String, error: Throwable) {
        runCatching { NativeLog.error(context, TAG, message, error) }
    }

    companion object {
        private const val TAG = "DawnTickLanSync"

        /** 卡住时最多等 10 秒；TS 侧另有 8 秒超时，先于这里回到可重试状态。 */
        const val START_TIMEOUT_MS = 10_000L
    }
}
