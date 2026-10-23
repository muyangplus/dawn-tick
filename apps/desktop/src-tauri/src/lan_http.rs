//! 局域网同步的桌面 HTTP 直连：不经系统代理，只发往局域网地址。
//!
//! 背景：Windows 开着系统代理时，`plugin-http` 会把 `192.168.x.x` 也交给代理，
//! 局域网请求直接失败。这里用 `std::net::TcpStream` 手写最小的 HTTP/1.1 客户端，
//! 完全绕开系统代理；协议侧仍与 `lan_sync`（服务端）一致。
//!
//! 边界：
//! - 只接受 `http://` + 局域网 IPv4（域名、https、公网一律拒绝）；
//! - 支持 `Content-Length` 与 `chunked` 两种响应体；上限 20MB；
//! - 不跟随重定向、不带 cookie、不发 `Accept-Encoding`（服务端只回明文 JSON）；
//! - URL / 请求头 / 响应解析都是纯函数，单测不依赖真实网络。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

use serde::Serialize;

use crate::lan_sync::is_lan_ipv4;

/// 响应体上限：与 `lan_sync::MAX_RESPONSE_BYTES` 一致。
pub const MAX_RESPONSE_BYTES: usize = 20 * 1024 * 1024;
/// 默认超时：服务端最多等 TS 10 秒处理，客户端留出余量。
pub const DEFAULT_TIMEOUT_MS: u64 = 15_000;
/// 超时上限，避免调用方传一个长时间占住线程的值。
pub const MAX_TIMEOUT_MS: u64 = 30_000;
/// 响应头上限。
const HEAD_LIMIT: usize = 64 * 1024;
/// 请求头总量上限（不含请求行与正文）。
const MAX_REQUEST_HEADER_BYTES: usize = 8 * 1024;
/// 请求头数量上限。
const MAX_HEADERS: usize = 32;
/// 读响应时允许的额外字节（chunked 的长度行、CRLF 与 trailer）。
const RESPONSE_OVERHEAD: usize = 1024 * 1024;

/// 解析后的目标：只可能是局域网 IPv4 + http。
#[derive(Debug, Clone, PartialEq)]
pub struct LanTarget {
    pub host: Ipv4Addr,
    pub port: u16,
    pub path_and_query: String,
}

/// 返回给 TS 的响应；字段与 `apps/web/src/lan-sync-http.ts` 一致。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LanHttpResponse {
    pub status: u16,
    pub body: String,
}

/// 解析 `http://host[:port][/path?query]`：只收局域网 IPv4，缺省端口 80。
pub fn parse_target(raw: &str) -> Result<LanTarget, String> {
    let text = raw.trim();
    let rest = text
        .strip_prefix("http://")
        .ok_or_else(|| "局域网直连只支持 http:// 地址".to_string())?;
    if rest.is_empty() {
        return Err("目标地址为空".to_string());
    }
    if rest.contains('#') {
        return Err("目标地址不能带片段".to_string());
    }
    let (authority, path_and_query) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };
    if authority.is_empty() {
        return Err("目标地址缺少主机".to_string());
    }
    if authority.contains('@') {
        return Err("目标地址不能带用户名密码".to_string());
    }
    if authority.contains('[') {
        return Err("只支持 IPv4 局域网地址".to_string());
    }
    let (host_text, port_text) = match authority.rsplit_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    if host_text.contains(':') {
        return Err("只支持 IPv4 局域网地址".to_string());
    }
    let host: Ipv4Addr = host_text
        .parse()
        .map_err(|_| "目标地址必须是 IPv4".to_string())?;
    if !is_lan_ipv4(host) {
        return Err("局域网直连只接受局域网目标".to_string());
    }
    let port = match port_text {
        None | Some("") => 80,
        Some(text) => text
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0)
            .ok_or_else(|| "目标端口不合法".to_string())?,
    };
    let path_and_query = if path_and_query.starts_with('/') {
        path_and_query.to_string()
    } else {
        format!("/{path_and_query}")
    };
    Ok(LanTarget {
        host,
        port,
        path_and_query,
    })
}

fn invalid_header_name(name: &str) -> bool {
    name.is_empty() || !name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn reserved_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "host" | "content-length" | "connection" | "transfer-encoding" | "proxy-connection"
    )
}

