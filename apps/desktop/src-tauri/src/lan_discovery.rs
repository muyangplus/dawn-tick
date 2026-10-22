//! 局域网同步二期：UDP 广播自动发现。
//!
//! 边界：
//! - 只在「开启配对」期间广播本机设备名、局域网地址与 HTTP 端口；
//!   配对码、令牌与业务数据绝不进广播包；
//! - 扫描端短超时（默认 1.5 秒）收集广播，按 host:port 去重后返回；
//! - 编解码 / 去重是纯函数，网络收发只在 `start_local` / `scan`；
//! - 协议见 `apps/mobile/docs/lan-sync.contract.md`。

use std::net::{Ipv4Addr, UdpSocket};
#[cfg(test)]
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// 发现包标识；防止把别的 UDP 包当设备。
pub const KIND: &str = "dawn-tick-lan-discover";
/// 发现包版本；与同步信封 schemaVersion 同步升版。
pub const SCHEMA_VERSION: u32 = 1;
/// 广播与扫描共用端口。
pub const DISCOVERY_PORT: u16 = 8766;
/// 广播间隔：扫描窗口 1.5 秒内至少能收到一轮。
const ANNOUNCE_INTERVAL: Duration = Duration::from_millis(800);
/// 扫描默认 / 上限，避免调用方传一个长时间占住端口。
const DEFAULT_SCAN_MS: u64 = 1500;
const MAX_SCAN_MS: u64 = 5000;
/// 单次扫描最多返回的设备数。
const MAX_PEERS: usize = 32;

/// UDP 广播包正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanDiscoveryAnnounce {
    pub kind: String,
    pub schema_version: u32,
    pub name: String,
    pub host: String,
    pub port: u16,
}

/// 返回给 TS 的设备条目；不含配对码。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanDiscoveryPeer {
    pub name: String,
    pub host: String,
    pub port: u16,
}

fn valid_name(name: &str) -> bool {
    let length = name.trim().chars().count();
    (1..=48).contains(&length)
}

/// 组包并校验：设备名 1–48 字符、只广播局域网 IPv4、端口非 0。
pub fn announce_packet(host: &str, port: u16, name: &str) -> Result<String, String> {
    let name = name.trim();
    if !valid_name(name) {
        return Err("设备名应为 1–48 个字符".to_string());
    }
    let ip: Ipv4Addr = host
        .trim()
        .parse()
        .map_err(|_| "广播地址不是合法 IPv4".to_string())?;
    if !crate::lan_sync::is_lan_ipv4(ip) {
        return Err("广播地址必须是局域网地址".to_string());
    }
    if port == 0 {
        return Err("广播端口不合法".to_string());
    }
    Ok(serde_json::json!({
        "kind": KIND,
        "schemaVersion": SCHEMA_VERSION,
        "name": name,
        "host": ip.to_string(),
        "port": port,
    })
    .to_string())
}

/// 解析广播包：标识、版本、设备名、局域网地址与端口逐项校验；不合法返回 None。
pub fn parse_announce(text: &str) -> Option<LanDiscoveryAnnounce> {
    let packet: LanDiscoveryAnnounce = serde_json::from_str(text).ok()?;
    if packet.kind != KIND || packet.schema_version != SCHEMA_VERSION {
        return None;
    }
    if !valid_name(&packet.name) {
        return None;
    }
    let ip: Ipv4Addr = packet.host.parse().ok()?;
    if !crate::lan_sync::is_lan_ipv4(ip) || packet.port == 0 {
        return None;
    }
    Some(LanDiscoveryAnnounce {
        kind: KIND.to_string(),
        schema_version: SCHEMA_VERSION,
        name: packet.name.trim().to_string(),
        host: ip.to_string(),
        port: packet.port,
    })
}

/// 同一 host:port 只留一条；按设备名、地址排序并截断。
pub fn merge_peers(peers: impl IntoIterator<Item = LanDiscoveryPeer>) -> Vec<LanDiscoveryPeer> {
    let mut latest: Vec<LanDiscoveryPeer> = Vec::new();
    for peer in peers {
        match latest
            .iter_mut()
            .find(|item| item.host == peer.host && item.port == peer.port)
        {
            Some(existing) => *existing = peer,
            None => latest.push(peer),
        }
    }
    latest.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.host.cmp(&right.host))
    });
    latest.truncate(MAX_PEERS);
    latest
}

/// 广播线程句柄：停止时置位并等线程退出（最多一个 100ms 睡眠片）。
struct Advertiser {
    running: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl Advertiser {
    fn stop(mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

static DISCOVERY: Mutex<Option<Advertiser>> = Mutex::new(None);

fn lock_discovery() -> std::sync::MutexGuard<'static, Option<Advertiser>> {
    DISCOVERY.lock().unwrap_or_else(|error| error.into_inner())
}

/// 本机设备名：Windows 计算机名，取不到时退回固定文案。
pub fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| valid_name(name))
        .unwrap_or_else(|| "Windows 设备".to_string())
}

