use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

/// 与 Web 端、移动端共用的建表 SQL。
pub const SCHEMA_SQL: &str = include_str!("../../../../packages/core/src/schema/001_init.sql");

pub const DATABASE_URL: &str = "sqlite:dawn-tick.db";

fn log_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(base) = std::env::var("LOCALAPPDATA") {
        dirs.push(PathBuf::from(base).join("com.dawntick.app"));
    }
    if let Ok(temp) = std::env::var("TEMP") {
        dirs.push(PathBuf::from(temp).join("DawnTick"));
    }
    dirs
}

fn append_log(message: &str) {
    for dir in log_dirs() {
        if create_dir_all(&dir).is_err() {
            continue;
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(dir.join("startup.log")) {
            let _ = writeln!(file, "{message}");
            return;
        }
    }
    eprintln!("{message}");
}

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// 开机自启注册的命令行参数：只有带该参数启动才按「启动时隐藏窗口」处理。
const HIDDEN_ARG: &str = "--hidden";
/// 提权实例的标记参数：只写机器级启动项后退出。
const REGISTER_ARG: &str = "--register-autostart";
const MAIN_WINDOW: &str = "main";
/// 内嵌教务窗口的标签。
const IMPORT_WINDOW: &str = "import";

/// 注入到教务页面的脚本：右下角按钮，点击后把页面（含同源 iframe）带回应用页面。
const IMPORT_INJECTION: &str = include_str!("import-injection.js");

/// 教务页面把内容带到应用自身页面后，由该页面交回主窗口。
/// 全程不经过任何本机端口，避免与其他监听程序相互影响。
#[tauri::command]
async fn submit_page_import(app: tauri::AppHandle, payload: String) -> Result<(), String> {
    use tauri::Emitter;
    if !payload.contains("<<<DAWNTICK>>>") {
        append_log("教务页面交回的内容缺少标记，已忽略");
        return Err("内容缺少标记".into());
    }
    append_log(&format!("教务页面交回 {} 字节", payload.len()));
    app.emit("import-payload", payload)
        .map_err(|error| format!("转发回传内容失败: {error}"))
}

/// 打开内嵌教务窗口，由用户自行登录并打开课表页。
/// 必须用 async：同步命令在主线程上执行，而创建窗口要等待主线程，会自锁。
#[tauri::command]
async fn open_import_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri::Manager;
    let parsed: tauri::Url = url.parse().map_err(|error| format!("网址不正确: {error}"))?;
    append_log("开始创建教务窗口");
    if let Some(existing) = app.get_webview_window(IMPORT_WINDOW) {
        let _ = existing.close();
    }
    tauri::WebviewWindowBuilder::new(&app, IMPORT_WINDOW, tauri::WebviewUrl::External(parsed))
        .title("登录教务并打开课表页")
        .inner_size(1100.0, 780.0)
        .initialization_script(IMPORT_INJECTION)
        .build()
        .map_err(|error| format!("打开教务窗口失败: {error}"))?;
    append_log("教务窗口已创建");
    Ok(())
}

/// 关闭内嵌教务窗口。同样用 async，避免在窗口销毁上等待主线程。
#[tauri::command]
async fn close_import_window(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(IMPORT_WINDOW) {
        let _ = window.close();
    }
}

fn app_dir() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA")
        .ok()
        .map(|base| PathBuf::from(base).join("com.dawntick.app"))
}

fn read_json<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn write_json<T: serde::Serialize>(path: &std::path::Path, value: &T) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    if create_dir_all(parent).is_err() {
        return false;
    }
    let Ok(text) = serde_json::to_string(value) else {
        return false;
    };
    std::fs::write(path, text).is_ok()
}

#[derive(serde::Serialize, serde::Deserialize)]
struct InstanceStateFile {
    pid: u32,
    version: String,
}

