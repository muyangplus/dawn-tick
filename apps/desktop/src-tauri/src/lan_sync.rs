//! 局域网同步（I-14）的最小 HTTP 服务：只做传输，不解释业务数据。
//!
//! 边界：
//! - 原生层负责：仅绑定本机局域网 IPv4、只接受局域网来源、最小 HTTP/1.1 解析、
//!   请求体 5MB / 响应体 20MB 上限、请求排队与 10 秒处理窗口；
//! - 配对码、令牌、范围与数据导出导入全部在 TS（`apps/web/src/lan-sync*.ts`）：
//!   收到允许的请求后编号入队，前端 `lan_sync_poll` 取走，`lan_sync_respond` 回写；
//! - 协议与两端对照见 `apps/mobile/docs/lan-sync.contract.md`。

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 请求体上限：与 TS 的 `MAX_REQUEST_BYTES` 一致。
pub const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;
/// 响应体上限：导出可能比请求大，单独给 20MB。
pub const MAX_RESPONSE_BYTES: usize = 20 * 1024 * 1024;
/// 一个请求最多等 TS 处理多久；超时回 504 并清掉队列项。
pub const RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);
/// 允许同时在队列里排队的请求数；满了直接 503。
const MAX_PENDING: usize = 32;
/// 请求头上限，防止慢速灌入撑爆内存。
const HEADER_LIMIT: usize = 16 * 1024;
/// 读请求的超时：客户端连上却不发数据时及时放手。
const READ_TIMEOUT: Duration = Duration::from_secs(5);
/// accept 轮询间隔（非阻塞监听 + 运行标志）。
const ACCEPT_POLL: Duration = Duration::from_millis(50);

/// 监听地址，返回给 TS 拼配对码与提示文案。
#[derive(Debug, Clone, serde::Serialize)]
pub struct LanSyncListen {
    pub host: String,
    pub port: u16,
}

/// 一条转发给 TS 的请求。字段与 `apps/web/src/lib/native.ts` 的 `LanSyncRequest`
/// 和 Android `LanRequest` 逐字对应（camelCase 序列化）。
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSyncRequest {
    pub id: u64,
    pub method: String,
    pub path: String,
    pub query: String,
    pub authorization: Option<String>,
    pub body: String,
    pub received_at: u64,
}

/// TS 回写的响应。
#[derive(Debug, Clone, PartialEq)]
struct Reply {
    status: u16,
    body: String,
}

#[derive(Clone)]
struct Shared {
    running: Arc<AtomicBool>,
    queue: Arc<Mutex<VecDeque<LanSyncRequest>>>,
    waiters: Arc<Mutex<HashMap<u64, Sender<Reply>>>>,
    next_id: Arc<AtomicU64>,
}

impl Shared {
    fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(true)),
            queue: Arc::new(Mutex::new(VecDeque::new())),
            waiters: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(0)),
        }
    }

    fn lock_queue(&self) -> std::sync::MutexGuard<'_, VecDeque<LanSyncRequest>> {
        self.queue.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn lock_waiters(&self) -> std::sync::MutexGuard<'_, HashMap<u64, Sender<Reply>>> {
        self.waiters.lock().unwrap_or_else(|error| error.into_inner())
    }
}

/// 一次服务实例：监听线程 + 请求队列 + 等待中的连接。
pub struct LanSyncServer {
    host: String,
    port: u16,
    shared: Shared,
    accept: Option<std::thread::JoinHandle<()>>,
}

