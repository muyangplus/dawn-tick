//! 局域网多网络识别：枚举本机 IPv4 网卡、分类与首选排序。
//!
//! 边界：
//! - 只读本机网卡信息，不发包、不改系统设置；
//! - `kind` 只是按网卡名推断的展示分类（wifi / ethernet / vpn / other），不做承诺；
//! - 排序与网段判定都是纯函数，枚举只在 `list_interfaces` / `lan_network_list`；
//! - 地址判定复用 `lan_sync::is_lan_ipv4`，与监听侧保持同一口径。

use std::net::Ipv4Addr;
#[cfg(windows)]
use std::process::Command;

use serde::Serialize;

/// 网卡分类：无线 / 有线 / VPN / 其他。
pub const KIND_WIFI: &str = "wifi";
pub const KIND_ETHERNET: &str = "ethernet";
pub const KIND_VPN: &str = "vpn";
pub const KIND_OTHER: &str = "other";

/// 未识别到常见局域网网段时给的最低优先级。
const PREFERRED_NONE: u8 = 9;
/// 没有子网掩码时的保守假设：/24 是家用与校园 Wi-Fi 最常见的配置。
const DEFAULT_NETMASK: Ipv4Addr = Ipv4Addr::new(255, 255, 255, 0);

/// 返回给 TS 的一块网卡地址；字段名与 `apps/web/src/lan-sync-network.ts` 一致。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanNetwork {
    pub name: String,
    pub address: String,
    pub is_lan: bool,
    pub kind: String,
    /// 越小越优先：192.168.* = 0、10.* = 1、172.16–31.* = 2、100.64/10 = 3、
    /// 169.254/16 = 4、其余 = 9。TS 侧只做展示与排序，不参与协议。
    pub preferred: u8,
}

/// 枚举出来的一条网卡地址（含子网掩码，供广播地址计算）。
#[derive(Debug, Clone, PartialEq)]
pub struct InterfaceAddress {
    pub name: String,
    pub address: Ipv4Addr,
    pub netmask: Ipv4Addr,
}

/// 常见局域网网段的优先级：192.168 > 10 > 172.16–31 > 100.64 > 169.254 > 其它。
pub fn address_rank(address: Ipv4Addr) -> u8 {
    let [first, second, _, _] = address.octets();
    match (first, second) {
        (192, 168) => 0,
        (10, _) => 1,
        (172, 16..=31) => 2,
        (100, 64..=127) => 3,
        (169, 254) => 4,
        _ => PREFERRED_NONE,
    }
}

/// 是否常见局域网网段（192.168 / 10 / 172.16–31），UI 用来标「首选」。
#[cfg(test)]
pub fn is_preferred(address: Ipv4Addr) -> bool {
    address_rank(address) <= 2
}

/// 是否是可用于同步的本机局域网地址：排除回环，其余沿用监听侧口径。
pub fn is_lan_interface_address(address: Ipv4Addr) -> bool {
    !address.is_loopback() && crate::lan_sync::is_lan_ipv4(address)
}

/// 按网卡名推断分类：VPN 关键词优先，避免「vEthernet」「TAP」被当成有线。
pub fn classify_kind(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    const VPN: [&str; 16] = [
        "vpn",
        "tap",
        "tun",
        "wireguard",
        "tailscale",
        "zerotier",
        "openvpn",
        "ppp",
        "ipsec",
        "vethernet",
        "virtual",
        "vmware",
        "virtualbox",
        "hyper-v",
        "wsl",
        "docker",
    ];
    if VPN.iter().any(|keyword| lower.contains(keyword)) {
        return KIND_VPN;
    }
    const WIFI: [&str; 6] = ["wifi", "wi-fi", "wlan", "wireless", "无线", "802.11"];
    if WIFI.iter().any(|keyword| lower.contains(keyword)) {
        return KIND_WIFI;
    }
    const ETHERNET: [&str; 6] = ["ethernet", "以太网", "eth", "lan", "en0", "en1"];
    if ETHERNET.iter().any(|keyword| lower.contains(keyword)) {
        return KIND_ETHERNET;
    }
    KIND_OTHER
}

/// 展示分类的排序档位：有线/无线在前，其它其次，VPN 最后（降级而不是排除）。
fn kind_tier(kind: &str) -> u8 {
    match kind {
        KIND_WIFI | KIND_ETHERNET => 0,
        KIND_VPN => 2,
        _ => 1,
    }
}