/// 接管请求：只认新鲜且非本进程写入的请求，避免遗留文件把后续启动顶掉。
#[derive(serde::Serialize, serde::Deserialize)]
struct QuitRequest {
    pid: u32,
    version: String,
    at: u64,
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

const QUIT_REQUEST_MAX_AGE: u64 = 120;

#[derive(serde::Serialize, serde::Deserialize)]
struct StartupPrefs {
    hidden: bool,
}

fn parse_version(text: &str) -> (u32, u32, u32) {
    let core = text.split(['-', '+']).next().unwrap_or(text);
    let mut parts = core.split('.').map(|part| part.parse::<u32>().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

fn version_is_newer(candidate: &str, current: &str) -> bool {
    parse_version(candidate) > parse_version(current)
}

fn read_startup_prefs() -> StartupPrefs {
    app_dir()
        .and_then(|dir| read_json::<StartupPrefs>(&dir.join("startup.json")))
        .unwrap_or(StartupPrefs { hidden: true })
}

/// 只有带 `--hidden`（开机自启）启动且偏好为隐藏时才隐藏窗口；
/// 手动双击始终显示主窗口，避免「点了没反应」。
fn hidden_for_launch(args: &[String], prefs: &StartupPrefs) -> bool {
    args.iter().any(|arg| arg == HIDDEN_ARG) && prefs.hidden
}

fn start_hidden() -> bool {
    let args: Vec<String> = std::env::args().collect();
    hidden_for_launch(&args, &read_startup_prefs())
}

/// release 版没有控制台，panic 信息必须落盘才能排查。
fn install_panic_logger() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        append_log(&format!("panic: {info}"));
        show_error_box("晓刻 DawnTick 启动失败", &info.to_string());
        default_hook(info);
    }));
}