impl LanSyncServer {
    /// 绑定 `bind` 的随机端口并开始接受连接；`bind` 必须是局域网地址。
    fn start_on(bind: Ipv4Addr) -> Result<Self, String> {
        if !is_lan_ipv4(bind) {
            return Err("局域网同步只监听局域网地址".to_string());
        }
        let listener =
            TcpListener::bind((bind, 0)).map_err(|error| format!("监听局域网端口失败：{error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("读取监听端口失败：{error}"))?
            .port();
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("设置非阻塞监听失败：{error}"))?;
        let shared = Shared::new();
        let accept_shared = shared.clone();
        let accept = std::thread::spawn(move || accept_loop(listener, accept_shared));
        Ok(Self {
            host: bind.to_string(),
            port,
            shared,
            accept: Some(accept),
        })
    }

    fn listen_info(&self) -> LanSyncListen {
        LanSyncListen {
            host: self.host.clone(),
            port: self.port,
        }
    }

    /// 取一条待处理请求；队列空时 None。
    fn poll(&self) -> Option<LanSyncRequest> {
        self.shared.lock_queue().pop_front()
    }

    /// 回写 TS 的处理结果；请求已超时或不存在时报错（前端只记日志）。
    fn respond(&self, id: u64, status: u16, body: String) -> Result<(), String> {
        if !(100..=599).contains(&status) {
            return Err(format!("HTTP 状态码不合法：{status}"));
        }
        if body.len() > MAX_RESPONSE_BYTES {
            return Err("响应体超过 20MB 上限".to_string());
        }
        let sender = self.shared.lock_waiters().remove(&id);
        match sender {
            Some(sender) => sender
                .send(Reply { status, body })
                .map_err(|_| "请求已超时".to_string()),
            None => Err("请求已超时或不存在".to_string()),
        }
    }

    /// 停止监听：唤醒等待中的连接、清空队列，并等 accept 线程退出。
    fn stop(mut self) {
        self.shared.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.accept.take() {
            let _ = handle.join();
        }
        self.shared.lock_waiters().clear();
        self.shared.lock_queue().clear();
    }

    #[cfg(test)]
    fn address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

fn accept_loop(listener: TcpListener, shared: Shared) {
    while shared.running.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, remote)) => {
                let child = shared.clone();
                std::thread::spawn(move || handle_connection(stream, remote, child));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(ACCEPT_POLL);
            }
            Err(_) => break,
        }
    }
}

fn handle_connection(mut stream: TcpStream, remote: SocketAddr, shared: Shared) {
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(READ_TIMEOUT));
    if !is_lan_ip(remote.ip()) {
        write_json(&mut stream, 403, &error_body("forbidden", "只接受同一局域网内的请求"));
        return;
    }
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err((status, message)) => {
            write_json(&mut stream, status, &error_body(code_for(status), &message));
            return;
        }
    };
    if request.method == "OPTIONS" {
        write_empty(&mut stream, 204);
        return;
    }
    match endpoint(&request.method, &request.path) {
        Endpoint::Match => {}
        Endpoint::MethodNotAllowed => {
            write_json(&mut stream, 405, &error_body("method_not_allowed", "请求方法不对"));
            return;
        }
        Endpoint::Unknown => {
            write_json(&mut stream, 404, &error_body("not_found", "没有该接口"));
            return;
        }
    }

    let id = shared.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let (sender, receiver) = channel::<Reply>();
    // 先登记等待者再入队：TS 可能在入队后立刻轮询并回写
    shared.lock_waiters().insert(id, sender);
    {
        let mut queue = shared.lock_queue();
        if queue.len() >= MAX_PENDING {
            drop(queue);
            shared.lock_waiters().remove(&id);
            write_json(&mut stream, 503, &error_body("busy", "请求队列已满，请稍后重试"));
            return;
        }
        queue.push_back(LanSyncRequest {
            id,
            method: request.method,
            path: request.path,
            query: request.query,
            authorization: request.authorization,
            body: request.body,
            received_at: now_ms(),
        });
    }

    match receiver.recv_timeout(RESPONSE_TIMEOUT) {
        Ok(reply) => write_json(&mut stream, reply.status, &reply.body),
        Err(_) => {
            shared.lock_waiters().remove(&id);
            shared.lock_queue().retain(|item| item.id != id);
            write_json(&mut stream, 504, &error_body("timeout", "本机没有在 10 秒内处理请求"));
        }
    }
}

/// 入口白名单：只接受这三个路径，别的一律 404/405。
enum Endpoint {
    Match,
    MethodNotAllowed,
    Unknown,
}

fn endpoint(method: &str, path: &str) -> Endpoint {
    let expected = match path {
        "/pair" => "POST",
        "/export" => "GET",
        "/import" => "POST",
        _ => return Endpoint::Unknown,
    };
    if method == expected {
        Endpoint::Match
    } else {
        Endpoint::MethodNotAllowed
    }
}

struct ParsedRequest {
    method: String,
    path: String,
    query: String,
    authorization: Option<String>,
    body: String,
}