/// 一块网卡地址转成对外的 `LanNetwork`。
pub fn to_lan_network(interface: &InterfaceAddress) -> LanNetwork {
    LanNetwork {
        name: interface.name.clone(),
        address: interface.address.to_string(),
        is_lan: is_lan_interface_address(interface.address),
        kind: classify_kind(&interface.name).to_string(),
        preferred: address_rank(interface.address),
    }
}

/// 排序：局域网优先 → 分类（VPN 最后）→ 网段优先级 → 地址数值。
pub fn sort_networks(networks: &mut [LanNetwork]) {
    networks.sort_by(|left, right| {
        right
            .is_lan
            .cmp(&left.is_lan)
            .then_with(|| kind_tier(&left.kind).cmp(&kind_tier(&right.kind)))
            .then_with(|| left.preferred.cmp(&right.preferred))
            .then_with(|| {
                let left_ip = left.address.parse::<Ipv4Addr>().unwrap_or(Ipv4Addr::UNSPECIFIED);
                let right_ip = right.address.parse::<Ipv4Addr>().unwrap_or(Ipv4Addr::UNSPECIFIED);
                left_ip.cmp(&right_ip)
            })
    });
}

/// 网卡地址列表转成排序后的候选；同一地址只留一条。
pub fn networks_from_interfaces(interfaces: &[InterfaceAddress]) -> Vec<LanNetwork> {
    let mut seen = std::collections::BTreeSet::new();
    let mut networks: Vec<LanNetwork> = interfaces
        .iter()
        .filter(|interface| !interface.address.is_loopback())
        .filter(|interface| seen.insert(interface.address))
        .map(to_lan_network)
        .collect();
    sort_networks(&mut networks);
    networks
}

/// 默认选择：排序后的第一条局域网地址。
pub fn default_network(networks: &[LanNetwork]) -> Option<&LanNetwork> {
    networks.iter().find(|network| network.is_lan)
}

/// 地址所属网段的广播地址；子网掩码不合法时返回 None。
pub fn broadcast_address(address: Ipv4Addr, netmask: Ipv4Addr) -> Option<Ipv4Addr> {
    let mask = u32::from(netmask);
    if mask == 0 || mask == u32::MAX {
        return None;
    }
    // 掩码必须是连续的 1：取反加一后应为 2 的幂。
    let inverted = !mask;
    if inverted & inverted.wrapping_add(1) != 0 {
        return None;
    }
    Some(Ipv4Addr::from(u32::from(address) | inverted))
}

/// 两个 IPv4 是否在同一子网（用同一个掩码判断）。
pub fn same_subnet(left: Ipv4Addr, right: Ipv4Addr, netmask: Ipv4Addr) -> bool {
    u32::from(left) & u32::from(netmask) == u32::from(right) & u32::from(netmask)
}

/// 解析 `ipconfig` 输出：取每块网卡的 IPv4 地址与子网掩码。
///
/// 不依赖窗口标题语言：适配器标题是行首、以 `:` 结尾的行；地址与掩码按行内
/// 「IPv4」「Mask / 掩码」关键词识别（中英文 Windows 都覆盖）。
pub fn parse_ipconfig(text: &str) -> Vec<InterfaceAddress> {
    let mut result: Vec<InterfaceAddress> = Vec::new();
    let mut current: Option<(String, Option<Ipv4Addr>, Option<Ipv4Addr>)> = None;
    for raw_line in text.lines() {
        let line = raw_line.trim_end_matches('\r');
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let indented = line.starts_with(' ') || line.starts_with('\t');
        let is_header = !indented
            && (line.ends_with(':') || line.ends_with('：'))
            && !line.contains("http");
        if is_header {
            if let Some((name, address, netmask)) = current.take() {
                if let Some(address) = address {
                    result.push(InterfaceAddress {
                        name,
                        address,
                        netmask: netmask.unwrap_or(DEFAULT_NETMASK),
                    });
                }
            }
            let name = trimmed
                .trim_end_matches(':')
                .trim_end_matches('：')
                .trim()
                .to_string();
            current = Some((name, None, None));
            continue;
        }
        let Some((_, address, netmask)) = current.as_mut() else {
            continue;
        };
        let Some((label, value)) = split_labeled(trimmed) else {
            continue;
        };
        let Ok(ip) = value.parse::<Ipv4Addr>() else {
            continue;
        };
        let lower = label.to_lowercase();
        // 中文 Windows 的 ipconfig 是 GBK，`from_utf8_lossy` 后中文标签会变成替换字符，
        // 因此掩码按「值是否是连续 1 的掩码」判断，地址取第一条非掩码 IPv4（Windows 顺序固定）。
        if looks_like_netmask(ip) {
            if netmask.is_none() {
                *netmask = Some(ip);
            }
            continue;
        }
        let readable_address_label =
            lower.contains("ipv4") || lower.contains("address") || label.contains("地址");
        if address.is_none() && (readable_address_label || netmask.is_none()) {
            *address = Some(ip);
        }
    }
    if let Some((name, address, netmask)) = current.take() {
        if let Some(address) = address {
            result.push(InterfaceAddress {
                name,
                address,
                netmask: netmask.unwrap_or(DEFAULT_NETMASK),
            });
        }
    }
    result
}

