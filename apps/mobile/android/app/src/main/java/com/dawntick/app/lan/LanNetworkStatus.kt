package com.dawntick.app.lan

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.dawntick.app.diag.NativeLog
import com.getcapacitor.JSObject

/**
 * 当前活动网络的状态快照（诊断用，不参与配对/同步逻辑）。
 *
 * 用途：`networks` 为空时界面只有一句「未发现局域网地址」，用户无法判断是没连 Wi-Fi、
 * 只连了移动数据，还是 Wi-Fi 只拿到 IPv6。这里按 `ConnectivityManager` 的网络
 * `NetworkCapabilities` 报告传输类型，并附一行网卡摘要。
 *
 * 边界：
 * - 只读状态，不做任何网络操作；`ACCESS_NETWORK_STATE` 已在 AndroidManifest 声明，无需运行时权限；
 * - 读取失败时四个布尔全部为 false，并把原因写 `NativeLog`（标签 `DawnTickLanSync`），
 *   界面就会退回原来的「未发现局域网地址」文案，不会误报「已连接 Wi-Fi」；
 * - `ipv4Count` 由调用方传入（`LanNetworks.list()` 的结果数），这里不重复枚举。
 */
data class LanNetworkStatus(
    val wifi: Boolean,
    val ethernet: Boolean,
    val mobile: Boolean,
    val vpn: Boolean,
    val ipv4Count: Int,
    val interfaceSummary: String,
) {
    /** 字段名与 TS `LanNetworkStatus`、契约文档逐字一致。 */
    fun toJsObject(): JSObject = JSObject()
        .put("wifi", wifi)
        .put("ethernet", ethernet)
        .put("mobile", mobile)
        .put("vpn", vpn)
        .put("ipv4Count", ipv4Count)
        .put("interfaceSummary", interfaceSummary)

    /** 一行日志摘要，便于在 `native.log` 里快速看出「为什么没有候选地址」。 */
    fun summary(): String =
        "wifi=$wifi ethernet=$ethernet mobile=$mobile vpn=$vpn ipv4Count=$ipv4Count 网卡=$interfaceSummary"
}

/** 通过 `ConnectivityManager` 判断当前有哪些传输类型（Wi-Fi / 有线 / 移动数据 / VPN）。 */
object LanNetworkStatusReader {
    private const val TAG = "DawnTickLanSync"

    /**
     * 读当前状态；[ipv4Count] 与 [interfaceSummary] 由调用方传入，避免重复枚举网卡。
     *
     * 遍历 `allNetworks` 而不是只看默认网络：手机同时连着 Wi-Fi（无 IPv4）与移动数据时，
     * 默认网络可能是移动数据，只看默认网络会把 Wi-Fi 漏掉，界面就会错说「只有移动数据」。
     */
    @Suppress("DEPRECATION") // getAllNetworks 在 API 31 标记过时，但同步读一次诊断仍然最稳；回调式会引入时序竞态
    fun read(context: Context, ipv4Count: Int, interfaceSummary: String): LanNetworkStatus {
        var wifi = false
        var ethernet = false
        var mobile = false
        var vpn = false
        var reason: String? = null
        try {
            val manager = (context.applicationContext ?: context)
                .getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            if (manager == null) {
                reason = "系统没有 ConnectivityManager"
            } else {
                for (network in manager.allNetworks) {
                    val capabilities = manager.getNetworkCapabilities(network) ?: continue
                    if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) wifi = true
                    if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) ethernet = true
                    if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) mobile = true
                    if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) vpn = true
                }
            }
        } catch (error: Throwable) {
            reason = NativeLog.describe(error)
        }
        if (reason != null) {
            NativeLog.warn(context, TAG, "读取网络状态失败：$reason")
        }
        return LanNetworkStatus(
            wifi = wifi,
            ethernet = ethernet,
            mobile = mobile,
            vpn = vpn,
            ipv4Count = ipv4Count.coerceAtLeast(0),
            interfaceSummary = interfaceSummary,
        )
    }
}
