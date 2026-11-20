//! 日志：目录、文件、控制台、时间戳与级别，以及前端日志落盘。


use super::*;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

/// 日志目录候选：数据目录优先，其次 %LOCALAPPDATA%\com.dawntick.app，最后 %TEMP%\DawnTick。
pub(crate) fn compute_log_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![data_dir()];
    if let Some(dir) = app_dir() {
        dirs.push(dir);
    }
    if let Ok(temp) = std::env::var("TEMP") {
        dirs.push(PathBuf::from(temp).join("DawnTick"));
    }
    dirs
}

/// 日志目录只解析一次：解析要读引导文件与探针，不能每写一行都算一遍。
pub(crate) static LOG_DIRS: std::sync::OnceLock<Vec<PathBuf>> = std::sync::OnceLock::new();

pub(crate) fn log_dirs() -> &'static [PathBuf] {
    LOG_DIRS.get_or_init(compute_log_dirs)
}

/// 以追加方式打开某个候选目录里的日志文件；不可写返回 None。
/// 目标是数据库文件（含硬链、软链造成的别名）时返回 None：日志文本不写进数据库。
pub(crate) fn open_log_file(dir: &std::path::Path) -> Option<std::fs::File> {
    if create_dir_all(dir).is_err() {
        return None;
    }
    let path = dir.join(LOG_FILE_NAME);
    if same_path(&path, &database_file(dir)) {
        return None;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .append(true)
        .open(&path)
        .ok()?;
    // 头部是 SQLite 魔数就放弃这一处
    let mut header = [0u8; 16];
    if std::io::Read::read_exact(&mut file, &mut header).is_ok() && header == *b"SQLite format 3\0" {
        return None;
    }
    Some(file)
}

/// 日志实际落盘的目录：第一个写得进去的候选。
pub(crate) fn log_file_dir() -> Option<PathBuf> {
    log_dirs()
        .iter()
        .find(|dir| open_log_file(dir).is_some())
        .cloned()
        .or_else(|| log_dirs().first().cloned())
}

/// 同一条日志写到控制台：有控制台句柄时直接写，否则退回标准输出。
#[cfg(windows)]
pub(crate) fn console_log(message: &str) {
    use windows_sys::Win32::Foundation::{INVALID_HANDLE_VALUE, HANDLE};
    use windows_sys::Win32::System::Console::{GetStdHandle, WriteConsoleW, STD_OUTPUT_HANDLE};
    unsafe {
        let handle: HANDLE = GetStdHandle(STD_OUTPUT_HANDLE);
        if handle != 0 && handle != INVALID_HANDLE_VALUE {
            let line: Vec<u16> = message.encode_utf16().chain(std::iter::once(b'\n' as u16)).collect();
            let mut written: u32 = 0;
            if WriteConsoleW(
                handle,
                line.as_ptr() as *const std::ffi::c_void,
                line.len() as u32,
                &mut written,
                std::ptr::null(),
            ) != 0
            {
                return;
            }
        }
    }
    let _ = writeln!(std::io::stdout(), "{message}");
}

#[cfg(not(windows))]
pub(crate) fn console_log(message: &str) {
    let _ = writeln!(std::io::stdout(), "{message}");
}

/// 启动时把日志接到控制台：已挂控制台就不动，否则先附加到父进程控制台；
/// 提权实例无法附加时新开一个控制台窗口，保证管理员运行也能看到日志。
#[cfg(windows)]
pub(crate) fn ensure_console() {
    use windows_sys::Win32::System::Console::{
        AllocConsole, AttachConsole, GetConsoleWindow, SetConsoleTitleW, ATTACH_PARENT_PROCESS,
    };
    unsafe {
        if GetConsoleWindow() != 0 {
            return;
        }
        if AttachConsole(ATTACH_PARENT_PROCESS) != 0 {
            return;
        }
        if !is_elevated() {
            return;
        }
        if AllocConsole() != 0 {
            let title: Vec<u16> = crate::copy::window::DEV_CONSOLE_TITLE
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            SetConsoleTitleW(title.as_ptr());
            let _ = writeln!(std::io::stdout(), "{}", crate::copy::window::DEV_CONSOLE_ATTACHED);
        }
    }
}

#[cfg(not(windows))]
pub(crate) fn ensure_console() {}

/// 关掉开发者特性时释放日志控制台，让 dev 构建表现与正式版一致。
#[tauri::command]
pub fn set_dev_console(enabled: bool) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Console::FreeConsole;
        if enabled {
            ensure_console();
        } else {
            unsafe {
                FreeConsole();
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
    }
}

/// 日志统一格式：`2026-10-13 18:01:34.123 +08:00 [info] scope: 消息`。
/// 时间戳口径为本地时间 + 与 UTC 的偏移，文件与控制台用同一行。

/// 天数（1970-01-01 起，可为负）→ 公历年月日（Howard Hinnant 的 civil_from_days）。
pub(crate) fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 把 UTC 毫秒按给定偏移格式化成日志时间戳。
pub(crate) fn format_log_timestamp(unix_ms: i64, offset_minutes: i32) -> String {
    let shifted = unix_ms + i64::from(offset_minutes) * 60_000;
    let days = shifted.div_euclid(86_400_000);
    let rest = shifted.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hours = rest / 3_600_000;
    let minutes = (rest % 3_600_000) / 60_000;
    let seconds = (rest % 60_000) / 1000;
    let millis = rest % 1000;
    let sign = if offset_minutes < 0 { '-' } else { '+' };
    let abs = offset_minutes.abs();
    format!(
        "{year:04}-{month:02}-{day:02} {hours:02}:{minutes:02}:{seconds:02}.{millis:03} {sign}{:02}:{:02}",
        abs / 60,
        abs % 60
    )
}

/// 当前本地时间相对 UTC 的偏移（分钟）。
#[cfg(windows)]
pub(crate) fn local_offset_minutes() -> i32 {
    use windows_sys::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};
    /// 系统处于夏令时（windows-sys 0.52 未导出该常量，取值见 Win32 文档）。
    const TIME_ZONE_ID_DAYLIGHT: u32 = 2;
    unsafe {
        let mut info: TIME_ZONE_INFORMATION = std::mem::zeroed();
        let state = GetTimeZoneInformation(&mut info);
        let mut bias = info.Bias + info.StandardBias;
        if state == TIME_ZONE_ID_DAYLIGHT {
            bias += info.DaylightBias;
        }
        -bias
    }
}