#[derive(Debug)]
struct Head {
    method: String,
    path: String,
    query: String,
    authorization: Option<String>,
    content_length: usize,
}

fn read_request(stream: &mut TcpStream) -> Result<ParsedRequest, (u16, String)> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    let header_end = loop {
        if let Some(position) = find_header_end(&buffer) {
            break position;
        }
        if buffer.len() > HEADER_LIMIT {
            return Err((431, "请求头过大".to_string()));
        }
        match stream.read(&mut chunk) {
            Ok(0) => return Err((400, "请求不完整".to_string())),
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            Err(error) => return Err((400, format!("读取请求失败：{error}"))),
        }
    };
    let head_text = std::str::from_utf8(&buffer[..header_end])
        .map_err(|_| (400, "请求头不是 UTF-8".to_string()))?;
    let head = parse_head(head_text)?;
    let body_start = header_end + 4;
    let mut body = buffer[body_start..].to_vec();
    if body.len() > head.content_length {
        body.truncate(head.content_length);
    }
    while body.len() < head.content_length {
        match stream.read(&mut chunk) {
            Ok(0) => return Err((400, "请求体不完整".to_string())),
            Ok(read) => body.extend_from_slice(&chunk[..read]),
            Err(error) => return Err((400, format!("读取请求体失败：{error}"))),
        }
    }
    let body = String::from_utf8(body).map_err(|_| (400, "请求体不是 UTF-8".to_string()))?;
    Ok(ParsedRequest {
        method: head.method,
        path: head.path,
        query: head.query,
        authorization: head.authorization,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_head(text: &str) -> Result<Head, (u16, String)> {
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| (400, "缺少请求方法".to_string()))?
        .to_string();
    let target = parts
        .next()
        .ok_or_else(|| (400, "缺少请求路径".to_string()))?;
    let version = parts.next().unwrap_or_default();
    if !version.starts_with("HTTP/") {
        return Err((400, "不是 HTTP 请求".to_string()));
    }
    if !matches!(method.as_str(), "GET" | "POST" | "OPTIONS") {
        return Err((405, "不支持的请求方法".to_string()));
    }
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target, ""),
    };
    if !path.starts_with('/') {
        return Err((400, "请求路径不正确".to_string()));
    }
    let mut authorization = None;
    let mut content_length = 0usize;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        let value = value.trim();
        if name.eq_ignore_ascii_case("authorization") {
            authorization = Some(value.to_string());
        } else if name.eq_ignore_ascii_case("content-length") {
            let parsed: usize = value
                .parse()
                .map_err(|_| (400, "Content-Length 不正确".to_string()))?;
            if parsed > MAX_BODY_BYTES {
                return Err((413, "请求体超过 5MB 上限".to_string()));
            }
            content_length = parsed;
        }
    }
    Ok(Head {
        method,
        path: path.to_string(),
        query: query.to_string(),
        authorization,
        content_length,
    })
}

fn error_body(code: &str, message: &str) -> String {
    serde_json::json!({ "error": { "code": code, "message": message } }).to_string()
}

fn code_for(status: u16) -> &'static str {
    match status {
        403 => "forbidden",
        404 => "not_found",
        405 => "method_not_allowed",
        413 => "payload_too_large",
        431 => "bad_request",
        503 => "busy",
        504 => "timeout",
        _ => "bad_request",
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "OK",
    }
}