/// 启动失败时给出可见提示，避免进程静默退出。
#[cfg(windows)]
fn show_error_box(title: &str, message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() };
    let title_wide = wide(title);
    let message_wide = wide(message);
    unsafe {
        MessageBoxW(0, message_wide.as_ptr(), title_wide.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

#[cfg(not(windows))]
fn show_error_box(_title: &str, _message: &str) {}

/// WebView2 的用户数据目录同一时刻只能被一个进程使用，且目录若由提权进程创建，
/// 普通权限将无法写入，表现为「双击没反应」。三层兜底：可用则不动，
/// 不可用先改名让 WebView2 重建，改名也失败就改用可写目录。
#[cfg(windows)]
fn ensure_webview_folder_writable() {
    // 已由使用者指定数据目录时不再插手
    if std::env::var("WEBVIEW2_USER_DATA_FOLDER").is_ok() {
        return;
    }
    let Some(base) = std::env::var("LOCALAPPDATA").ok() else {
        return;
    };
    let app_dir = PathBuf::from(&base).join("com.dawntick.app");
    let dir = app_dir.join("EBWebView");
    if !dir.exists() || is_writable(&dir) {
        return;
    }

    append_log("WebView2 数据目录不可写，可能被其他进程占用");
    let holders = describe_holders();
    for line in holders.lines() {
        append_log(line);
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let backup = dir.with_file_name(format!("EBWebView.bak-{stamp}"));
    if std::fs::rename(&dir, &backup).is_ok() {
        append_log(&format!("已改名重建: {}", backup.display()));
        return;
    }
    append_log("改名失败，目录被占用");

    let mut candidates = Vec::new();
    // 首选程序所在目录：便携版放在任意可写位置（含 U 盘）都能自包含运行。
    // WebView2 会在给定目录下自行创建 EBWebView 子目录，这里给的是它的上级目录。
    if let Ok(exe) = std::env::current_exe() {
        if let Some(program_dir) = exe.parent() {
            candidates.push(program_dir.join("DawnTick-data"));
        }
    }
    // 其次与数据库同根的用户目录
    if let Ok(roaming) = std::env::var("APPDATA") {
        candidates.push(PathBuf::from(roaming).join("com.dawntick.app"));
    }

    let mut failures = Vec::new();
    for folder in candidates {
        match create_dir_all(&folder) {
            Ok(()) => {}
            Err(error) => {
                failures.push(format!("{} 创建失败({error})", folder.display()));
                continue;
            }
        }
        if !is_writable(&folder) {
            failures.push(format!("{} 不可写", folder.display()));
            continue;
        }
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &folder);
        append_log(&format!(
            "WebView2 数据目录改用可写位置: {}（其下生成 EBWebView）",
            folder.display()
        ));
        return;
    }

    for line in &failures {
        append_log(&format!("兜底目录不可用: {line}"));
    }
    let restricted = failures.iter().all(|line| line.contains("os error 5"));
    let hint = if restricted {
        "兜底目录都因「拒绝访问」失败，说明当前进程对程序目录与用户目录都没有写权限（可能以受限权限或沙箱方式启动）。请用普通双击方式运行本程序。"
    } else {
        "请结束上述进程（或在任务管理器里结束残留的 msedgewebview2.exe）后重试。"
    };
    let message = format!(
        "WebView2 数据目录不可用，应用无法启动。\n\n{}\n\n{}\n\n{}",
        holders,
        failures.join("\n"),
        hint
    );
    append_log("没有可写兜底目录，启动将失败");
    show_error_box("晓刻 DawnTick 启动失败", &message);
}

/// 列出正在使用或残留占用 WebView2 目录的进程。
#[cfg(windows)]
fn describe_holders() -> String {
    let processes = list_processes();
    let ours: Vec<&ProcessInfo> = processes.iter().filter(|item| is_our_app(&item.name)).collect();
    let webviews: Vec<&ProcessInfo> = processes
        .iter()
        .filter(|item| item.name.eq_ignore_ascii_case("msedgewebview2.exe"))
        .collect();

    let mut lines = Vec::new();
    if ours.is_empty() {
        lines.push("  未发现运行中的晓刻实例".to_string());
    } else {
        for item in &ours {
            lines.push(format!("  晓刻实例 {} PID {}", item.name, item.pid));
            for child in webviews.iter().filter(|view| view.parent == item.pid) {
                lines.push(format!(
                    "    其 WebView2 进程 {} PID {}",
                    child.name, child.pid
                ));
            }
        }
    }

    let alive_pids: Vec<u32> = processes.iter().map(|item| item.pid).collect();
    let orphans: Vec<&&ProcessInfo> = webviews
        .iter()
        .filter(|view| !alive_pids.contains(&view.parent))
        .collect();
    if !orphans.is_empty() {
        lines.push(format!("  上次异常退出残留的 WebView2 进程 {} 个", orphans.len()));
        for item in orphans.iter().take(8) {
            lines.push(format!("    {} PID {}", item.name, item.pid));
        }
    }
    if lines.is_empty() {
        lines.push("  未定位到占用进程".to_string());
    }
    lines.join("\n")
}

#[cfg(windows)]
struct ProcessInfo {
    pid: u32,
    parent: u32,
    name: String,
}

#[cfg(windows)]
fn is_our_app(name: &str) -> bool {
    name.eq_ignore_ascii_case("DawnTick.exe") || name.eq_ignore_ascii_case("dawn-tick-desktop.exe")
}

#[cfg(windows)]
fn list_processes() -> Vec<ProcessInfo> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Vec::new();
    }
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

    let mut result = Vec::new();
    let mut ok = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while ok {
        let name = String::from_utf16_lossy(&entry.szExeFile)
            .trim_end_matches('\0')
            .to_string();
        result.push(ProcessInfo {
            pid: entry.th32ProcessID,
            parent: entry.th32ParentProcessID,
            name,
        });
        ok = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    result
}

#[cfg(windows)]
fn is_writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(".dt-write-probe");
    match OpenOptions::new().create(true).write(true).truncate(true).open(&probe) {
        Ok(file) => {
            drop(file);
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

#[cfg(desktop)]
fn ensure_mini(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    if let Some(window) = app.get_webview_window("mini") {
        return Some(window);
    }
    let built = WebviewWindowBuilder::new(app, "mini", WebviewUrl::App("mini.html".into()))
        .title("晓刻 DawnTick · 下一节课")
        .inner_size(240.0, 104.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .visible(false)
        .build();
    match built {
        Ok(window) => Some(window),
        Err(error) => {
            append_log(&format!("创建紧凑条失败: {error}"));
            None
        }
    }
}

/// 再次启动时的处置方式。
#[cfg(windows)]
#[derive(Debug, PartialEq, Eq)]
enum InstanceRole {
    /// 本进程成为唯一实例
    Owner,
    /// 已有同版本或更新版本实例，唤回它的窗口后退出
    FocusExisting,
}

#[cfg(windows)]
fn instance_state_path() -> Option<PathBuf> {
    app_dir().map(|dir| dir.join("instance.json"))
}

#[cfg(windows)]
fn quit_request_path() -> Option<PathBuf> {
    app_dir().map(|dir| dir.join("instance-quit.json"))
}

#[cfg(windows)]
fn process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle == 0 {
        return false;
    }
    unsafe { CloseHandle(handle) };
    true
}

#[cfg(windows)]
fn focus_main_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    let title: Vec<u16> = "晓刻 DawnTick".encode_utf16().chain(std::iter::once(0)).collect();
    let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
    if hwnd == 0 {
        append_log("未找到已有主窗口，无法唤到前台");
        return;
    }
    unsafe {
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
    }
}

/// 独占标记：同名互斥体存在即表示已有实例在运行。
#[cfg(windows)]
fn hold_instance_mutex() -> bool {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    let name: Vec<u16> = "Local\\DawnTick-SingleInstance"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle == 0 {
        append_log("创建单实例互斥体失败，按独占处理");
        return true;
    }
    // 句柄随进程生命周期保留，进程退出时系统自动释放
    std::mem::forget(handle);
    (unsafe { GetLastError() }) != ERROR_ALREADY_EXISTS
}

/// 探测已有实例并按版本决定：新版顶掉老版本，同版本或更老则唤回主窗口。
#[cfg(windows)]
fn decide_instance() -> InstanceRole {
    if hold_instance_mutex() {
        return InstanceRole::Owner;
    }

    let running: Option<InstanceStateFile> = instance_state_path().and_then(|path| read_json(&path));
    let Some(state) = running else {
        append_log("已有实例但缺少状态文件，按同版本处理");
        return InstanceRole::FocusExisting;
    };
    if !process_alive(state.pid) {
        append_log(&format!("状态文件中的进程 {} 已退出，本次接管", state.pid));
        return InstanceRole::Owner;
    }
    if !version_is_newer(APP_VERSION, &state.version) {
        append_log(&format!(
            "已有实例 v{}（本进程 v{APP_VERSION}），唤回主窗口",
            state.version
        ));
        return InstanceRole::FocusExisting;
    }

    append_log(&format!(
        "本进程 v{APP_VERSION} 新于运行中的 v{}，请求老版本退出",
        state.version
    ));
    if let Some(path) = quit_request_path() {
        write_json(
            &path,
            &QuitRequest {
                pid: std::process::id(),
                version: APP_VERSION.to_string(),
                at: now_seconds(),
            },
        );
    }
    for _ in 0..80 {
        if !process_alive(state.pid) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if process_alive(state.pid) {
        append_log("老版本未在 8 秒内退出，仍然继续启动");
    }
    InstanceRole::Owner
}

#[cfg(windows)]
fn write_instance_state() {
    if let Some(path) = instance_state_path() {
        write_json(&path, &InstanceStateFile { pid: std::process::id(), version: APP_VERSION.to_string() });
    }
}

/// 监听新版本的接管请求，收到后退出本实例。
#[cfg(windows)]
fn spawn_takeover_watcher(app: tauri::AppHandle) {
    // 启动时清掉上一次运行遗留的请求：那是发给上一个实例的
    if let Some(path) = quit_request_path() {
        if std::fs::remove_file(&path).is_ok() {
            append_log("清理遗留的接管请求文件");
        }
    }

    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(1000));
        let Some(path) = quit_request_path() else {
            continue;
        };
        let Some(request) = read_json::<QuitRequest>(&path) else {
            continue;
        };
        let _ = std::fs::remove_file(&path);
        if request.pid == std::process::id() {
            continue;
        }
        if now_seconds().saturating_sub(request.at) > QUIT_REQUEST_MAX_AGE {
            append_log("忽略过期的接管请求");
            continue;
        }
        if version_is_newer(&request.version, APP_VERSION) {
            append_log(&format!("新版本 v{} 请求接管，退出当前实例", request.version));
            app.exit(0);
            return;
        }
    });
}