/// 组一段 HTTP/1.1 请求；自动补 `Host` / `Content-Length` / `Connection: close`。
pub fn build_request(
    method: &str,
    target: &LanTarget,
    headers: Option<&HashMap<String, String>>,
    body: Option<&str>,
) -> Result<String, String> {
    let method = method.trim().to_ascii_uppercase();
    if !matches!(method.as_str(), "GET" | "POST" | "OPTIONS") {
        return Err(format!("不支持的请求方法：{method}"));
    }
    let body = body.unwrap_or("");
    let mut lines: Vec<(String, String)> = Vec::new();
    let mut total = 0usize;
    if let Some(headers) = headers {
        if headers.len() > MAX_HEADERS {
            return Err("请求头过多".to_string());
        }
        for (name, value) in headers {
            let name = name.trim();
            if invalid_header_name(name) {
                return Err(format!("请求头名称不合法：{name}"));
            }
            if value.contains('\r') || value.contains('\n') {
                return Err(format!("请求头 {name} 的值不能包含换行"));
            }
            if reserved_header(name) {
                continue;
            }
            total += name.len() + value.len() + 4;
            if total > MAX_REQUEST_HEADER_BYTES {
                return Err("请求头过大".to_string());
            }
            lines.push((name.to_string(), value.trim().to_string()));
        }
    }
    lines.sort_by(|left, right| left.0.cmp(&right.0));
    let host = if target.port == 80 {
        target.host.to_string()
    } else {
        format!("{}:{}", target.host, target.port)
    };
    let mut request = format!("{method} {} HTTP/1.1\r\nHost: {host}\r\n", target.path_and_query);
    for (name, value) in lines {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    // POST 即使正文为空也要带 Content-Length；GET 只在真有正文时补。
    if method == "POST" || !body.is_empty() {
        request.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    request.push_str("Connection: close\r\n\r\n");
    request.push_str(body);
    Ok(request)
}

fn find_crlf(bytes: &[u8], from: usize) -> Option<usize> {
    bytes
        .get(from..)?
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|position| from + position)
}

/// 解 chunked 正文；长度行允许 `;` 扩展，末尾 trailer 直接跳过。
pub fn decode_chunked(raw: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut index = 0usize;
    loop {
        let line_end = find_crlf(raw, index).ok_or_else(|| "chunked 响应不完整".to_string())?;
        let line = std::str::from_utf8(&raw[index..line_end])
            .map_err(|_| "chunked 长度行不是 UTF-8".to_string())?;
        let size_text = line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_text, 16)
            .map_err(|_| "chunked 长度行不合法".to_string())?;
        index = line_end + 2;
        if size == 0 {
            // trailer：一直读到空行；没有 trailer 时紧接一个 CRLF。
            loop {
                let trailer_end = find_crlf(raw, index)
                    .ok_or_else(|| "chunked 响应缺少结束空行".to_string())?;
                let trailer = &raw[index..trailer_end];
                index = trailer_end + 2;
                if trailer.is_empty() {
                    return Ok(out);
                }
            }
        }
        if out.len() + size > MAX_RESPONSE_BYTES {
            return Err("响应体超过 20MB 上限".to_string());
        }
        let data_end = index
            .checked_add(size)
            .ok_or_else(|| "chunked 长度溢出".to_string())?;
        let terminated = data_end
            .checked_add(2)
            .filter(|end| *end <= raw.len())
            .ok_or_else(|| "chunked 响应不完整".to_string())?;
        if &raw[data_end..terminated] != b"\r\n" {
            return Err("chunked 数据段缺少 CRLF".to_string());
        }
        out.extend_from_slice(&raw[index..data_end]);
        index = terminated;
    }
}

/// 解析完整响应（状态行 + 头 + 正文）；支持 Content-Length 与 chunked。
pub fn parse_http_response(raw: &[u8]) -> Result<LanHttpResponse, String> {
    let head_end = raw
        .windows(4)
        .take(HEAD_LIMIT)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "响应头不完整".to_string())?;
    let head = std::str::from_utf8(&raw[..head_end])
        .map_err(|_| "响应头不是 UTF-8".to_string())?;
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let mut parts = status_line.split_whitespace();
    let version = parts.next().unwrap_or_default();
    if !version.starts_with("HTTP/1.") {
        return Err("响应不是 HTTP/1.x".to_string());
    }
    let status = parts
        .next()
        .and_then(|text| text.parse::<u16>().ok())
        .filter(|status| (100..=599).contains(status))
        .ok_or_else(|| "响应状态行不合法".to_string())?;
    let mut content_length: Option<usize> = None;
    let mut chunked = false;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        if name == "content-length" {
            let length: usize = value
                .parse()
                .map_err(|_| "Content-Length 不合法".to_string())?;
            if length > MAX_RESPONSE_BYTES {
                return Err("响应体超过 20MB 上限".to_string());
            }
            content_length = Some(length);
        } else if name == "transfer-encoding" && value.to_ascii_lowercase().contains("chunked") {
            chunked = true;
        }
    }
    let body_bytes = &raw[head_end + 4..];
    let body = if chunked {
        decode_chunked(body_bytes)?
    } else if let Some(length) = content_length {
        if body_bytes.len() < length {
            return Err("响应体不完整".to_string());
        }
        body_bytes[..length].to_vec()
    } else {
        body_bytes.to_vec()
    };
    if body.len() > MAX_RESPONSE_BYTES {
        return Err("响应体超过 20MB 上限".to_string());
    }
    let body = String::from_utf8(body).map_err(|_| "响应体不是 UTF-8".to_string())?;
    Ok(LanHttpResponse { status, body })
}

