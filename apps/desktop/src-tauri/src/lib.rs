use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

/// 与 Web 端、移动端共用的建表 SQL。
pub const SCHEMA_SQL: &str = include_str!("../../../../packages/core/src/schema/001_init.sql");

pub const DATABASE_URL: &str = "sqlite:dawn-tick.db";

fn log_dir() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    Some(PathBuf::from(base).join("com.dawntick.app"))
}

fn append_log(message: &str) {
    let Some(dir) = log_dir() else {
        eprintln!("{message}");
        return;
    };
    if create_dir_all(&dir).is_err() {
        eprintln!("{message}");
        return;
    }
    match OpenOptions::new().create(true).append(true).open(dir.join("startup.log")) {
        Ok(mut file) => {
            let _ = writeln!(file, "{message}");
        }
        Err(_) => eprintln!("{message}"),
    }
}

/// release 版没有控制台，panic 信息必须落盘才能排查。
fn install_panic_logger() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        append_log(&format!("panic: {info}"));
        default_hook(info);
    }));
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();

    let builder = tauri::Builder::default()
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
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    if let Err(error) = builder.run(tauri::generate_context!()) {
        append_log(&format!("运行 Tauri 应用失败: {error}"));
        eprintln!("运行 Tauri 应用失败: {error}");
    }
}