fn write_empty(stream: &mut TcpStream, status: u16) {
    let head = format!(
        "HTTP/1.1 {status} {}\r\n{}Connection: close\r\n\r\n",
        reason(status),
        cors_headers()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.flush();
}

fn write_json(stream: &mut TcpStream, status: u16, body: &str) {
    let head = format!(
        "HTTP/1.1 {status} {}\r\n{}Content-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        reason(status),
        cors_headers(),
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

/// 浏览器端要能当发起方，所以每个响应都带 CORS 头。
fn cors_headers() -> &'static str {
    "Access-Control-Allow-Origin: *\r\n\
     Access-Control-Allow-Headers: Authorization, Content-Type\r\n\
     Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
     Cache-Control: no-store\r\n"
}

/// 只接受局域网来源：私网、链路本地与环回。
fn is_lan_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_lan_ipv4(v4),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

fn is_lan_ipv4(ip: Ipv4Addr) -> bool {
    if ip.is_loopback() || ip.is_private() || ip.is_link_local() {
        return true;
    }
    let octets = ip.octets();
    // 100.64.0.0/10（运营商级 NAT）：手机热点与部分校园网会出现
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

/// 找本机局域网 IPv4：借 UDP `connect` 让系统选路（不真正发包），再校验是私网地址。
fn pick_lan_ipv4() -> Option<Ipv4Addr> {
    for target in ["192.168.255.255:9", "10.255.255.255:9", "8.8.8.8:80"] {
        let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else {
            continue;
        };
        if socket.connect(target).is_err() {
            continue;
        }
        if let Ok(local) = socket.local_addr() {
            if let IpAddr::V4(v4) = local.ip() {
                if is_lan_ipv4(v4) && !v4.is_loopback() {
                    return Some(v4);
                }
            }
        }
    }
    None
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// 进程内唯一的服务实例；配对状态在 TS，不在这里。
static LAN_SYNC: Mutex<Option<LanSyncServer>> = Mutex::new(None);

fn lock_server() -> std::sync::MutexGuard<'static, Option<LanSyncServer>> {
    LAN_SYNC.lock().unwrap_or_else(|error| error.into_inner())
}

/// 开启配对服务（幂等）：返回本机局域网地址与系统分配的端口。
#[tauri::command]
pub fn lan_sync_start() -> Result<LanSyncListen, String> {
    let mut guard = lock_server();
    if let Some(server) = guard.as_ref() {
        return Ok(server.listen_info());
    }
    let host = pick_lan_ipv4()
        .ok_or_else(|| "没有找到局域网地址，请先连接 Wi-Fi 或有线网络".to_string())?;
    let server = LanSyncServer::start_on(host)?;
    let info = server.listen_info();
    crate::append_log(&format!(
        "局域网同步已开启：{}:{}",
        info.host, info.port
    ));
    *guard = Some(server);
    Ok(info)
}

/// 停止配对服务并让内存里的令牌随 TS 状态一起失效。
#[tauri::command]
pub fn lan_sync_stop() {
    let server = lock_server().take();
    if let Some(server) = server {
        server.stop();
        crate::append_log("局域网同步已停止");
    }
}

/// 取一条待处理请求；没有返回 null。
#[tauri::command]
pub fn lan_sync_poll() -> Option<LanSyncRequest> {
    let guard = lock_server();
    guard.as_ref().and_then(|server| server.poll())
}

/// 回写处理结果；原生层只负责写出 HTTP 响应。
#[tauri::command]
pub fn lan_sync_respond(id: u64, status: u16, body: String) -> Result<(), String> {
    let guard = lock_server();
    let server = guard
        .as_ref()
        .ok_or_else(|| "局域网同步服务没有开启".to_string())?;
    server.respond(id, status, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_ipv4_ranges() {
        assert!(is_lan_ipv4(Ipv4Addr::new(192, 168, 1, 5)));
        assert!(is_lan_ipv4(Ipv4Addr::new(10, 2, 3, 4)));
        assert!(is_lan_ipv4(Ipv4Addr::new(172, 16, 0, 1)));
        assert!(is_lan_ipv4(Ipv4Addr::new(172, 31, 255, 254)));
        assert!(!is_lan_ipv4(Ipv4Addr::new(172, 32, 0, 1)));
        assert!(is_lan_ipv4(Ipv4Addr::new(169, 254, 1, 1)));
        assert!(is_lan_ipv4(Ipv4Addr::new(127, 0, 0, 1)));
        assert!(is_lan_ipv4(Ipv4Addr::new(100, 100, 1, 1)));
        assert!(!is_lan_ipv4(Ipv4Addr::new(8, 8, 8, 8)));
        assert!(!is_lan_ip(IP_PUBLIC));
        assert!(is_lan_ip(IP_LOCAL));
    }

    const IP_PUBLIC: IpAddr = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 9));
    const IP_LOCAL: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2));

    #[test]
    fn head_parsing_extracts_query_and_auth() {
        let head = parse_head(
            "GET /export?scope=timetable,events HTTP/1.1\r\nHost: lan\r\nAuthorization: Bearer abc",
        )
        .expect("应能解析");
        assert_eq!(head.method, "GET");
        assert_eq!(head.path, "/export");
        assert_eq!(head.query, "scope=timetable,events");
        assert_eq!(head.authorization.as_deref(), Some("Bearer abc"));
        assert_eq!(head.content_length, 0);
    }

    #[test]
    fn head_parsing_rejects_bad_requests() {
        assert_eq!(
            parse_head("PUT /pair HTTP/1.1\r\nContent-Length: 2").unwrap_err().0,
            405
        );
        assert_eq!(
            parse_head("GET /export").unwrap_err().0,
            400
        );
        let oversized = format!("POST /import HTTP/1.1\r\nContent-Length: {}", MAX_BODY_BYTES + 1);
        assert_eq!(parse_head(&oversized).unwrap_err().0, 413);
        assert_eq!(
            parse_head("POST /import HTTP/1.1\r\nContent-Length: abc").unwrap_err().0,
            400
        );
    }

    #[test]
    fn endpoint_allowlist() {
        assert!(matches!(endpoint("POST", "/pair"), Endpoint::Match));
        assert!(matches!(endpoint("GET", "/export"), Endpoint::Match));
        assert!(matches!(endpoint("POST", "/import"), Endpoint::Match));
        assert!(matches!(endpoint("GET", "/pair"), Endpoint::MethodNotAllowed));
        assert!(matches!(endpoint("POST", "/export"), Endpoint::MethodNotAllowed));
        assert!(matches!(endpoint("GET", "/health"), Endpoint::Unknown));
    }

    fn wait_for_request(server: &LanSyncServer) -> LanSyncRequest {
        for _ in 0..200 {
            if let Some(request) = server.poll() {
                return request;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("请求没有进入队列");
    }

    fn send(address: &str, raw: &'static [u8]) -> String {
        let mut stream = TcpStream::connect(address).expect("应能连上本机监听");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("应能设置读超时");
        stream.write_all(raw).expect("应能写出请求");
        let mut response = String::new();
        stream.read_to_string(&mut response).expect("应能读到响应");
        response
    }

    #[test]
    fn pair_roundtrip_over_loopback() {
        let server = LanSyncServer::start_on(Ipv4Addr::LOCALHOST).expect("应能监听环回地址");
        let address = server.address();
        let client = std::thread::spawn(move || {
            send(
                &address,
                b"POST /pair HTTP/1.1\r\nHost: lan\r\nContent-Type: application/json\r\nContent-Length: 17\r\n\r\n{\"code\":\"123456\"}",
            )
        });
        let request = wait_for_request(&server);
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/pair");
        assert_eq!(request.body, "{\"code\":\"123456\"}");
        assert_eq!(request.authorization, None);
        server
            .respond(request.id, 200, "{\"token\":\"abc\"}".to_string())
            .expect("应能回写");
        let response = client.join().expect("客户端线程应结束");
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        assert!(response.contains("{\"token\":\"abc\"}"), "{response}");
        assert!(response.contains("Access-Control-Allow-Origin: *"), "{response}");
        server.stop();
    }

    #[test]
    fn options_and_unknown_path_are_answered_without_ts() {
        let server = LanSyncServer::start_on(Ipv4Addr::LOCALHOST).expect("应能监听环回地址");
        let address = server.address();
        let options = send(
            &address,
            b"OPTIONS /export HTTP/1.1\r\nHost: lan\r\nAccess-Control-Request-Method: GET\r\n\r\n",
        );
        assert!(options.starts_with("HTTP/1.1 204"), "{options}");
        let missing = send(&address, b"GET /nope HTTP/1.1\r\nHost: lan\r\n\r\n");
        assert!(missing.starts_with("HTTP/1.1 404"), "{missing}");
        assert!(missing.contains("\"not_found\""), "{missing}");
        assert!(server.poll().is_none(), "这些请求不应进入 TS 队列");
        server.stop();
    }

    #[test]
    fn respond_unknown_id_is_an_error() {
        let server = LanSyncServer::start_on(Ipv4Addr::LOCALHOST).expect("应能监听环回地址");
        assert!(server.respond(42, 200, "{}".to_string()).is_err());
        assert!(server.respond(1, 99, "{}".to_string()).is_err());
        server.stop();
    }
}
