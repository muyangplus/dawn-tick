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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    append_log("应用启动");
    #[cfg(windows)]
    ensure_webview_folder_writable();

    let mut builder = tauri::Builder::default();

    // 单实例：第二次启动只把已有窗口唤到前台。窗口关闭是隐藏到托盘，
    // 没有这一层时用户再点一次图标会以为是「打不开」。
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    let builder = builder
        .invoke_handler(tauri::generate_handler![log_event])
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
            None,
        ));

    #[cfg(desktop)]
    let builder = builder
        .setup(|app| {
            // 托盘失败不阻止应用启动，仅记录
            if let Err(error) = setup_tray(app.handle()) {
                append_log(&format!("托盘初始化失败: {error}"));
            }
            Ok(())
        })        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
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