#[cfg(not(windows))]
pub(crate) fn local_offset_minutes() -> i32 {
    0
}

/// 一行日志的前缀：时间戳 + 空格。
pub(crate) fn log_prefix() -> String {
    let unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0);
    format!("{} ", format_log_timestamp(unix_ms, local_offset_minutes()))
}

/// 日志文件名（与前端「应用诊断日志」同一份）。
pub(crate) const LOG_FILE_NAME: &str = "dawn-tick.log";
/// 日志级别：error < warn < info < debug < trace。0 表示不写文件（控制台仍输出）。
pub(crate) static LOG_LEVEL: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(3);
pub(crate) static LOG_FILE_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

pub(crate) fn level_rank(level: &str) -> u8 {
    match level {
        "error" => 1,
        "warn" => 2,
        "info" => 3,
        "debug" => 4,
        "trace" => 5,
        _ => 3,
    }
}

/// 前端设置好级别与开关后调用：级别决定写文件的门槛，开关决定是否写文件。
#[tauri::command]
pub fn set_log_settings(level: String, file_enabled: bool) {
    LOG_LEVEL.store(level_rank(&level), std::sync::atomic::Ordering::Relaxed);
    LOG_FILE_ENABLED.store(file_enabled, std::sync::atomic::Ordering::Relaxed);
}

/// 判断某行是否该写：从行内 `[level]` 解析等级，低于门槛就丢弃。
pub(crate) fn should_write(line: &str) -> bool {
    if !LOG_FILE_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
        return false;
    }
    let level = line
        .split('[')
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .unwrap_or("info");
    level_rank(level) <= LOG_LEVEL.load(std::sync::atomic::Ordering::Relaxed)
}

/// 三端共用的日志范围；与 `apps/web/src/lib/log-scopes.ts`、安卓 `NativeLog.SCOPES` 保持一致。
pub(crate) const LOG_SCOPES: &[&str] = &[
    "app", "storage", "backup", "sync", "reminder", "permission", "widget", "update", "preset", "import",
    "timetable", "todo", "settings", "credentials", "link", "log",
];

/// 日志级别：error 失败且影响用户或数据；warn 已降级或自动恢复；info 关键流程节点；
/// debug 排查用的中间状态；trace 高频细节。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl LogLevel {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            LogLevel::Error => "error",
            LogLevel::Warn => "warn",
            LogLevel::Info => "info",
            LogLevel::Debug => "debug",
            LogLevel::Trace => "trace",
        }
    }
}