/// 常驻托盘（D29）：主窗口关闭时隐藏而不退出，紧凑条由托盘控制。
#[cfg(desktop)]
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let show_main = MenuItem::with_id(app, "show_main", "显示主窗口", true, None::<&str>)?;
    let show_mini = MenuItem::with_id(app, "show_mini", "显示紧凑条", true, None::<&str>)?;
    let hide_mini = MenuItem::with_id(app, "hide_mini", "隐藏紧凑条", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_main, &show_mini, &hide_mini, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("晓刻 DawnTick")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_main" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "show_mini" => {
                if let Some(window) = ensure_mini(app) {
                    let _ = window.show();
                }
            }
            "hide_mini" => {
                if let Some(window) = app.get_webview_window("mini") {
                    let _ = window.hide();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let Some(window) = ensure_mini(tray.app_handle()) else {
                    return;
                };
                let visible = window.is_visible().unwrap_or(false);
                if visible {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// 前端日志落盘：与 panic、启动错误写入同一文件。
#[tauri::command]
fn log_event(level: String, scope: String, message: String) {
    append_log(&format!("[{level}] {scope}: {message}"));
}

#[tauri::command]
fn save_startup_prefs(hidden: bool) {
    save_startup_prefs_inner(hidden);
}

fn save_startup_prefs_inner(hidden: bool) {
    if let Some(dir) = app_dir() {
        write_json(&dir.join("startup.json"), &StartupPrefs { hidden });
    }
}

/// 开机自启：直接写注册表，用户级失败时可提权写机器级。
#[cfg(windows)]
mod autostart_reg {
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
        HKEY, KEY_READ, KEY_SET_VALUE, REG_SZ,
    };

    pub const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const VALUE_NAME: &str = "DawnTick";

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn command_line() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|error| format!("获取程序路径失败: {error}"))?;
        Ok(format!("\"{}\" {}", exe.display(), super::HIDDEN_ARG))
    }

    fn open(root: HKEY, key_path: &str, access: u32) -> Option<HKEY> {
        let path = wide(key_path);
        let mut key: HKEY = 0;
        let status = unsafe { RegOpenKeyExW(root, path.as_ptr(), 0, access, &mut key) };
        if status == ERROR_SUCCESS {
            Some(key)
        } else {
            None
        }
    }

    pub fn write_to(root: HKEY, key_path: &str, value_name: &str, value: &str) -> Result<(), String> {
        let path = wide(key_path);
        let mut key: HKEY = 0;
        let status = unsafe {
            RegCreateKeyExW(
                root,
                path.as_ptr(),
                0,
                std::ptr::null(),
                0,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut key,
                std::ptr::null_mut(),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!("打开注册表项失败，代码 {status}"));
        }
        let mut data: Vec<u8> = value.encode_utf16().flat_map(|unit| unit.to_le_bytes()).collect();
        data.extend_from_slice(&[0, 0]);
        let name = wide(value_name);
        let status =
            unsafe { RegSetValueExW(key, name.as_ptr(), 0, REG_SZ, data.as_ptr(), data.len() as u32) };
        unsafe { RegCloseKey(key) };
        if status != ERROR_SUCCESS {
            return Err(format!("写入启动项失败，代码 {status}"));
        }
        Ok(())
    }

    pub fn read_from(root: HKEY, key_path: &str, value_name: &str) -> Option<String> {
        let key = open(root, key_path, KEY_READ)?;
        let name = wide(value_name);
        let mut size: u32 = 0;
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut size,
            )
        };
        if status != ERROR_SUCCESS || size == 0 {
            unsafe { RegCloseKey(key) };
            return None;
        }
        let mut buffer = vec![0u8; size as usize];
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                buffer.as_mut_ptr(),
                &mut size,
            )
        };
        unsafe { RegCloseKey(key) };
        if status == ERROR_FILE_NOT_FOUND || status != ERROR_SUCCESS {
            return None;
        }
        let units: Vec<u16> = buffer
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .take_while(|unit| *unit != 0)
            .collect();
        Some(String::from_utf16_lossy(&units))
    }

    pub fn remove_from(root: HKEY, key_path: &str, value_name: &str) -> bool {
        let Some(key) = open(root, key_path, KEY_SET_VALUE) else {
            return false;
        };
        let name = wide(value_name);
        let status = unsafe { RegDeleteValueW(key, name.as_ptr()) };
        unsafe { RegCloseKey(key) };
        status == ERROR_SUCCESS
    }

    pub fn write(root: HKEY, value: &str) -> Result<(), String> {
        write_to(root, RUN_KEY, VALUE_NAME, value)
    }

    pub fn read(root: HKEY) -> Option<String> {
        read_from(root, RUN_KEY, VALUE_NAME)
    }

    pub fn remove(root: HKEY) -> bool {
        remove_from(root, RUN_KEY, VALUE_NAME)
    }
}

