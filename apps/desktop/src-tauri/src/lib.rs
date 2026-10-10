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
const MAIN_WINDOW: &str = "main";

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
    let Some(base) = std::env::var("LOCALAPPDATA").ok() else {
        return;
    };
    let app_dir = PathBuf::from(&base).join("com.dawntick.app");
    let dir = app_dir.join("EBWebView");
    if !dir.exists() || is_writable(&dir) {
        return;
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let backup = dir.with_file_name(format!("EBWebView.bak-{stamp}"));
    if std::fs::rename(&dir, &backup).is_ok() {
        append_log(&format!("WebView2 数据目录不可写，已改名重建: {}", backup.display()));
        return;
    }

    let mut candidates = vec![PathBuf::from(&base).join("DawnTick").join("EBWebView")];
    candidates.push(std::env::temp_dir().join("DawnTick").join("EBWebView"));
    for folder in candidates {
        if std::fs::create_dir_all(&folder).is_err() || !is_writable(&folder) {
            continue;
        }
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &folder);
        append_log(&format!("WebView2 数据目录改用可写位置: {}", folder.display()));
        return;
    }
    append_log("WebView2 数据目录不可写，且没有可写兜底目录");
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
        write_json(&path, &InstanceStateFile { pid: std::process::id(), version: APP_VERSION.to_string() });
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
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(1000));
        let Some(path) = quit_request_path() else {
            continue;
        };
        let Some(request) = read_json::<InstanceStateFile>(&path) else {
            continue;
        };
        let _ = std::fs::remove_file(&path);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    append_log(&format!("应用启动 v{APP_VERSION}"));
    #[cfg(windows)]
    ensure_webview_folder_writable();

    // 已有实例时先探测：新版顶掉老版本，同版本或更老则唤回它的主窗口后退出
    #[cfg(windows)]
    if decide_instance() == InstanceRole::FocusExisting {
        focus_main_window();
        append_log("本次启动退出");
        return;
    }

    let mut builder = tauri::Builder::default();

    let builder = builder
        .invoke_handler(tauri::generate_handler![log_event, save_startup_prefs])
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ));

    #[cfg(desktop)]
    let builder = builder
        .setup(|app| {
            use tauri::Manager;

            #[cfg(windows)]
            {
                write_instance_state();
                spawn_takeover_watcher(app.handle().clone());
            }

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
}