/// 一行日志：`[级别] 范围: 消息`。范围不在清单里时开发构建直接断言失败。
/// 消息里的换行（弹窗文案、panic 信息）压成空格，保证一条日志只占一行。
pub(crate) fn log_at(level: LogLevel, scope: &str, message: &str) {
    debug_assert!(LOG_SCOPES.contains(&scope), "未登记的日志范围：{scope}");
    append_log(&log_line(level, scope, message));
}

/// `log_at` 写出的行（不含时间前缀）：`[级别] 范围: 消息`，消息已压成一行。
pub(crate) fn log_line(level: LogLevel, scope: &str, message: &str) -> String {
    format!("[{}] {scope}: {}", level.as_str(), one_line(message))
}

/// 换行压成空格：按 `\n` / `\r` 切开，各段去掉首尾空白，丢掉空段后用单个空格连接。
pub(crate) fn one_line(message: &str) -> std::borrow::Cow<'_, str> {
    if message.contains(['\n', '\r']) {
        std::borrow::Cow::Owned(
            message
                .split(['\n', '\r'])
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" "),
        )
    } else {
        std::borrow::Cow::Borrowed(message)
    }
}

/// 写进日志的网址只留 `scheme://host/path`：去掉 userinfo、query、fragment 与 `;` 路径参数，
/// 会话号、令牌常藏在这几处。
pub(crate) fn redact_url(url: &str) -> String {
    let (scheme, rest) = match url.split_once("://") {
        Some((scheme, rest)) => (Some(scheme), rest),
        None => (None, url),
    };
    let rest = rest.split(['?', '#']).next().unwrap_or("");
    let (authority, path) = match rest.find('/') {
        Some(index) => rest.split_at(index),
        None => (rest, ""),
    };
    let host = authority.rsplit('@').next().unwrap_or("");
    let path = path.split(';').next().unwrap_or("");
    match scheme {
        Some(scheme) => format!("{scheme}://{host}{path}"),
        None => format!("{host}{path}"),
    }
}

pub(crate) fn log_error(scope: &str, message: impl AsRef<str>) {
    log_at(LogLevel::Error, scope, message.as_ref());
}

pub(crate) fn log_warn(scope: &str, message: impl AsRef<str>) {
    log_at(LogLevel::Warn, scope, message.as_ref());
}

pub(crate) fn log_info(scope: &str, message: impl AsRef<str>) {
    log_at(LogLevel::Info, scope, message.as_ref());
}

pub(crate) fn log_debug(scope: &str, message: impl AsRef<str>) {
    log_at(LogLevel::Debug, scope, message.as_ref());
}

pub(crate) fn log_trace(scope: &str, message: impl AsRef<str>) {
    log_at(LogLevel::Trace, scope, message.as_ref());
}

pub(crate) fn append_log(message: &str) {
    let line = format!("{}{message}", log_prefix());
    if !should_write(&line) {
        console_log(&line);
        return;
    }
    for dir in log_dirs() {
        if let Some(mut file) = open_log_file(dir) {
            let _ = writeln!(file, "{line}");
            break;
        }
    }
    console_log(&line);
}

/// 前端日志落盘：与 panic、启动错误写入同一文件。
#[tauri::command]
pub async fn log_event(level: String, scope: String, message: String, detail: Option<String>) {
    // 每行都要写文件：放到阻塞线程池，不占主线程
    let _ = tauri::async_runtime::spawn_blocking(move || log_event_blocking(level, scope, message, detail)).await;
}

pub(crate) fn log_event_blocking(level: String, scope: String, message: String, detail: Option<String>) {
    append_log(&event_line(&level, &scope, &message, detail.as_deref()));
}

/// 前端日志落盘的行（不含时间前缀）：`[级别] 范围: 消息 明细`。
/// detail 为前端附带的 JSON 明细；为空或 `null` 时省略，保证日志行格式稳定。
/// 前端消息或明细带换行时同样折成一行，导出与按级别过滤都按行处理。
pub(crate) fn event_line(level: &str, scope: &str, message: &str, detail: Option<&str>) -> String {
    let tail = match detail {
        Some(text) if !text.is_empty() && text != "null" => format!(" {text}"),
        _ => String::new(),
    };
    one_line(&format!("[{level}] {scope}: {message}{tail}")).into_owned()
}
