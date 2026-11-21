//! 托盘图标与菜单。

use super::*;

/// 常驻托盘（D29）：主窗口关闭时隐藏而不退出，紧凑条由托盘控制。
#[cfg(desktop)]
pub(crate) fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::Menu;
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let menu: Menu<_> = reminder_actions::build_menu(app)?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip(copy::tray::TOOLTIP)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            // 提醒子菜单的动作先交给 R-07 模块，其余仍是原有的窗口/退出命令
            if reminder_actions::handle_menu_event(app, event.id.as_ref()) {
                return;
            }
            match event.id.as_ref() {
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
                "quit" => {
                    // 退出前补一次落盘，避免最后 500ms 内的移动/缩放随防抖一起丢掉
                    if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
                        save_geometry_now(&main);
                    }
                    app.exit(0)
                }
                _ => {}
            }
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

    let mut icon_source = "none".to_string();
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
        icon_source = format!("window-icon {}x{}", icon.width(), icon.height());
    }
    match builder.build(app) {
        Ok(_) => {
            log_debug("app", format!("托盘已创建 icon={icon_source}"));
            if let Ok(mut state) = TRAY_STATE.lock() {
                *state = Some((true, icon_source));
            }
            Ok(())
        }
        Err(error) => {
            log_error("app", format!("托盘创建失败 icon={icon_source} error={error}"));
            if let Ok(mut state) = TRAY_STATE.lock() {
                *state = Some((false, format!("{icon_source} / {error}")));
            }
            Err(error)
        }
    }
}

/// 托盘当前状态，供界面显示，避免靠猜。
#[tauri::command]
pub fn tray_status() -> serde_json::Value {
    let (created, detail) = TRAY_STATE
        .lock()
        .ok()
        .and_then(|state| state.clone())
        .unwrap_or((false, copy::tray::NOT_INITIALIZED.to_string()));
    serde_json::json!({ "created": created, "detail": detail })
}