/// 开始广播（幂等：已有广播线程先停掉再起）。
pub fn start_local(host: &str, port: u16, name: &str) -> Result<(), String> {
    let packet = announce_packet(host, port, name)?;
    stop_local();
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|error| format!("创建发现广播 socket 失败：{error}"))?;
    socket
        .set_broadcast(true)
        .map_err(|error| format!("开启 UDP 广播失败：{error}"))?;
    let running = Arc::new(AtomicBool::new(true));
    let thread_running = running.clone();
    let handle = std::thread::spawn(move || {
        while thread_running.load(Ordering::SeqCst) {
            let _ = socket.send_to(packet.as_bytes(), ("255.255.255.255", DISCOVERY_PORT));
            // 同机自测也走这条；正常局域网里两个目标不会重复命中
            let _ = socket.send_to(packet.as_bytes(), ("127.0.0.1", DISCOVERY_PORT));
            for _ in 0..(ANNOUNCE_INTERVAL.as_millis() / 100) {
                if !thread_running.load(Ordering::SeqCst) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    });
    *lock_discovery() = Some(Advertiser {
        running,
        handle: Some(handle),
    });
    Ok(())
}

/// 停止广播；没开时什么也不做。
pub fn stop_local() {
    if let Some(advertiser) = lock_discovery().take() {
        advertiser.stop();
    }
}

fn peer_from_packet(packet: LanDiscoveryAnnounce) -> LanDiscoveryPeer {
    LanDiscoveryPeer {
        name: packet.name,
        host: packet.host,
        port: packet.port,
    }
}

/// 扫描一段时间，收集广播并按 host:port 去重；端口被占用或没有广播时返回空列表。
pub fn scan(timeout_ms: u64) -> Vec<LanDiscoveryPeer> {
    let timeout = timeout_ms.clamp(100, MAX_SCAN_MS);
    let Ok(socket) = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) else {
        return Vec::new();
    };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(200)));
    let deadline = Instant::now() + Duration::from_millis(timeout);
    let mut peers = Vec::new();
    while Instant::now() < deadline {
        let mut buffer = [0u8; 1024];
        match socket.recv_from(&mut buffer) {
            Ok((length, _source)) => {
                if let Ok(text) = std::str::from_utf8(&buffer[..length]) {
                    if let Some(packet) = parse_announce(text) {
                        peers.push(peer_from_packet(packet));
                    }
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => break,
        }
    }
    merge_peers(peers)
}

/// Tauri 命令：扫描局域网设备；超时缺省 1.5 秒、最多 5 秒。
#[tauri::command]
pub fn lan_discovery_scan(timeout_ms: Option<u64>) -> Vec<LanDiscoveryPeer> {
    scan(timeout_ms.unwrap_or(DEFAULT_SCAN_MS))
}

/// 调试用：把广播目标地址暴露给测试，避免测试里再拼一份常量。
#[cfg(test)]
fn broadcast_target(ip: &str) -> SocketAddr {
    format!("{ip}:{DISCOVERY_PORT}").parse().expect("目标地址应合法")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 两个网络用例会占用固定的发现端口，串行执行避免互相抢绑定。
    static NETWORK_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn announce_roundtrip_and_validation() {
        let packet = announce_packet("192.168.1.5", 8765, "书房电脑").expect("应能组包");
        let parsed = parse_announce(&packet).expect("应能解析");
        assert_eq!(parsed.name, "书房电脑");
        assert_eq!(parsed.host, "192.168.1.5");
        assert_eq!(parsed.port, 8765);
        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
        assert!(parse_announce("not json").is_none());
        assert!(parse_announce(&packet.replace(KIND, "other")).is_none());
        assert!(parse_announce(&packet.replace("\"schemaVersion\":1", "\"schemaVersion\":2")).is_none());
        assert!(announce_packet("8.8.8.8", 8765, "电脑").is_err());
        assert!(announce_packet("192.168.1.5", 0, "电脑").is_err());
        assert!(announce_packet("192.168.1.5", 8765, "  ").is_err());
    }

    #[test]
    fn merge_peers_dedupes_sorts_and_limits() {
        let peers = vec![
            LanDiscoveryPeer {
                name: "旧名字".into(),
                host: "192.168.1.5".into(),
                port: 8765,
            },
            LanDiscoveryPeer {
                name: "新名字".into(),
                host: "192.168.1.5".into(),
                port: 8765,
            },
            LanDiscoveryPeer {
                name: "手机".into(),
                host: "192.168.1.8".into(),
                port: 8765,
            },
        ];
        let merged = merge_peers(peers);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].name, "手机");
        assert_eq!(merged[1].name, "新名字");
        assert_eq!(merged[0].name, "手机");
        let many = (0..40).map(|index| LanDiscoveryPeer {
            name: format!("设备{index:02}"),
            host: format!("192.168.1.{}", index + 1),
            port: 8765,
        });
        assert_eq!(merge_peers(many).len(), MAX_PEERS);
    }

    #[test]
    fn scan_is_short_and_empty_without_announcer() {
        let _guard = NETWORK_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        stop_local();
        let started = Instant::now();
        let peers = scan(100);
        assert!(peers.is_empty());
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn scan_receives_local_announcement() {
        let _guard = NETWORK_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        start_local("127.0.0.1", 43210, "测试设备").expect("应能开始广播");
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut peers = Vec::new();
        while Instant::now() < deadline && peers.is_empty() {
            peers = scan(1200);
        }
        stop_local();
        assert!(peers.iter().any(|peer| peer.name == "测试设备" && peer.host == "127.0.0.1" && peer.port == 43210));
        assert_eq!(broadcast_target("127.0.0.1").port(), DISCOVERY_PORT);
    }
}