#[derive(serde::Serialize)]
struct AutostartStatus {
    user: bool,
    machine: bool,
}

#[cfg(windows)]
fn autostart_status_inner() -> AutostartStatus {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    AutostartStatus {
        user: autostart_reg::read(HKEY_CURRENT_USER).is_some(),
        machine: autostart_reg::read(HKEY_LOCAL_MACHINE).is_some(),
    }
}

#[cfg(not(windows))]
fn autostart_status_inner() -> AutostartStatus {
    AutostartStatus {
        user: false,
        machine: false,
    }
}

#[tauri::command]
fn autostart_status() -> AutostartStatus {
    autostart_status_inner()
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<AutostartStatus, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        if enabled {
            let command = autostart_reg::command_line()?;
            autostart_reg::write(HKEY_CURRENT_USER, &command)?;
            append_log("已写入用户级开机自启");
        } else {
            let user = autostart_reg::remove(HKEY_CURRENT_USER);
            let machine = autostart_reg::remove(HKEY_LOCAL_MACHINE);
            append_log(&format!("已移除开机自启（用户级={user} 机器级={machine}）"));
        }
        Ok(autostart_status_inner())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("当前平台不支持开机自启".to_string())
    }
}

/// 申请管理员权限重启，由提权实例写入机器级启动项。
#[tauri::command]
fn relaunch_elevated_autostart() -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let exe = std::env::current_exe().map_err(|error| format!("获取程序路径失败: {error}"))?;
        let to_wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() };
        let verb = to_wide("runas");
        let file = to_wide(&exe.to_string_lossy());
        let params = to_wide(REGISTER_ARG);
        let result = unsafe {
            ShellExecuteW(
                0,
                verb.as_ptr(),
                file.as_ptr(),
                params.as_ptr(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if (result as isize) <= 32 {
            return Err(format!("申请管理员权限失败，代码 {}", result as isize));
        }
        append_log("已请求提权实例写入机器级启动项");
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("当前平台不支持".to_string())
    }
}

/// 提权实例启动时的分支：只写机器级启动项，不创建窗口。
#[cfg(windows)]
fn run_elevated_registration() -> bool {
    if !std::env::args().any(|arg| arg == REGISTER_ARG) {
        return false;
    }
    use windows_sys::Win32::System::Registry::HKEY_LOCAL_MACHINE;
    append_log("提权实例：写入机器级开机自启");
    let result = autostart_reg::command_line()
        .and_then(|command| autostart_reg::write(HKEY_LOCAL_MACHINE, &command));
    match result {
        Ok(()) => {
            append_log("机器级开机自启已写入");
            show_error_box("晓刻 DawnTick", "已注册开机自启（机器级），可直接关闭本提示。");
        }
        Err(error) => {
            append_log(&format!("机器级开机自启写入失败: {error}"));
            show_error_box("晓刻 DawnTick 注册失败", &error);
        }
    }
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    append_log(&format!("应用启动 v{APP_VERSION}"));

    // 提权实例只做注册，不进入正常启动流程
    #[cfg(windows)]
    if run_elevated_registration() {
        return;
    }

    // 先判单实例：已有实例时直接唤回它的窗口并退出，不触碰 WebView2 目录
    #[cfg(windows)]
    match decide_instance() {
        InstanceRole::FocusExisting => {
            focus_main_window();
            append_log("本次启动退出");
            return;
        }
        InstanceRole::Owner => write_instance_state(),
    }

    #[cfg(windows)]
    ensure_webview_folder_writable();

    let mut builder = tauri::Builder::default();

    let builder = builder
        .invoke_handler(tauri::generate_handler![
            log_event,
            save_startup_prefs,
            autostart_status,
            set_autostart,
            relaunch_elevated_autostart,
            open_import_window,
            close_import_window,
            submit_page_import
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    DATABASE_URL,
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "init",
                        sql: SCHEMA_SQL,
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    let builder = builder
        .setup(|app| {
            use tauri::Manager;

            #[cfg(windows)]
            spawn_takeover_watcher(app.handle().clone());

            match app.get_webview_window(MAIN_WINDOW) {
                Some(window) => {
                    if start_hidden() {
                        let _ = window.hide();
                        append_log("按设置隐藏主窗口，仅驻留托盘");
                    } else if let Err(error) = window.show() {
                        append_log(&format!("显示主窗口失败: {error}"));
                    }
                }
                None => append_log("未找到主窗口"),
            }

            // 托盘失败不阻止应用启动，仅记录
            if let Err(error) = setup_tray(app.handle()) {
                append_log(&format!("托盘初始化失败: {error}"));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN_WINDOW {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    if let Err(error) = builder.run(tauri::generate_context!()) {
        let message = format!("运行 Tauri 应用失败: {error}");
        append_log(&message);
        eprintln!("{message}");
        show_error_box("晓刻 DawnTick 启动失败", &message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare_detects_newer() {
        assert!(version_is_newer("0.2.0", "0.1.9"));
        assert!(version_is_newer("0.1.1", "0.1.0"));
        assert!(version_is_newer("1.0.0-beta.2", "0.9.9"));
        assert!(version_is_newer("0.1.10", "0.1.9"));
        assert!(!version_is_newer("0.1.0", "0.1.0"));
        assert!(!version_is_newer("0.0.9", "0.1.0"));
        assert!(!version_is_newer("0.1.0-beta.1", "0.1.0"));
    }

    #[test]
    fn hidden_only_for_autostart_launch() {
        let hide = StartupPrefs { hidden: true };
        let show = StartupPrefs { hidden: false };
        let autostart = vec!["DawnTick.exe".to_string(), HIDDEN_ARG.to_string()];
        let manual = vec!["DawnTick.exe".to_string()];

        assert!(hidden_for_launch(&autostart, &hide));
        assert!(!hidden_for_launch(&autostart, &show));
        assert!(!hidden_for_launch(&manual, &hide));
        assert!(!hidden_for_launch(&manual, &show));
    }

    #[test]
    fn version_parse_handles_suffixes() {
        assert_eq!(parse_version("1.2.3"), (1, 2, 3));
        assert_eq!(parse_version("1.2.3-beta.4"), (1, 2, 3));
        assert_eq!(parse_version("1.2"), (1, 2, 0));
        assert_eq!(parse_version("oops"), (0, 0, 0));
    }

    #[cfg(windows)]
    #[test]
    fn our_app_name_matching() {
        assert!(is_our_app("DawnTick.exe"));
        assert!(is_our_app("dawn-tick-desktop.exe"));
        assert!(is_our_app("DAWNTICK.EXE"));
        assert!(!is_our_app("msedgewebview2.exe"));
        assert!(!is_our_app("explorer.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn registry_write_read_delete_roundtrip() {
        use windows_sys::Win32::System::Registry::HKEY_CURRENT_USER;
        // 用临时子键，避免触碰真实启动项
        let key_path = "Software\\DawnTickTest";
        let value_name = "Probe";
        let sample = "\"C:\\tmp\\DawnTick.exe\" --hidden";

        match autostart_reg::write_to(HKEY_CURRENT_USER, key_path, value_name, sample) {
            Ok(()) => {}
            Err(error) if error.contains("代码 5") => {
                // 受限令牌下无法写 HKCU，跳过而不是误报
                eprintln!("跳过：当前进程无权写注册表（{error}）");
                return;
            }
            Err(error) => panic!("写入失败: {error}"),
        }
        assert_eq!(
            autostart_reg::read_from(HKEY_CURRENT_USER, key_path, value_name).as_deref(),
            Some(sample),
            "读回内容应与写入一致"
        );
        assert!(
            autostart_reg::remove_from(HKEY_CURRENT_USER, key_path, value_name),
            "删除应成功"
        );
        assert!(
            autostart_reg::read_from(HKEY_CURRENT_USER, key_path, value_name).is_none(),
            "删除后应读不到"
        );
    }

    #[test]
    fn autostart_command_contains_hidden_flag() {
        #[cfg(windows)]
        {
            let command = autostart_reg::command_line().expect("应能取到程序路径");
            assert!(command.contains(HIDDEN_ARG), "启动项需带 --hidden: {command}");
            assert!(command.starts_with('"'), "程序路径需加引号: {command}");
        }
    }
}