/// 是否是连续 1 的子网掩码（用于在中英文 / GBK 输出里识别掩码行）。
pub fn looks_like_netmask(ip: Ipv4Addr) -> bool {
    let mask = u32::from(ip);
    if mask == 0 || mask == u32::MAX {
        return false;
    }
    let inverted = !mask;
    inverted & inverted.wrapping_add(1) == 0
}

/// 拆一行「标签 . . . : 值」；只认 ASCII 冒号作为值分隔符。
fn split_labeled(line: &str) -> Option<(&str, &str)> {
    let (label, value) = line.rsplit_once(':')?;
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    Some((label.trim(), value))
}

/// 枚举本机网卡 IPv4；Windows 用系统自带的 `ipconfig`，其它平台返回空。
pub fn list_interfaces() -> Vec<InterfaceAddress> {
    #[cfg(windows)]
    {
        let Ok(output) = Command::new("ipconfig").output() else {
            return Vec::new();
        };
        if !output.status.success() {
            return Vec::new();
        }
        // Windows 中文版输出是 GBK，不是 UTF-8；地址与标签都是 ASCII，逐字节透传即可。
        let text = String::from_utf8_lossy(&output.stdout);
        parse_ipconfig(&text)
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// 本机候选列表（已排序）。
pub fn list_networks() -> Vec<LanNetwork> {
    let mut networks = networks_from_interfaces(&list_interfaces());
    if networks.is_empty() {
        // 枚举失败时退回路由探测的单地址，至少让 UI 有一项可选。
        if let Some(address) = crate::lan_sync::probe_lan_ipv4() {
            networks.push(to_lan_network(&InterfaceAddress {
                name: "本机网络".to_string(),
                address,
                netmask: DEFAULT_NETMASK,
            }));
        }
    }
    networks
}

/// 找指定地址对应的子网掩码。
pub fn netmask_for(address: Ipv4Addr) -> Option<Ipv4Addr> {
    list_interfaces()
        .into_iter()
        .find(|interface| interface.address == address)
        .map(|interface| interface.netmask)
}

/// Tauri 命令：列出本机 IPv4 网卡与首选排序。
#[tauri::command]
pub fn lan_network_list() -> Vec<LanNetwork> {
    list_networks()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn network(name: &str, address: &str, kind: &str, preferred: u8) -> LanNetwork {
        LanNetwork {
            name: name.to_string(),
            address: address.to_string(),
            is_lan: true,
            kind: kind.to_string(),
            preferred,
        }
    }

    #[test]
    fn preferred_ranges_order_common_lan_first() {
        assert_eq!(address_rank(Ipv4Addr::new(192, 168, 1, 23)), 0);
        assert_eq!(address_rank(Ipv4Addr::new(10, 2, 3, 4)), 1);
        assert_eq!(address_rank(Ipv4Addr::new(172, 16, 0, 1)), 2);
        assert_eq!(address_rank(Ipv4Addr::new(172, 31, 255, 254)), 2);
        assert_eq!(address_rank(Ipv4Addr::new(172, 32, 0, 1)), 9);
        assert_eq!(address_rank(Ipv4Addr::new(100, 100, 1, 1)), 3);
        assert_eq!(address_rank(Ipv4Addr::new(169, 254, 1, 1)), 4);
        assert_eq!(address_rank(Ipv4Addr::new(8, 8, 8, 8)), 9);
        assert!(is_preferred(Ipv4Addr::new(192, 168, 1, 1)));
        assert!(is_preferred(Ipv4Addr::new(10, 0, 0, 1)));
        assert!(is_preferred(Ipv4Addr::new(172, 20, 0, 1)));
        assert!(!is_preferred(Ipv4Addr::new(100, 64, 0, 1)));
    }

    #[test]
    fn classify_common_adapter_names() {
        assert_eq!(classify_kind("无线局域网适配器 WLAN"), KIND_WIFI);
        assert_eq!(classify_kind("Wi-Fi"), KIND_WIFI);
        assert_eq!(classify_kind("以太网适配器 以太网"), KIND_ETHERNET);
        assert_eq!(classify_kind("Ethernet 2"), KIND_ETHERNET);
        assert_eq!(classify_kind("vEthernet (WSL)"), KIND_VPN);
        assert_eq!(classify_kind("TAP-Windows Adapter V9"), KIND_VPN);
        assert_eq!(classify_kind("Tailscale"), KIND_VPN);
        assert_eq!(classify_kind("WireGuard Tunnel"), KIND_VPN);
        assert_eq!(classify_kind("蓝牙网络连接"), KIND_OTHER);
    }

    #[test]
    fn sort_prefers_lan_then_rank_then_non_vpn() {
        let mut networks = vec![
            network("VMnet8", "192.168.56.1", KIND_VPN, 0),
            network("WLAN", "10.0.0.8", KIND_WIFI, 1),
            network("以太网", "172.20.1.2", KIND_ETHERNET, 2),
            network("Ethernet", "192.168.1.23", KIND_ETHERNET, 0),
            LanNetwork {
                name: "公网".into(),
                address: "203.0.113.9".into(),
                is_lan: false,
                kind: KIND_OTHER.into(),
                preferred: 9,
            },
        ];
        sort_networks(&mut networks);
        let order: Vec<&str> = networks.iter().map(|item| item.address.as_str()).collect();
        assert_eq!(
            order,
            vec!["192.168.1.23", "10.0.0.8", "172.20.1.2", "192.168.56.1", "203.0.113.9"]
        );
        assert_eq!(default_network(&networks).map(|item| item.address.as_str()), Some("192.168.1.23"));
    }

    #[test]
    fn networks_from_interfaces_skips_loopback_and_duplicates() {
        let interfaces = vec![
            InterfaceAddress {
                name: "Loopback".into(),
                address: Ipv4Addr::LOCALHOST,
                netmask: Ipv4Addr::new(255, 0, 0, 0),
            },
            InterfaceAddress {
                name: "WLAN".into(),
                address: Ipv4Addr::new(192, 168, 1, 23),
                netmask: DEFAULT_NETMASK,
            },
            InterfaceAddress {
                name: "WLAN 副本".into(),
                address: Ipv4Addr::new(192, 168, 1, 23),
                netmask: DEFAULT_NETMASK,
            },
            InterfaceAddress {
                name: "公网".into(),
                address: Ipv4Addr::new(203, 0, 113, 9),
                netmask: DEFAULT_NETMASK,
            },
        ];
        let networks = networks_from_interfaces(&interfaces);
        assert_eq!(networks.len(), 2);
        assert_eq!(networks[0].address, "192.168.1.23");
        assert!(networks[0].is_lan);
        assert_eq!(networks[0].kind, KIND_WIFI);
        assert_eq!(networks[1].address, "203.0.113.9");
        assert!(!networks[1].is_lan);
        assert!(default_network(&networks).is_some());
    }

    #[test]
    fn broadcast_address_requires_contiguous_mask() {
        let ip = Ipv4Addr::new(192, 168, 1, 23);
        assert_eq!(
            broadcast_address(ip, Ipv4Addr::new(255, 255, 255, 0)),
            Some(Ipv4Addr::new(192, 168, 1, 255))
        );
        assert_eq!(
            broadcast_address(ip, Ipv4Addr::new(255, 255, 0, 0)),
            Some(Ipv4Addr::new(192, 168, 255, 255))
        );
        assert_eq!(broadcast_address(ip, Ipv4Addr::UNSPECIFIED), None);
        assert_eq!(broadcast_address(ip, Ipv4Addr::new(255, 255, 255, 255)), None);
        assert_eq!(broadcast_address(ip, Ipv4Addr::new(255, 0, 255, 0)), None);
        assert!(same_subnet(
            ip,
            Ipv4Addr::new(192, 168, 1, 5),
            Ipv4Addr::new(255, 255, 255, 0)
        ));
        assert!(!same_subnet(
            ip,
            Ipv4Addr::new(192, 168, 2, 5),
            Ipv4Addr::new(255, 255, 255, 0)
        ));
    }

    #[test]
    fn parses_windows_ipconfig_zh_and_en() {
        let zh = "Windows IP 配置\r\n\r\n\r\n无线局域网适配器 WLAN:\r\n\r\n   连接特定的 DNS 后缀 . . . . . . . : \r\n   IPv4 地址 . . . . . . . . . . . . : 192.168.1.23\r\n   子网掩码  . . . . . . . . . . . . : 255.255.255.0\r\n   默认网关. . . . . . . . . . . . . : 192.168.1.1\r\n\r\n以太网适配器 以太网:\r\n\r\n   IPv4 地址 . . . . . . . . . . . . : 10.0.0.8\r\n   子网掩码  . . . . . . . . . . . . : 255.0.0.0\r\n";
        let parsed = parse_ipconfig(zh);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "无线局域网适配器 WLAN");
        assert_eq!(parsed[0].address, Ipv4Addr::new(192, 168, 1, 23));
        assert_eq!(parsed[0].netmask, Ipv4Addr::new(255, 255, 255, 0));
        assert_eq!(parsed[1].address, Ipv4Addr::new(10, 0, 0, 8));
        assert_eq!(parsed[1].netmask, Ipv4Addr::new(255, 0, 0, 0));

        let en = "Windows IP Configuration\r\n\r\nWireless LAN adapter Wi-Fi:\r\n\r\n   Connection-specific DNS Suffix  . :\r\n   IPv4 Address. . . . . . . . . . . : 172.20.1.2\r\n   Subnet Mask . . . . . . . . . . . : 255.255.0.0\r\n   Default Gateway . . . . . . . . . : 172.20.0.1\r\n";
        let parsed = parse_ipconfig(en);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "Wireless LAN adapter Wi-Fi");
        assert_eq!(parsed[0].address, Ipv4Addr::new(172, 20, 1, 2));
        assert_eq!(parsed[0].netmask, Ipv4Addr::new(255, 255, 0, 0));
    }

    #[test]
    fn skips_adapters_without_ipv4() {
        let text = "以太网适配器 以太网:\r\n\r\n  媒体状态 . . . . . . . . . . . . : 媒体已断开\r\n\r\n无线局域网适配器 WLAN:\r\n\r\n   IPv4 地址 . . . . . . . . . . . . : 192.168.0.7\r\n   子网掩码  . . . . . . . . . . . . : 255.255.255.0\r\n";
        let parsed = parse_ipconfig(text);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].address, Ipv4Addr::new(192, 168, 0, 7));
    }

    #[test]
    fn parses_gbk_mangled_labels_by_value() {
        // 中文 Windows 的 ipconfig 输出是 GBK，from_utf8_lossy 会把「地址 / 掩码」变成替换字符；
        // ASCII 的 IPv4 与掩码值仍在，解析必须仍然成立。
        let text = "无线局域网适配器 WLAN:\r\n\r\n   IPv4 \u{FFFD}\u{FFFD} . . . . . . . . : 192.168.1.23\r\n   \u{FFFD}\u{FFFD}\u{FFFD} . . . . . . . : 255.255.0.0\r\n   \u{FFFD}\u{FFFD}\u{FFFD}\u{FFFD} . . . . . : 192.168.0.1\r\n";
        let parsed = parse_ipconfig(text);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].address, Ipv4Addr::new(192, 168, 1, 23));
        assert_eq!(parsed[0].netmask, Ipv4Addr::new(255, 255, 0, 0));
        assert!(looks_like_netmask(Ipv4Addr::new(255, 255, 255, 0)));
        assert!(looks_like_netmask(Ipv4Addr::new(255, 255, 0, 0)));
        assert!(!looks_like_netmask(Ipv4Addr::new(192, 168, 1, 1)));
        assert!(!looks_like_netmask(Ipv4Addr::new(255, 255, 255, 255)));
        assert!(!looks_like_netmask(Ipv4Addr::UNSPECIFIED));
    }

    #[test]
    fn list_networks_returns_only_non_loopback_ipv4() {
        // 真机枚举：只断言不 panic、地址合法、无回环。
        for network in list_networks() {
            let address: Ipv4Addr = network.address.parse().expect("地址应是 IPv4");
            assert!(!address.is_loopback());
            assert!(network.preferred <= 9);
            assert!(matches!(network.kind.as_str(), KIND_WIFI | KIND_ETHERNET | KIND_VPN | KIND_OTHER));
        }
    }
}
