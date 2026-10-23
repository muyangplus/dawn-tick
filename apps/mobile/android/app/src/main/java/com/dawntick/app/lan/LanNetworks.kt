package com.dawntick.app.lan

import com.getcapacitor.JSObject
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InterfaceAddress
import java.net.NetworkInterface
import java.util.Collections

/**
 * 局域网多网络识别（Android）：枚举本机 IPv4、分类与首选排序。
 *
 * 边界：
 * - 排序、网段优先级、分类都是纯 JVM 逻辑；枚举只在 [list]；
 * - `kind` 只是按网卡名推断的展示分类（wifi / ethernet / vpn / other），不做承诺；
 * - VPN 与虚拟网卡**降级**（排到后面）而不是直接丢弃：只有 VPN 时仍可用；
 * - 与桌面 `apps/desktop/src-tauri/src/lan_network.rs`、TS `apps/web/src/lan-sync-network.ts`
 *   保持同一套排序规则：局域网优先 → 有线/无线 → 网段优先级 → 地址数值。
 */
data class LanNetwork(
    val name: String,
    val address: String,
    val isLan: Boolean,
    val kind: String,
    val preferred: Int,
) {
    /** 字段名与 Rust `LanNetwork`、TS `LanNetwork` 逐字一致。 */
    fun toJsObject(): JSObject = JSObject()
        .put("name", name)
        .put("address", address)
        .put("isLan", isLan)
        .put("kind", kind)
        .put("preferred", preferred)
}

object LanNetworks {
    const val KIND_WIFI = "wifi"
    const val KIND_ETHERNET = "ethernet"
    const val KIND_VPN = "vpn"
    const val KIND_OTHER = "other"

    /** 常见局域网网段优先级：192.168 > 10 > 172.16–31 > 100.64 > 169.254 > 其它。 */
    fun addressRank(address: Inet4Address): Int {
        val octets = address.address
        val first = octets[0].toInt() and 0xFF
        val second = octets[1].toInt() and 0xFF
        return when {
            first == 192 && second == 168 -> 0
            first == 10 -> 1
            first == 172 && second in 16..31 -> 2
            first == 100 && second in 64..127 -> 3
            first == 169 && second == 254 -> 4
            else -> 9
        }
    }

    fun isPreferred(address: Inet4Address): Boolean = addressRank(address) <= 2

    /** 按网卡名推断分类：VPN / 虚拟网卡关键词优先。 */
    fun classifyKind(name: String, virtual: Boolean): String {
        val lower = name.lowercase()
        if (virtual || listOf("vpn", "tap", "tun", "wg", "ppp", "ipsec", "tailscale", "zerotier", "wireguard")
                .any { lower.contains(it) }
        ) {
            return KIND_VPN
        }
        if (listOf("wlan", "wifi", "wi-fi", "wireless", "无线").any { lower.contains(it) }) return KIND_WIFI
        if (lower.startsWith("eth") || lower.startsWith("en") || lower.contains("ethernet") || lower.contains("有线")) {
            return KIND_ETHERNET
        }
        return KIND_OTHER
    }

    private fun kindTier(kind: String): Int = when (kind) {
        KIND_WIFI, KIND_ETHERNET -> 0
        KIND_VPN -> 2
        else -> 1
    }

    private fun ipv4Key(address: String): Long {
        val parts = address.split('.')
        if (parts.size != 4) return Long.MAX_VALUE
        var value = 0L
        for (part in parts) {
            val octet = part.toIntOrNull() ?: return Long.MAX_VALUE
            if (octet !in 0..255) return Long.MAX_VALUE
            value = value * 256 + octet
        }
        return value
    }

    /** 排序：局域网优先 → 有线/无线优先于其它、VPN 最后 → 网段优先级 → 地址数值。 */
    fun sort(networks: List<LanNetwork>): List<LanNetwork> = networks.sortedWith(
        compareByDescending<LanNetwork> { it.isLan }
            .thenBy { kindTier(it.kind) }
            .thenBy { it.preferred }
            .thenBy { ipv4Key(it.address) }
            .thenBy { it.address },
    )

    /** 枚举本机 IPv4 网卡：排除回环，VPN / 虚拟网卡标记后降级。 */
    fun list(): List<LanNetwork> {
        val result = mutableListOf<LanNetwork>()
        val seen = mutableSetOf<String>()
        val interfaces = try {
            NetworkInterface.getNetworkInterfaces()
        } catch (_: Throwable) {
            null
        } ?: return emptyList()
        for (network in Collections.list(interfaces)) {
            val rawName = runCatching { network.name }.getOrNull().orEmpty()
            val displayName = runCatching { network.displayName }.getOrNull()?.takeIf { it.isNotBlank() }
            val name = displayName ?: rawName.ifBlank { "网络" }
            val virtual = runCatching { network.isVirtual }.getOrDefault(false)
            val addresses = runCatching { network.inetAddresses }.getOrNull() ?: continue
            for (address in Collections.list(addresses)) {
                if (address !is Inet4Address || address.isLoopbackAddress) continue
                val host = address.hostAddress ?: continue
                if (!seen.add(host)) continue
                result.add(
                    LanNetwork(
                        name = name,
                        address = host,
                        isLan = LanDiscoveryCodec.isLanAddress(address),
                        kind = classifyKind(rawName.ifBlank { name }, virtual),
                        preferred = addressRank(address),
                    ),
                )
            }
        }
        return sort(result)
    }

    /** 默认选择：排序后的第一条局域网地址；没有时 null。 */
    fun preferredAddress(): Inet4Address? {
        for (network in list()) {
            if (!network.isLan) continue
            val address = runCatching { InetAddress.getByName(network.address) }.getOrNull()
            if (address is Inet4Address) return address
        }
        return null
    }

    /** 校验用户选中的地址确实在本机网卡上。 */
    fun findAddress(host: String): Inet4Address? {
        val target = runCatching { InetAddress.getByName(host.trim()) }.getOrNull()
        if (target !is Inet4Address || target.isLoopbackAddress) return null
        return list()
            .firstOrNull { it.address == target.hostAddress }
            ?.let { target }
    }

    /** 选中地址所属网段的广播地址（Android 的 NetworkInterface 直接给出）。 */
    fun broadcastAddress(host: String): Inet4Address? {
        val target = runCatching { InetAddress.getByName(host.trim()) }.getOrNull() as? Inet4Address ?: return null
        val interfaces = runCatching { NetworkInterface.getNetworkInterfaces() }.getOrNull() ?: return null
        for (network in Collections.list(interfaces)) {
            val addresses = runCatching { network.interfaceAddresses }.getOrNull() ?: continue
            for (item: InterfaceAddress in addresses) {
                if (item.address is Inet4Address && item.address.hostAddress == target.hostAddress) {
                    val broadcast = item.broadcast
                    if (broadcast is Inet4Address) return broadcast
                }
            }
        }
        return null
    }
}
