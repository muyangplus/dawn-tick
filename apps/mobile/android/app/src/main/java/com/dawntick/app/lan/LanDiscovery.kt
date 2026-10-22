package com.dawntick.app.lan

import android.os.Build
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress

/**
 * 局域网同步二期的 UDP 自动发现。
 *
 * 边界：
 * - 只在「开启配对」期间广播设备名、局域网地址与 HTTP 端口，不含配对码或令牌；
 * - 扫描短超时（默认 1.5 秒）收集广播，按 host:port 去重；
 * - 编解码 / 去重是纯 JVM 逻辑，网络收发只在 start / scan；
 * - 协议见 apps/mobile/docs/lan-sync.contract.md。
 */
const val LAN_DISCOVERY_KIND = "dawn-tick-lan-discover"
const val LAN_DISCOVERY_SCHEMA_VERSION = 1
const val LAN_DISCOVERY_PORT = 8766
private const val LAN_ANNOUNCE_INTERVAL_MS = 800L
private const val LAN_DISCOVERY_DEFAULT_TIMEOUT_MS = 1500
private const val LAN_DISCOVERY_MAX_TIMEOUT_MS = 5000
private const val LAN_DISCOVERY_MAX_PEERS = 32

data class LanDiscoveryPeer(val name: String, val host: String, val port: Int) {
    fun toJsObject(): com.getcapacitor.JSObject = com.getcapacitor.JSObject()
        .put("name", name)
        .put("host", host)
        .put("port", port)
}

/** 组包与解析：字段名与 Rust `lan_discovery` 逐字一致。 */
object LanDiscoveryCodec {
    fun encode(host: String, port: Int, name: String): String? {
        val cleanName = name.trim()
        if (cleanName.isEmpty() || cleanName.length > 48) return null
        val address = parseLanHost(host) ?: return null
        if (port !in 1..65535) return null
        return JSONObject()
            .put("kind", LAN_DISCOVERY_KIND)
            .put("schemaVersion", LAN_DISCOVERY_SCHEMA_VERSION)
            .put("name", cleanName)
            .put("host", address.hostAddress)
            .put("port", port)
            .toString()
    }

    fun parse(text: String): LanDiscoveryPeer? {
        return try {
            val json = JSONObject(text)
            if (json.optString("kind") != LAN_DISCOVERY_KIND) return null
            if (json.optInt("schemaVersion", -1) != LAN_DISCOVERY_SCHEMA_VERSION) return null
            val name = json.optString("name").trim()
            val host = json.optString("host").trim()
            val port = json.optInt("port", 0)
            if (name.isEmpty() || name.length > 48) return null
            val address = parseLanHost(host) ?: return null
            if (port !in 1..65535) return null
            LanDiscoveryPeer(name, address.hostAddress ?: host, port)
        } catch (_: Exception) {
            null
        }
    }

    fun merge(peers: List<LanDiscoveryPeer>): List<LanDiscoveryPeer> {
        val latest = LinkedHashMap<String, LanDiscoveryPeer>()
        for (peer in peers) latest["${peer.host}:${peer.port}"] = peer
        return latest.values
            .sortedWith(compareBy({ it.name }, { it.host }))
            .take(LAN_DISCOVERY_MAX_PEERS)
    }

    fun parseLanHost(host: String): Inet4Address? {
        val address = try {
            InetAddress.getByName(host.trim())
        } catch (_: Exception) {
            return null
        }
        if (address !is Inet4Address) return null
        return if (isLanAddress(address)) address else null
    }

    fun isLanAddress(address: InetAddress): Boolean {
        if (address.isLoopbackAddress || address.isSiteLocalAddress || address.isLinkLocalAddress) return true
        val octets = address.address
        return address is Inet4Address && octets.size == 4 &&
            (octets[0].toInt() and 0xFF) == 100 && (octets[1].toInt() and 0xFF) in 64..127
    }

    fun deviceName(): String {
        val name = Build.MODEL?.trim().orEmpty()
        return if (name.isEmpty()) "Android 设备" else name.take(48)
    }
}

/** 开配对期间每 800ms 广播一次；停止时关 socket 并让线程退出。 */
object LanDiscoveryAdvertiser {
    @Volatile private var running = false
    @Volatile private var socket: DatagramSocket? = null
    @Volatile private var thread: Thread? = null

    fun start(host: String, port: Int, name: String) {
        stop()
        val packet = LanDiscoveryCodec.encode(host, port, name) ?: return
        val bytes = packet.toByteArray(Charsets.UTF_8)
        running = true
        thread = Thread {
            val active = try {
                DatagramSocket().apply { broadcast = true }
            } catch (_: Exception) {
                running = false
                return@Thread
            }
            socket = active
            while (running) {
                for (target in listOf("255.255.255.255", "127.0.0.1")) {
                    runCatching {
                        active.send(
                            DatagramPacket(
                                bytes,
                                bytes.size,
                                InetAddress.getByName(target),
                                LAN_DISCOVERY_PORT,
                            ),
                        )
                    }
                }
                var slept = 0L
                while (running && slept < LAN_ANNOUNCE_INTERVAL_MS) {
                    Thread.sleep(100)
                    slept += 100
                }
            }
            runCatching { active.close() }
        }.apply {
            isDaemon = true
            this.name = "lan-discovery-announce"
            start()
        }
    }

    fun stop() {
        running = false
        runCatching { socket?.close() }
        socket = null
        thread?.let { runCatching { it.join(300) } }
        thread = null
    }
}

/** 扫描端：绑定发现端口，短超时收集广播，去重后返回。 */
object LanDiscovery {
    fun scan(timeoutMs: Int = LAN_DISCOVERY_DEFAULT_TIMEOUT_MS): List<LanDiscoveryPeer> {
        val timeout = timeoutMs.coerceIn(100, LAN_DISCOVERY_MAX_TIMEOUT_MS)
        val socket = try {
            DatagramSocket(null).apply {
                reuseAddress = true
                bind(InetSocketAddress(LAN_DISCOVERY_PORT))
                soTimeout = 200
            }
        } catch (_: Exception) {
            return emptyList()
        }
        val peers = mutableListOf<LanDiscoveryPeer>()
        try {
            val deadline = System.currentTimeMillis() + timeout
            while (System.currentTimeMillis() < deadline) {
                val buffer = ByteArray(1024)
                try {
                    val packet = DatagramPacket(buffer, buffer.size)
                    socket.receive(packet)
                    val text = String(packet.data, 0, packet.length, Charsets.UTF_8)
                    LanDiscoveryCodec.parse(text)?.let { peers.add(it) }
                } catch (_: java.net.SocketTimeoutException) {
                    // 继续等下一轮，直到总超时
                } catch (_: Exception) {
                    break
                }
            }
        } finally {
            runCatching { socket.close() }
        }
        return LanDiscoveryCodec.merge(peers)
    }
}