/// 读完整个响应（服务端一律 `Connection: close`）再解析；超时与超限都转成可读文案。
pub fn read_http_response(reader: &mut impl Read) -> Result<LanHttpResponse, String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let limit = MAX_RESPONSE_BYTES + RESPONSE_OVERHEAD;
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                buffer.extend_from_slice(&chunk[..read]);
                if buffer.len() > limit {
                    return Err("响应体超过 20MB 上限".to_string());
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                return Err("读取局域网响应超时".to_string());
            }
            Err(error) => return Err(format!("读取局域网响应失败：{error}")),
        }
    }
    parse_http_response(&buffer)
}

/// 发起一次直连请求：不走系统代理，只连局域网 IPv4。
pub fn perform_request(
    method: &str,
    url: &str,
    headers: Option<&HashMap<String, String>>,
    body: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<LanHttpResponse, String> {
    let target = parse_target(url)?;
    let timeout = timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(100, MAX_TIMEOUT_MS);
    let request = build_request(method, &target, headers, body)?;
    let address = SocketAddr::new(IpAddr::V4(target.host), target.port);
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(timeout))
        .map_err(|error| format!("连接 {address} 失败：{error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(timeout)))
        .map_err(|error| format!("设置读超时失败：{error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_millis(timeout)))
        .map_err(|error| format!("设置写超时失败：{error}"))?;
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("发送局域网请求失败：{error}"))?;
    stream
        .flush()
        .map_err(|error| format!("发送局域网请求失败：{error}"))?;
    read_http_response(&mut stream)
}

/// Tauri 命令：桌面局域网 HTTP 直连（绕过系统代理）。
#[tauri::command]
pub fn lan_http_request(
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<LanHttpResponse, String> {
    perform_request(
        &method,
        &url,
        headers.as_ref(),
        body.as_deref(),
        timeout_ms,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn loopback_target(path: &str) -> LanTarget {
        LanTarget {
            host: Ipv4Addr::LOCALHOST,
            port: 80,
            path_and_query: path.to_string(),
        }
    }

    #[test]
    fn parse_target_accepts_only_http_lan_ipv4() {
        let target = parse_target("http://192.168.1.5:8765/pair?x=1").expect("应能解析");
        assert_eq!(target.host, Ipv4Addr::new(192, 168, 1, 5));
        assert_eq!(target.port, 8765);
        assert_eq!(target.path_and_query, "/pair?x=1");
        let no_path = parse_target("http://10.0.0.8").expect("应能解析");
        assert_eq!(no_path.port, 80);
        assert_eq!(no_path.path_and_query, "/");
        assert!(parse_target("https://192.168.1.5/pair").is_err());
        assert!(parse_target("http://8.8.8.8/").is_err());
        assert!(parse_target("http://example.com/").is_err());
        assert!(parse_target("http://192.168.1.5:0/").is_err());
        assert!(parse_target("http://192.168.1.5:99999/").is_err());
        assert!(parse_target("http://user:pass@192.168.1.5/").is_err());
        assert!(parse_target("http://[::1]/").is_err());
        assert!(parse_target("http://192.168.1.5/#frag").is_err());
        // 100.64/10 与 169.254/16 也是局域网口径
        assert!(parse_target("http://100.100.1.1:8765/").is_ok());
        assert!(parse_target("http://169.254.3.4/").is_ok());
    }

    #[test]
    fn build_request_adds_host_length_and_skips_reserved_headers() {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        headers.insert("Authorization".to_string(), "Bearer abc".to_string());
        headers.insert("Host".to_string(), "evil".to_string());
        headers.insert("Content-Length".to_string(), "999".to_string());
        let request = build_request(
            "post",
            &LanTarget {
                host: Ipv4Addr::new(192, 168, 1, 5),
                port: 8765,
                path_and_query: "/import?mode=merge".to_string(),
            },
            Some(&headers),
            Some("{}"),
        )
        .expect("应能组请求");
        assert!(request.starts_with("POST /import?mode=merge HTTP/1.1\r\n"));
        assert!(request.contains("Host: 192.168.1.5:8765\r\n"));
        assert!(request.contains("Authorization: Bearer abc\r\n"));
        assert!(request.contains("Content-Type: application/json\r\n"));
        assert!(request.contains("Content-Length: 2\r\n"));
        assert!(!request.contains("evil"));
        assert!(!request.contains("Content-Length: 999"));
        assert!(request.ends_with("Connection: close\r\n\r\n{}"));

        let get = build_request("GET", &loopback_target("/export"), None, None).expect("应能组请求");
        assert!(get.contains("Host: 127.0.0.1\r\n"));
        assert!(!get.contains("Content-Length"));
        assert_eq!(get.matches("\r\n").count(), 4);
    }

    #[test]
    fn build_request_rejects_methods_and_header_injection() {
        assert!(build_request("DELETE", &loopback_target("/"), None, None).is_err());
        let mut headers = HashMap::new();
        headers.insert("X-Bad".to_string(), "a\r\nInjected: 1".to_string());
        assert!(build_request("GET", &loopback_target("/"), Some(&headers), None).is_err());
        let mut bad_name = HashMap::new();
        bad_name.insert("Bad Name".to_string(), "x".to_string());
        assert!(build_request("GET", &loopback_target("/"), Some(&bad_name), None).is_err());
    }

    #[test]
    fn parses_content_length_response() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}EXTRA";
        let response = parse_http_response(raw).expect("应能解析");
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"ok\":true}");
        assert!(parse_http_response(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort").is_err());
        assert!(parse_http_response(b"NOT HTTP\r\n\r\n").is_err());
        assert!(parse_http_response(b"HTTP/1.1 abc OK\r\n\r\n").is_err());
    }

    #[test]
    fn parses_chunked_response_with_extensions_and_trailers() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4;name=v\r\n{\"a\"\r\n3\r\n:1}\r\n0\r\nX-Trailer: yes\r\n\r\n";
        let response = parse_http_response(raw).expect("应能解析 chunked");
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"a\":1}");
        assert!(decode_chunked(b"5\r\nhello\r\n0\r\n\r\n").is_ok());
        assert!(decode_chunked(b"5\r\nhello").is_err());
        assert!(decode_chunked(b"zz\r\nhello\r\n0\r\n\r\n").is_err());
        assert!(decode_chunked(b"5\r\nhelloXX0\r\n\r\n").is_err());
    }

    #[test]
    fn rejects_oversized_responses() {
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
            MAX_RESPONSE_BYTES + 1
        );
        assert!(parse_http_response(head.as_bytes()).is_err());
        let huge = format!("{:x}\r\n", MAX_RESPONSE_BYTES + 1);
        let mut chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
        chunked.extend_from_slice(huge.as_bytes());
        chunked.extend_from_slice(b"\r\nx");
        assert!(parse_http_response(&chunked).is_err());
    }

    #[test]
    fn rejects_non_lan_command_target() {
        let error = lan_http_request(
            "GET".to_string(),
            "http://203.0.113.9/pair".to_string(),
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(error.contains("局域网"), "{error}");
        assert!(lan_http_request(
            "GET".to_string(),
            "https://192.168.1.5/pair".to_string(),
            None,
            None,
            None,
        )
        .is_err());
    }

    #[test]
    fn loopback_roundtrip_reads_chunked_body() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("应能监听环回");
        let port = listener.local_addr().expect("应能取端口").port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("应能接受连接");
            let mut buffer = [0u8; 1024];
            let read = stream.read(&mut buffer).expect("应能读请求");
            let request = String::from_utf8_lossy(&buffer[..read]).to_string();
            assert!(request.starts_with("GET /export?scope=todos HTTP/1.1"), "{request}");
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n7\r\n{\"ok\":1\r\n1\r\n}\r\n0\r\n\r\n",
                )
                .expect("应能写响应");
        });
        let response = perform_request(
            "GET",
            &format!("http://127.0.0.1:{port}/export?scope=todos"),
            None,
            None,
            Some(3000),
        )
        .expect("应能拿到响应");
        server.join().expect("服务线程应结束");
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"ok\":1}");
    }
}
