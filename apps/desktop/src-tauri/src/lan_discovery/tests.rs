//! `lan_discovery` 的编解码 / 去重 / 网络用例；拆成子模块避免主文件超过 400 行。

use super::*;

/// 两个网络用例会占用固定的发现端口，串行执行避免互相抢绑定。
static NETWORK_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn announce_roundtrip_and_validation() {
    let packet =
        announce_packet("192.168.1.5", 8765, "书房电脑", Some("device-1234")).expect("应能组包");
    let parsed = parse_announce(&packet).expect("应能解析");
    assert_eq!(parsed.name, "书房电脑");
    assert_eq!(parsed.host, "192.168.1.5");
    assert_eq!(parsed.port, 8765);
    assert_eq!(parsed.device_id.as_deref(), Some("device-1234"));
    assert_eq!(parsed.schema_version, SCHEMA_VERSION);
    assert!(parse_announce("not json").is_none());
    assert!(parse_announce(&packet.replace(KIND, "other")).is_none());
    assert!(parse_announce(&packet.replace("\"schemaVersion\":1", "\"schemaVersion\":2")).is_none());
    assert!(announce_packet("8.8.8.8", 8765, "电脑", None).is_err());
    assert!(announce_packet("192.168.1.5", 0, "电脑", None).is_err());
    assert!(announce_packet("192.168.1.5", 8765, "  ", None).is_err());

    // 旧包没有 deviceId：仍能解析，字段为 None
    let legacy = announce_packet("192.168.1.5", 8765, "旧设备", None).expect("应能组包");
    assert!(!legacy.contains("deviceId"));
    assert_eq!(parse_announce(&legacy).expect("应能解析").device_id, None);
    // 非法 / 空 / 超长 deviceId 只丢弃字段，保留整包
    let invalid = legacy.replace("\"port\":8765", "\"port\":8765,\"deviceId\":\"非法 id！\"");
    assert_eq!(parse_announce(&invalid).expect("应能解析").device_id, None);
    let empty_id = announce_packet("192.168.1.5", 8765, "电脑", Some("  ")).expect("应能组包");
    assert!(!empty_id.contains("deviceId"));
    let too_long =
        announce_packet("192.168.1.5", 8765, "电脑", Some(&"a".repeat(65))).expect("应能组包");
    assert!(!too_long.contains("deviceId"));
}

#[test]
fn merge_peers_dedupes_sorts_and_limits() {
    let peers = vec![
        LanDiscoveryPeer {
            name: "旧名字".into(),
            host: "192.168.1.5".into(),
            port: 8765,
            device_id: None,
        },
        LanDiscoveryPeer {
            name: "新名字".into(),
            host: "192.168.1.5".into(),
            port: 8765,
            device_id: Some("device-a".into()),
        },
        LanDiscoveryPeer {
            name: "手机".into(),
            host: "192.168.1.8".into(),
            port: 8765,
            device_id: Some("device-b".into()),
        },
    ];
    let merged = merge_peers(peers);
    assert_eq!(merged.len(), 2);
    assert_eq!(merged[0].name, "手机");
    assert_eq!(merged[1].name, "新名字");
    assert_eq!(merged[1].device_id.as_deref(), Some("device-a"));
    let many = (0..40).map(|index| LanDiscoveryPeer {
        name: format!("设备{index:02}"),
        host: format!("192.168.1.{}", index + 1),
        port: 8765,
        device_id: Some(format!("device-{index:02}")),
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
    start_local("127.0.0.1", 43210, "测试设备", Some("device-test"), None)
        .expect("应能开始广播");
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut peers = Vec::new();
    while Instant::now() < deadline && peers.is_empty() {
        peers = scan(1200);
    }
    stop_local();
    assert!(peers.iter().any(|peer| {
        peer.name == "测试设备" && peer.host == "127.0.0.1" && peer.port == 43210
    }));
    assert!(peers
        .iter()
        .any(|peer| peer.device_id.as_deref() == Some("device-test")));
    assert_eq!(broadcast_target("127.0.0.1").port(), DISCOVERY_PORT);
    assert_eq!(broadcast_target("192.168.1.255").ip().to_string(), "192.168.1.255");
}

#[test]
fn peer_allowed_filters_by_subnet_but_keeps_loopback() {
    let subnet = Some((Ipv4Addr::new(192, 168, 1, 23), Ipv4Addr::new(255, 255, 255, 0)));
    assert!(peer_allowed(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 8)), subnet));
    assert!(peer_allowed(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), subnet));
    assert!(!peer_allowed(IpAddr::V4(Ipv4Addr::new(192, 168, 2, 8)), subnet));
    assert!(peer_allowed(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 8)), None));
    assert!(!peer_allowed(IpAddr::V6(std::net::Ipv6Addr::LOCALHOST), subnet));
    // 掩码缺失时不过滤
    assert!(peer_allowed(
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, 8)),
        Some((Ipv4Addr::new(10, 0, 0, 8), Ipv4Addr::new(255, 0, 0, 0)))
    ));
}
