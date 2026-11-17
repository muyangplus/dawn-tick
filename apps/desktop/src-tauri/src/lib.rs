
mod fs_commands;
mod install_kind;
mod instance_lock;
mod lan_discovery;
mod lan_http;
mod lan_network;
mod lan_sync;
mod paths;
mod portable_update;
mod recover;
mod reminder_actions;
mod secret_store;
mod updater;
mod widget_window;
mod storage;
mod backup;
mod logging;
mod import_window;
mod startup;
mod shell;
mod instance;
mod tray;
mod autostart;
mod elevation;
mod window_geometry;

pub(crate) use storage::*;
pub(crate) use backup::*;
pub(crate) use logging::*;
pub(crate) use import_window::*;
pub(crate) use startup::*;
pub(crate) use shell::*;
#[allow(unused_imports)]
pub(crate) use instance::*;
pub(crate) use tray::*;
pub(crate) use autostart::*;
pub(crate) use elevation::*;
pub(crate) use window_geometry::*;

use install_kind::windows_install_kind;
use lan_discovery::lan_discovery_scan;
use lan_http::lan_http_request;
use lan_network::lan_network_list;
use lan_sync::{lan_sync_poll, lan_sync_respond, lan_sync_start, lan_sync_stop};
use paths::reveal_path;
use portable_update::{exit_for_update, prepare_portable_update};
use reminder_actions::{clear_pending_reminder, set_pending_reminders};
use secret_store::{secret_decrypt, secret_encrypt};
use updater::run_installer;
use widget_window::{ensure_mini, hide_widget, show_main, show_widget, widget_measure, widget_resize};

/// 与 Web 端、移动端共用的建表 SQL。
pub const SCHEMA_SQL: &str = include_str!("../../../../packages/core/src/schema/001_init.sql");
/// 002：待办类型扩充与逐条开关（事件表重建）。
pub const SCHEMA_EVENT_KINDS_SQL: &str =
    include_str!("../../../../packages/core/src/schema/002_event_kinds.sql");
/// 003：条目自定义时间（不按节次）。
pub const SCHEMA_CUSTOM_TIME_SQL: &str =
    include_str!("../../../../packages/core/src/schema/003_custom_time.sql");
/// 004：条目是否显示在课表上。
pub const SCHEMA_TIMETABLE_ENTRIES_SQL: &str =
    include_str!("../../../../packages/core/src/schema/004_timetable_entries.sql");
/// 005：截止时刻对所有条目类型开放。
pub const SCHEMA_DUE_AT_ANY_SQL: &str =
    include_str!("../../../../packages/core/src/schema/005_due_at_any.sql");
/// 006：把迁移版本写进 app_meta，与其余端口径一致。
pub const SCHEMA_VERSION_SQL: &str =
    include_str!("../../../../packages/core/src/schema/006_schema_version.sql");

pub const DATABASE_URL: &str = "sqlite:dawn-tick.db";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// 开机自启注册的命令行参数：只有带该参数启动才按「启动时隐藏窗口」处理。
const HIDDEN_ARG: &str = "--hidden";
/// 提权实例的标记参数：只写机器级启动项后退出。
const MAIN_WINDOW: &str = "main";
/// 托盘创建结果：(是否成功, 细节)
static TRAY_STATE: std::sync::Mutex<Option<(bool, String)>> = std::sync::Mutex::new(None);
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ensure_console();
    install_panic_logger();
    append_log(&format!("应用启动 v{APP_VERSION}"));

    // 先判单实例：拿不到数据目录锁就绝不打开数据库（唤回旧窗口或提示关闭）
    #[cfg(windows)]
    let _instance_lock = match decide_instance() {
        InstanceRole::Owner(lock) => {
            write_instance_state();
            lock
        }
        InstanceRole::NeedsElevation(reason) => {
            append_log(&format!("{reason}：先申请管理员权限，未取得实例锁前不打开数据库"));
            match request_elevation_restart() {
                Ok(()) => {
                    append_log("已启动管理员实例，等待它接管实例锁…");
                    // 旧实例不写库，只等提权实例拿到锁之前保持进程存活，随后退出让出锁
                    std::thread::spawn(|| {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                        std::process::exit(0);
                    });
                    return;
                }
                Err(error) => {
                    let message = format!(
                        "{reason}。\n申请管理员权限失败（{error}）。\n\n\
                         为避免两个实例同时写坏数据库，本次启动已停止，未打开数据库。"
                    );
                    append_log(&message);
                    show_error_box("晓刻 DawnTick 无法启动", &message);
                    return;
                }
            }
        }
        InstanceRole::FocusExisting => {
            let focused = focus_main_window();
            if !focused {
                append_log("已有实例在运行且无法唤回窗口，提示用户先关闭它");
                show_error_box(
                    "晓刻 DawnTick 已在运行",
                    "已有实例在运行，请先关闭它。\n\n\
                     若看不到窗口，可在任务管理器里结束 DawnTick.exe 后重试。",
                );
            }
            append_log("本次启动退出（未打开数据库）");
            return;
        }
        InstanceRole::Blocked(reason) => {
            append_log(&format!("本次启动停止（未打开数据库）：{reason}"));
            show_error_box("晓刻 DawnTick 无法启动", &reason);
            return;
        }
    };

    #[cfg(not(windows))]
    let _instance_lock = match instance_lock::acquire(&data_dir()) {
        instance_lock::Gate::Owner(lock) => lock,
        instance_lock::Gate::Busy { lock, reason } => {
            append_log(&format!("已有实例占用 {}（{reason}），本次启动退出", lock.display()));
            return;
        }
        instance_lock::Gate::Unavailable { lock, reason } => {
            append_log(&format!("无法建立实例锁 {}（{reason}），本次启动退出", lock.display()));
            return;
        }
    };

    // 先套用排队的恢复请求：必须在打开数据库之前完成
    apply_pending_restore();

    // 打开数据库之前的自检：先清掉空快照，再处理损坏的数据库
    let empty = cleanup_empty_backups_in(&backups_dir());
    if empty > 0 {
        append_log(&format!("已清理 {empty} 份空快照"));
    }
    if let Some(notice) = repair_database(&data_dir()) {
        append_log(&notice);
        set_recovery_notice(notice);
    }

    // 旧的 window.json 不再使用（窗口几何改存数据库），顺手清掉
    let legacy_geometry = data_dir().join("window.json");
    if legacy_geometry.is_file() && std::fs::remove_file(&legacy_geometry).is_ok() {
        append_log("已清理不再使用的 window.json");
    }

    #[cfg(windows)]
    ensure_webview_folder_writable();

    #[cfg(windows)]
    log_database_status();

    // 提权实例拿到锁之后，还要等旧实例把数据库文件句柄放掉；等不到就给可读错误，不硬开库
    #[cfg(windows)]
    if launch_has_elevate_marker() && !database_writable() {
        append_log("提权实例已取得实例锁，等待数据库文件可写…");
        if !instance_lock::wait_until(std::time::Duration::from_secs(10), database_writable) {
            let message = "已取得实例锁，但数据库文件仍不可写（可能被其它程序占用）。\n\n\
                           请关闭占用数据库的程序后重试；本次启动未打开数据库。";
            append_log(message);
            show_error_box("晓刻 DawnTick 无法打开数据库", message);
            return;
        }
        append_log("数据库文件已可写，继续启动");
    }

    // 数据库不可写（拒绝访问）时自动申请管理员权限并重启
    #[cfg(windows)]
    {
        let db_denied = !database_writable();
        if db_denied {
            ACCESS_DENIED_SEEN.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        let webview_denied = ACCESS_DENIED_SEEN.load(std::sync::atomic::Ordering::SeqCst);
        if webview_denied || db_denied {
            let reason = if webview_denied && db_denied {
                "WebView2 数据目录与数据库均被拒绝访问"
            } else if webview_denied {
                "WebView2 数据目录被拒绝访问"
            } else {
                "数据库不可写"
            };
            if elevate_on_access_denied(reason) {
                return;
            }
        }
    }

    let builder = tauri::Builder::default();

    let builder = builder
        .invoke_handler(tauri::generate_handler![
            log_event,
            set_dev_console,
            set_log_settings,
            save_startup_prefs,
            autostart_status,
            set_autostart,
            relaunch_elevated,
            elevation_status,
            database_url,
            storage_info,
            set_storage_path,
            open_data_dir,
            relaunch_app,
            backup_target,
            list_backups,
            delete_backup,
            prune_backups,
            restore_backup,
            recovery_notice,
            recover_database,
            open_import_window,
            close_import_window,
            submit_page_import,
            show_widget,
            hide_widget,
            show_main,
            widget_measure,
            widget_resize,
            reveal_path,
            run_installer,
            windows_install_kind,
            prepare_portable_update,
            exit_for_update,
            tray_status,
            open_external_url,
            open_log_dir,
            fs_commands::save_file,
            fs_commands::stage_update,
            lan_sync_start,
            lan_sync_stop,
            lan_sync_poll,
            lan_sync_respond,
            lan_discovery_scan,
            lan_network_list,
            lan_http_request,
            set_pending_reminders,
            clear_pending_reminder,
            secret_encrypt,
            secret_decrypt
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    &database_url_string(),
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "init",
                            sql: SCHEMA_SQL,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "event_kinds",
                            sql: SCHEMA_EVENT_KINDS_SQL,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 3,
                            description: "custom_time",
                            sql: SCHEMA_CUSTOM_TIME_SQL,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 4,
                            description: "timetable_entries",
                            sql: SCHEMA_TIMETABLE_ENTRIES_SQL,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 5,
                            description: "due_at_any",
                            sql: SCHEMA_DUE_AT_ANY_SQL,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 6,
                            description: "schema_version",
                            sql: SCHEMA_VERSION_SQL,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init());

    #[cfg(desktop)]
    let builder = builder
        .setup(|app| {
            use tauri::Manager;

            #[cfg(windows)]
            spawn_takeover_watcher(app.handle().clone());

            match app.get_webview_window(MAIN_WINDOW) {
                Some(window) => {
                    // 在显示之前套用上次的几何，避免窗口先出现在默认位置再跳过去
                    restore_main_window_geometry(&window);
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
            // 只处理主窗口：悬浮窗（mini）与导入窗口（import）不参与几何记忆
            if window.label() != MAIN_WINDOW {
                return;
            }
            use tauri::Manager;
            match event {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    // 事件只给 &Window，几何读写统一走 WebviewWindow
                    if let Some(main) = window.get_webview_window(MAIN_WINDOW) {
                        schedule_geometry_save(&main);
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // 关闭（实际是隐藏到托盘）先立即落盘，再拦下关闭
                    if let Some(main) = window.get_webview_window(MAIN_WINDOW) {
                        save_geometry_now(&main);
                    }
                    api.prevent_close();
                    let _ = window.hide();
                }
                _ => {}
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
    use std::path::PathBuf;

    #[test]
    fn import_nonce_is_injected_and_checked() {
        let first = fresh_import_nonce();
        let second = fresh_import_nonce();
        assert_eq!(first.len(), 32);
        assert_ne!(first, second);
        let script = import_injection_with(&first);
        assert!(script.contains(&first));
        assert!(!script.contains("__DT_IMPORT_NONCE__"));
        assert!(import_nonce_matches(Some(&first), &first));
        assert!(!import_nonce_matches(Some(&first), &second));
        assert!(!import_nonce_matches(Some(&first), ""));
        assert!(!import_nonce_matches(None, ""));
    }

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
    fn log_timestamp_matches_local_offset() {
        assert_eq!(format_log_timestamp(0, 0), "1970-01-01 00:00:00.000 +00:00");
        assert_eq!(format_log_timestamp(0, 480), "1970-01-01 08:00:00.000 +08:00");
        assert_eq!(format_log_timestamp(0, -330), "1969-12-31 18:30:00.000 -05:30");
        assert_eq!(format_log_timestamp(1_700_000_000_000, 0), "2023-11-14 22:13:20.000 +00:00");
        assert_eq!(
            format_log_timestamp(1_700_000_000_123, 480),
            "2023-11-15 06:13:20.123 +08:00"
        );
    }

    #[test]
    fn log_prefix_has_local_offset() {
        let prefix = log_prefix();
        let chars: Vec<char> = prefix.chars().collect();
        assert_eq!(chars.len(), 31, "{prefix}");
        assert_eq!(chars[10], ' ');
        assert_eq!(chars[23], ' ');
        assert!(chars[24] == '+' || chars[24] == '-', "{prefix}");
        assert_eq!(chars[30], ' ');
    }

    #[test]
    fn external_link_scheme_is_restricted() {
        assert!(external_url_is_allowed("https://github.com/muyangplus/dawn-tick-presets"));
        assert!(external_url_is_allowed("HTTP://example.com/issue/new?template=request-school.yml"));
        assert!(!external_url_is_allowed("file:///C:/Windows/System32"));
        assert!(!external_url_is_allowed("javascript:alert(1)"));
        assert!(!external_url_is_allowed("C:\\Windows\\System32\\calc.exe"));
        assert!(!external_url_is_allowed("https://example.com/\r\ncalc"));
        assert!(!external_url_is_allowed("https://example.com/\"quoted\""));
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

    fn geometry(width: u32, height: u32, x: i32, y: i32, maximized: bool) -> WindowGeometry {
        WindowGeometry { width, height, x, y, maximized, monitor: None }
    }

    /// 带显示器指纹的几何：物理尺寸 + 保存时的显示器（名称/scale/逻辑偏移）。
    fn geometry_on_monitor(
        width: u32,
        height: u32,
        x: i32,
        y: i32,
        name: Option<&str>,
        scale: f64,
        offset: (f64, f64),
    ) -> WindowGeometry {
        WindowGeometry {
            width,
            height,
            x,
            y,
            maximized: false,
            monitor: Some(MonitorRef {
                name: name.map(|name| name.to_string()),
                scale_factor: scale,
                offset_x: offset.0,
                offset_y: offset.1,
            }),
        }
    }

    /// 当前显示器快照：物理原点 (origin_x, origin_y) 按当前 scale 换算成逻辑原点。
    fn snapshot(name: Option<&str>, origin_x: i32, origin_y: i32, scale: f64) -> MonitorSnapshot {
        MonitorSnapshot {
            name: name.map(|name| name.to_string()),
            logical_x: origin_x as f64 / scale,
            logical_y: origin_y as f64 / scale,
            scale_factor: scale,
        }
    }

    #[test]
    fn geometry_accepts_normal_values() {
        assert!(geometry_is_sane(&geometry(1200, 800, 100, 80, false)));
        assert!(geometry_is_sane(&geometry(1000, 720, 0, 0, true)));
        // 边界值本身合法
        assert!(geometry_is_sane(&geometry(MIN_WINDOW_SIZE, MIN_WINDOW_SIZE, 0, 0, false)));
        assert!(geometry_is_sane(&geometry(MAX_WINDOW_SIZE, MAX_WINDOW_SIZE, 0, 0, false)));
        // 副屏在主屏左侧/上方时为负坐标，仍然合法
        assert!(geometry_is_sane(&geometry(1200, 800, -1920, -200, false)));
    }

    #[test]
    fn geometry_rejects_bad_sizes_and_coords() {
        assert!(!geometry_is_sane(&geometry(MIN_WINDOW_SIZE - 1, 800, 0, 0, false)));
        assert!(!geometry_is_sane(&geometry(1200, MIN_WINDOW_SIZE - 1, 0, 0, false)));
        assert!(!geometry_is_sane(&geometry(MAX_WINDOW_SIZE + 1, 800, 0, 0, false)));
        assert!(!geometry_is_sane(&geometry(1200, MAX_WINDOW_SIZE + 1, 0, 0, false)));
        // 最小化过程中可能出现的 0 尺寸
        assert!(!geometry_is_sane(&geometry(0, 0, 0, 0, false)));
        assert!(!geometry_is_sane(&geometry(1200, 800, 20001, 0, false)));
        assert!(!geometry_is_sane(&geometry(1200, 800, 0, -20001, false)));
        // i32::MIN 不能让校验 panic
        assert!(!geometry_is_sane(&geometry(1200, 800, i32::MIN, 0, false)));
        assert!(!geometry_is_sane(&geometry(1200, 800, 0, i32::MIN, false)));
    }

    #[test]
    fn geometry_json_roundtrip_matches_spec() {
        let text = r#"{"width":1200,"height":800,"x":100,"y":80,"maximized":false}"#;
        let parsed: WindowGeometry = serde_json::from_str(text).expect("应能解析");
        assert_eq!(parsed, geometry(1200, 800, 100, 80, false));
        assert_eq!(serde_json::to_string(&parsed).expect("应能序列化"), text);
        // 字段缺失 / 损坏一律按默认值处理
        assert!(serde_json::from_str::<WindowGeometry>(r#"{"width":1200}"#).is_err());
        assert!(serde_json::from_str::<WindowGeometry>("not json").is_err());
    }

    /// 旧文件没有 monitor 字段：照旧解析、照旧写回，一个字节都不变。
    #[test]
    fn geometry_old_file_without_monitor_still_parses() {
        let text = r#"{"width":1532,"height":978,"x":175,"y":138,"maximized":false}"#;
        let parsed: WindowGeometry = serde_json::from_str(text).expect("旧文件应能解析");
        assert_eq!(parsed, geometry(1532, 978, 175, 138, false));
        assert!(parsed.monitor.is_none(), "旧文件不应凭空得到显示器指纹");
        assert_eq!(serde_json::to_string(&parsed).expect("应能序列化"), text);
    }

    /// monitor 子字段缺失（手改过的文件）不能解析失败：scale 兜底为 0.0，重映射因此退回物理逻辑。
    #[test]
    fn monitor_field_with_missing_scale_falls_back() {
        let parsed: WindowGeometry = serde_json::from_str(
            r#"{"width":1200,"height":800,"x":0,"y":0,"maximized":false,"monitor":{"name":"屏A","offset_x":10.0,"offset_y":20.0}}"#,
        )
        .expect("monitor 子字段缺失也应能解析");
        let saved = parsed.monitor.clone().expect("应带显示器指纹");
        assert_eq!(saved.scale_factor, 0.0, "缺失的 scale 兜底为 0.0");
        assert!(remap_to_monitor(&parsed, &[snapshot(Some("屏A"), 0, 0, 1.0)]).is_none());
        assert_eq!(remap_skip_reason(&parsed, &[snapshot(Some("屏A"), 0, 0, 1.0)]), "显示器指纹数值非法");
    }

    /// 带显示器指纹的 JSON 往返：字段名与形态固定。
    #[test]
    fn geometry_json_roundtrip_with_monitor() {
        let saved = geometry_on_monitor(1600, 1000, 1920, 0, Some("DELL U2720Q"), 1.5, (100.0, 50.0));
        let text = serde_json::to_string(&saved).expect("应能序列化");
        assert_eq!(
            text,
            r#"{"width":1600,"height":1000,"x":1920,"y":0,"maximized":false,"monitor":{"name":"DELL U2720Q","scale_factor":1.5,"offset_x":100.0,"offset_y":50.0}}"#
        );
        assert_eq!(serde_json::from_str::<WindowGeometry>(&text).expect("应能解析"), saved);
        // 拿不到显示器名称时省略 name 字段，仍然可解析
        let nameless = geometry_on_monitor(1200, 800, 0, 0, None, 1.0, (0.0, 0.0));
        let text = serde_json::to_string(&nameless).expect("应能序列化");
        assert!(!text.contains("name"), "名称为 None 时不写 name: {text}");
        assert_eq!(serde_json::from_str::<WindowGeometry>(&text).expect("应能解析"), nameless);
    }

    /// 同名显示器 + scale 变化：位置按逻辑偏移重算，尺寸按保存时的逻辑尺寸。
    #[test]
    fn remap_uses_same_monitor_and_new_scale() {
        // 保存时：scale 1.0，窗口物理 1600x1000，逻辑偏移 (300,200)
        let saved = geometry_on_monitor(1600, 1000, 1920 + 300, 200, Some("DELL U2720Q"), 1.0, (300.0, 200.0));
        // 现在的布局：外接屏物理原点 x=1600，当前缩放 1.25 → 逻辑原点 (1280,0)
        let monitors = [
            snapshot(Some("内置屏"), 0, 0, 1.25),
            snapshot(Some("DELL U2720Q"), 1600, 0, 1.25),
        ];
        let target = remap_to_monitor(&saved, &monitors).expect("同名显示器应能重映射");
        assert_eq!((target.width, target.height), (1600.0, 1000.0), "逻辑尺寸 = 物理尺寸 / 保存时 scale");
        assert_eq!((target.x, target.y), (1580.0, 200.0), "逻辑位置 = 显示器当前逻辑原点 + 保存的逻辑偏移");
        assert_eq!(target.scale_factor, 1.25);

        // 反向：高 DPI 下保存（scale 2.0），在 100% 显示器上恢复 → 逻辑尺寸只有一半的物理值
        let saved_hi = geometry_on_monitor(2400, 1600, 100, 50, Some("高 DPI 屏"), 2.0, (50.0, 25.0));
        let target = remap_to_monitor(&saved_hi, &[snapshot(Some("高 DPI 屏"), 0, 0, 1.0)])
            .expect("应能重映射");
        assert_eq!(
            (target.x, target.y, target.width, target.height),
            (50.0, 25.0, 1200.0, 800.0)
        );

        // 同一块屏但周围布局变了（左侧多了副屏）：逻辑原点变负，仍按偏移落位
        let moved = remap_to_monitor(&saved, &[snapshot(Some("DELL U2720Q"), -2560, 0, 1.25)])
            .expect("应能重映射");
        assert_eq!((moved.x, moved.y), (-1748.0, 200.0));
    }

    /// 找不到同名显示器（换屏/单屏切换/枚举失败）：一律退回物理像素逻辑。
    #[test]
    fn remap_falls_back_when_monitor_not_found() {
        let monitors = [snapshot(Some("内置屏"), 0, 0, 1.5)];
        let unplugged = geometry_on_monitor(1200, 800, 100, 80, Some("已拔掉的外接屏"), 1.0, (100.0, 80.0));
        assert!(remap_to_monitor(&unplugged, &monitors).is_none());
        assert!(remap_skip_reason(&unplugged, &monitors).contains("已拔掉的外接屏"));

        // 旧文件没有指纹
        let legacy = geometry(1200, 800, 100, 80, false);
        assert!(remap_to_monitor(&legacy, &monitors).is_none());
        assert_eq!(remap_skip_reason(&legacy, &monitors), "旧文件无显示器信息");

        // 保存与当前都没有名称 / 名称为空串：都不算同名
        let nameless = geometry_on_monitor(1200, 800, 100, 80, None, 1.0, (100.0, 80.0));
        assert!(remap_to_monitor(&nameless, &[snapshot(None, 0, 0, 1.0)]).is_none());
        let empty = geometry_on_monitor(1200, 800, 100, 80, Some(""), 1.0, (100.0, 80.0));
        assert!(remap_to_monitor(&empty, &[snapshot(Some(""), 0, 0, 1.0)]).is_none());
        assert_eq!(remap_skip_reason(&nameless, &monitors), "文件未记录显示器名称");

        // 枚举显示器失败（空列表）
        assert!(remap_to_monitor(&unplugged, &[]).is_none());
    }

    /// 极端 / 非法输入：不 panic，一律退回 None。
    #[test]
    fn remap_rejects_invalid_input_without_panic() {
        let good = [snapshot(Some("屏A"), 0, 0, 2.0)];
        let ok = geometry_on_monitor(1200, 800, 0, 0, Some("屏A"), 1.0, (0.0, 0.0));
        assert!(remap_to_monitor(&ok, &good).is_some(), "正常输入应能重映射");

        // scale 非法：0（字段缺失的兜底值）/ 负数 / 无穷 / NaN / 超界
        for scale in [0.0, -1.5, f64::INFINITY, f64::NAN, MAX_SCALE_FACTOR * 2.0] {
            let saved = geometry_on_monitor(1200, 800, 0, 0, Some("屏A"), scale, (10.0, 10.0));
            assert!(remap_to_monitor(&saved, &good).is_none(), "scale={scale} 应被拒绝");
        }
        // 偏移非法：NaN / 无穷 / 超界
        for offset in [f64::NAN, f64::INFINITY, -f64::INFINITY, MAX_LOGICAL_COORD * 2.0] {
            let saved = geometry_on_monitor(1200, 800, 0, 0, Some("屏A"), 1.0, (offset, offset));
            assert!(remap_to_monitor(&saved, &good).is_none(), "offset={offset} 应被拒绝");
        }
        // 显示器逻辑原点为 NaN → 拒绝
        let nan_monitor = MonitorSnapshot {
            name: Some("屏A".to_string()),
            logical_x: f64::NAN,
            logical_y: 0.0,
            scale_factor: 1.0,
        };
        let saved = geometry_on_monitor(1200, 800, 0, 0, Some("屏A"), 1.0, (0.0, 0.0));
        assert!(remap_to_monitor(&saved, &[nan_monitor]).is_none());
        // 当前显示器 scale 非法 → 拒绝
        let bad_scale_monitor = MonitorSnapshot {
            name: Some("屏A".to_string()),
            logical_x: 0.0,
            logical_y: 0.0,
            scale_factor: 0.0,
        };
        assert!(remap_to_monitor(&saved, &[bad_scale_monitor]).is_none());

        // 换算出的逻辑尺寸超出 [MIN_LOGICAL_SIZE, MAX_LOGICAL_SIZE] → 拒绝
        let tiny = geometry_on_monitor(MIN_WINDOW_SIZE, MIN_WINDOW_SIZE, 0, 0, Some("屏A"), 9.0, (0.0, 0.0));
        assert!(remap_to_monitor(&tiny, &good).is_none(), "逻辑尺寸过小应被拒绝");
        let huge = geometry_on_monitor(u32::MAX, u32::MAX, 0, 0, Some("屏A"), 1.0, (0.0, 0.0));
        assert!(remap_to_monitor(&huge, &good).is_none(), "逻辑尺寸过大应被拒绝");
        // 极端物理坐标 + 极端偏移不能让自己溢出成 NaN/无穷
        let extreme = geometry_on_monitor(1200, 800, i32::MIN, i32::MAX, Some("屏A"), 1.0, (MAX_LOGICAL_COORD, -MAX_LOGICAL_COORD));
        let _ = remap_to_monitor(&extreme, &good);
    }

    /// 找一个可写的临时目录：优先系统临时目录，受限环境（只允许写工作区）退回 target 下。
    #[cfg(desktop)]
    #[test]
    fn copy_data_files_writes_consistent_database_and_keeps_existing_target() {
        let from = scratch_dir("dt-copy-from");
        let to = scratch_dir("dt-copy-to");
        let db = from.join(DATABASE_FILE_NAME);
        tauri::async_runtime::block_on(async {
            use sqlx::{ConnectOptions, Connection};
            let mut connection = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&db)
                .create_if_missing(true)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
                .connect()
                .await
                .unwrap();
            sqlx::query("CREATE TABLE t (v TEXT)").execute(&mut connection).await.unwrap();
            sqlx::query("INSERT INTO t VALUES ('x')").execute(&mut connection).await.unwrap();
            let _ = connection.close().await;
        });
        // 目标残留别的库的 WAL：复制前清掉
        std::fs::write(to.join(format!("{DATABASE_FILE_NAME}-wal")), b"stale").unwrap();

        let copied = copy_data_files(&from, &to);
        assert!(copied.contains(&DATABASE_FILE_NAME.to_string()));
        assert!(!to.join(format!("{DATABASE_FILE_NAME}-wal")).exists());
        assert!(database_healthy(&to.join(DATABASE_FILE_NAME)));

        // 目标已有主库：整体跳过，不覆盖
        let again = copy_data_files(&from, &to);
        assert!(!again.contains(&DATABASE_FILE_NAME.to_string()));
    }

    #[test]
    fn replace_database_keeps_original_until_snapshot_is_in_place() {
        let dir = scratch_dir("dt-replace-db");
        let db = dir.join(DATABASE_FILE_NAME);
        std::fs::write(&db, b"old").unwrap();
        std::fs::write(dir.join(format!("{DATABASE_FILE_NAME}-wal")), b"old-wal").unwrap();
        let snapshot = dir.join("snap.db");
        std::fs::write(&snapshot, b"new").unwrap();

        assert_eq!(replace_database_with(&dir, &snapshot, "s1").unwrap(), 3);
        assert_eq!(std::fs::read(&db).unwrap(), b"new");
        assert_eq!(std::fs::read(dir.join(format!("{DATABASE_FILE_NAME}.pre-restore-s1"))).unwrap(), b"old");
        assert!(!dir.join(format!("{DATABASE_FILE_NAME}-wal")).exists(), "旧 WAL 跟着原库留存，不留给新库");
        assert!(dir.join(format!("{DATABASE_FILE_NAME}.pre-restore-s1-wal")).exists());

        // 快照不存在：原库原样保留
        let missing = dir.join("missing.db");
        assert!(replace_database_with(&dir, &missing, "s2").is_err());
        assert_eq!(std::fs::read(&db).unwrap(), b"new");
        assert!(!dir.join(format!("{DATABASE_FILE_NAME}.restore-tmp")).exists());
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let candidates = [
            std::env::temp_dir().join(name),
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join(name),
        ];
        for candidate in candidates {
            let _ = std::fs::remove_dir_all(&candidate);
            if std::fs::create_dir_all(&candidate).is_ok() {
                return candidate;
            }
        }
        panic!("找不到可写的临时目录");
    }

    /// 几何存数据库 app_meta：写入后能读回，损坏与不合理值都按默认值处理。
    #[cfg(desktop)]
    #[tokio::test]
    async fn geometry_roundtrip_in_database() {
        let temp = scratch_dir(&format!("dawntick-geometry-db-test-{}", std::process::id()));
        let previous_appdata = std::env::var("APPDATA").ok();
        let previous_local = std::env::var("LOCALAPPDATA").ok();
        std::env::set_var("APPDATA", &temp);
        std::env::set_var("LOCALAPPDATA", &temp);

        // 数据库还没有 / 键还没有：按默认值处理
        assert!(read_meta_value(WINDOW_GEOMETRY_KEY).await.is_none());
        // 库还没建（前端尚未迁移）：不写，避免抢先建出 app_meta 让 001 迁移失败
        assert!(!write_meta_value(WINDOW_GEOMETRY_KEY, "{}").await);
        assert!(!database_file(&data_dir()).exists(), "不应凭空建库");

        // 模拟前端已跑过迁移的库
        {
            use sqlx::{ConnectOptions, Connection};
            let file = database_file(&data_dir());
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            let mut connection = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&file)
                .create_if_missing(true)
                .connect()
                .await
                .expect("建测试库");
            for sql in [
                "CREATE TABLE users (id TEXT PRIMARY KEY)",
                "CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            ] {
                sqlx::query(sql).execute(&mut connection).await.expect("建表");
            }
            let _ = connection.close().await;
        }

        let sample = geometry(1200, 800, 100, 80, false);
        let text = serde_json::to_string(&sample).expect("序列化几何");
        assert!(write_meta_value(WINDOW_GEOMETRY_KEY, &text).await, "写入应成功");
        let stored = read_meta_value(WINDOW_GEOMETRY_KEY).await.expect("读回几何");
        assert_eq!(parse_window_geometry(&stored), Some(sample));

        // 覆盖写：同一个键只保留最新值
        let moved = geometry(1024, 768, 40, 30, true);
        assert!(write_meta_value(WINDOW_GEOMETRY_KEY, &serde_json::to_string(&moved).unwrap()).await);
        assert_eq!(read_meta_value(WINDOW_GEOMETRY_KEY).await, Some(serde_json::to_string(&moved).unwrap()));

        // 损坏内容与不合理数值都按默认值处理
        assert!(parse_window_geometry("{不是 JSON").is_none());
        assert!(parse_window_geometry(r#"{"width":10,"height":10,"x":0,"y":0,"maximized":false}"#).is_none());
        assert!(!geometry_is_sane(&geometry(10, 10, 0, 0, false)), "不合理数值不落盘");

        // 还原环境变量并清理
        match previous_appdata {
            Some(value) => std::env::set_var("APPDATA", value),
            None => std::env::remove_var("APPDATA"),
        }
        match previous_local {
            Some(value) => std::env::set_var("LOCALAPPDATA", value),
            None => std::env::remove_var("LOCALAPPDATA"),
        }
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn position_visible_requires_overlap_margin() {
        let screens = [
            ScreenRect { x: 0, y: 0, width: 1920, height: 1080 },
            ScreenRect { x: -1920, y: 0, width: 1920, height: 1080 },
        ];

        // 完全在主屏内
        assert!(position_visible(100, 80, 1200, 800, &screens, VISIBLE_MARGIN));
        // 在左侧副屏内（负坐标）
        assert!(position_visible(-1900, 0, 1200, 800, &screens, VISIBLE_MARGIN));
        // 贴着主屏右/下边缘，可见部分 70x80 像素，超过 40px 容错边距
        assert!(position_visible(1850, 1000, 1200, 800, &screens, VISIBLE_MARGIN));
        // 只露出 20px：不足容错边距，视为不可见
        assert!(!position_visible(1900, 1000, 1200, 800, &screens, VISIBLE_MARGIN));
        assert!(!position_visible(100, 1060, 1200, 800, &screens, VISIBLE_MARGIN));
        // 显示器已被拔掉：位置停在旧坐标上
        assert!(!position_visible(5000, 5000, 1200, 800, &screens, VISIBLE_MARGIN));
        // 极端坐标不能 panic
        assert!(!position_visible(i32::MIN, i32::MIN, u32::MAX, u32::MAX, &screens, VISIBLE_MARGIN));
        // 拿不到显示器列表时不设位置
        assert!(!position_visible(100, 80, 1200, 800, &[], VISIBLE_MARGIN));
    }

    /// 快照文件名与安全校验。
    #[test]
    fn backup_names_are_stamped_and_sandboxed() {
        let name = backup_name(1_793_000_000_000);
        assert!(name.starts_with("dawn-tick-"), "{name}");
        assert!(name.ends_with(".db"), "{name}");
        let digits: String = name
            .trim_start_matches("dawn-tick-")
            .trim_end_matches(".db")
            .to_string();
        assert_eq!(digits.len(), 15, "yyyyMMdd-HHmmss：{digits}");
        assert!(digits.chars().all(|ch| ch.is_ascii_digit() || ch == '-'));

        assert_eq!(
            safe_backup_name(" dawn-tick-20261014-120000.db ").unwrap(),
            "dawn-tick-20261014-120000.db"
        );
        for bad in [
            "",
            "../dawn-tick-20261014-120000.db",
            "dawn-tick-20261014-120000.db/..",
            r"sub\dawn-tick-20261014-120000.db",
            "dawn-tick-C:20261014-120000.db",
            "other.db",
            "dawn-tick-x.txt",
        ] {
            assert!(safe_backup_name(bad).is_err(), "应拒绝：{bad}");
        }
    }

    /// 标准 Base64 解码：导出整包时按二进制写盘用。
    #[test]
    fn base64_decode_roundtrip() {
        assert_eq!(decode_base64("aGVsbG8="), Some(b"hello".to_vec()));
        assert_eq!(
            decode_base64("5Lit5paH"),
            Some("中文".as_bytes().to_vec())
        );
        assert_eq!(decode_base64(""), Some(Vec::new()));
        assert_eq!(decode_base64("aGVs bG8=\n"), Some(b"hello".to_vec()));
        assert_eq!(decode_base64("不是base64"), None);
        assert_eq!(decode_base64("aGVsbG8"), Some(b"hello".to_vec()), "缺 padding 也能解");
    }

    /// 便携版判定：必须叫 DawnTick.exe 且不在安装目录里。
    #[cfg(windows)]
    #[test]
    fn portable_layout_needs_renamed_exe_outside_install_dir() {
        let install_root = std::path::Path::new(r"C:\Users\me\AppData\Local\DawnTick");
        let installed = std::path::Path::new(r"C:\Users\me\AppData\Local\DawnTick\DawnTick.exe");
        assert!(!portable_layout(installed, Some(install_root)), "安装目录里的同名程序按安装版处理");
        assert!(
            portable_layout(std::path::Path::new(r"D:\dt\DawnTick.exe"), Some(install_root)),
            "别的目录里的便携包按便携版处理"
        );
        assert!(
            portable_layout(std::path::Path::new(r"D:\dt\DawnTick.exe"), None),
            "拿不到安装目录时按便携版处理"
        );
        assert!(
            !portable_layout(std::path::Path::new(r"E:\repo\target\debug\dawn-tick-desktop.exe"), Some(install_root)),
            "开发构建按安装版处理"
        );
        assert!(
            !portable_layout(std::path::Path::new("DawnTick.exe"), Some(install_root)),
            "没有父目录时按安装版处理"
        );
    }

    /// 自定义位置：相对路径以程序所在目录为基准，绝对路径原样使用。
    #[cfg(windows)]
    #[test]
    fn storage_path_resolves_relative_to_exe() {
        let base = exe_dir().expect("测试进程有程序目录");
        assert_eq!(resolve_storage_path("dawn-tick-data"), base.join("dawn-tick-data"));
        assert_eq!(resolve_storage_path(r"D:\dt-data"), PathBuf::from(r"D:\dt-data"));
    }

    /// 自定义位置不可用时退回默认目录并给出提示。
    #[cfg(desktop)]
    #[test]
    fn choose_data_dir_falls_back_when_custom_unusable() {
        let temp = scratch_dir(&format!("dawntick-storage-test-{}", std::process::id()));
        let default = temp.join("default");
        let usable = temp.join("custom");
        let (picked, note) = choose_data_dir(default.clone(), Some(usable.to_string_lossy().to_string()));
        assert_eq!(picked, usable);
        assert!(note.is_none(), "可用位置不应有提示");

        // 把一个文件当目录用：创建目录必然失败
        let blocked = temp.join("blocked");
        std::fs::write(&blocked, b"file").expect("写入占位文件");
        let (picked, note) = choose_data_dir(default.clone(), Some(blocked.to_string_lossy().to_string()));
        assert_eq!(picked, default, "不可用时应退回默认目录");
        assert!(note.is_some(), "不可用时应给出提示");

        let (picked, note) = choose_data_dir(default.clone(), None);
        assert_eq!(picked, default);
        assert!(note.is_none());
        let _ = std::fs::remove_dir_all(&temp);
    }

    /// 换存储位置时复制数据库与日志，目标已有的文件不覆盖。
    #[cfg(desktop)]
    #[test]
    fn copy_data_files_keeps_existing_target() {
        let temp = scratch_dir(&format!("dawntick-copy-test-{}", std::process::id()));
        let from = temp.join("from");
        let to = temp.join("to");
        std::fs::create_dir_all(&from).expect("建源目录");
        std::fs::create_dir_all(&to).expect("建目标目录");
        std::fs::write(from.join(LOG_FILE_NAME), b"log-a").expect("写日志");
        std::fs::write(from.join("startup.log"), b"boot").expect("写启动日志");
        std::fs::write(to.join(LOG_FILE_NAME), b"keep").expect("目标已有同名文件");

        let copied = copy_data_files(&from, &to);
        assert!(!copied.contains(&LOG_FILE_NAME.to_string()), "目标已有文件不覆盖");
        assert!(copied.contains(&"startup.log".to_string()));
        assert_eq!(std::fs::read(to.join(LOG_FILE_NAME)).expect("读回日志"), b"keep");
        assert!(copy_data_files(&to, &to).is_empty(), "同一个目录不复制");
        let _ = std::fs::remove_dir_all(&temp);
    }

    /// 建一个正常的 SQLite 库，供自检与恢复的测试当样本。
    #[cfg(desktop)]
    fn write_sqlite_file(path: &std::path::Path, sql: &str) {
        tauri::async_runtime::block_on(async {
            let options = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true);
            let pool = sqlx::SqlitePool::connect_with(options).await.expect("建库");
            sqlx::query(sql).execute(&pool).await.expect("执行 SQL");
            pool.close().await;
        });
    }

    /// 自检不能占着数据库文件：检查完要能立刻改名留存。
    #[cfg(desktop)]
    #[test]
    fn health_check_releases_database_file() {
        let temp = scratch_dir(&format!("dawntick-handle-test-{}", std::process::id()));
        let db = temp.join(DATABASE_FILE_NAME);
        write_sqlite_file(&db, "CREATE TABLE t (a INTEGER)");
        assert!(database_healthy(&db), "样本库应健康");
        let moved = temp.join("moved.db");
        std::fs::rename(&db, &moved).expect("自检后数据库文件应能改名");
        assert!(moved.is_file());
        let _ = std::fs::remove_dir_all(&temp);
    }

    /// 日志目标若是 SQLite 文件就放弃写入：日志文本不写进数据库。
    #[cfg(desktop)]
    #[test]
    fn log_writer_refuses_sqlite_target() {
        let temp = scratch_dir(&format!("dawntick-log-guard-test-{}", std::process::id()));
        let db = temp.join(DATABASE_FILE_NAME);
        write_sqlite_file(&db, "CREATE TABLE t (a INTEGER)");
        std::fs::copy(&db, temp.join(LOG_FILE_NAME)).expect("用 SQLite 库冒充日志文件");
        assert!(open_log_file(&temp).is_none(), "SQLite 文件不能当日志目标");

        std::fs::remove_file(temp.join(LOG_FILE_NAME)).expect("删除冒充文件");
        assert!(open_log_file(&temp).is_some(), "普通日志文件应可写");
        let _ = std::fs::remove_dir_all(&temp);
    }

    /// 自检口径：损坏文件不通过，正常库与不存在的文件通过。
    #[cfg(desktop)]
    #[test]
    fn database_health_check_classifies_files() {
        let temp = scratch_dir(&format!("dawntick-health-test-{}", std::process::id()));
        let broken = temp.join(DATABASE_FILE_NAME);
        std::fs::write(&broken, b"not a sqlite database").expect("写损坏文件");
        assert!(!database_healthy(&broken), "损坏文件应判为不健康");

        let good = temp.join("good.db");
        write_sqlite_file(&good, "CREATE TABLE t (a INTEGER)");
        assert!(database_healthy(&good), "正常库应判为健康");
        assert!(database_healthy(&temp.join("missing.db")), "没有文件按健康处理");
        assert!(!is_corrupt_message("database is locked"), "锁冲突不算损坏");
        assert!(is_corrupt_message("file is not a database"));
        assert!(is_corrupt_message("error returned from database: (code: 1) unsupported file format"));
        assert!(is_corrupt_message("error returned from database: (code: 11) database disk image is malformed"));
        let _ = std::fs::remove_dir_all(&temp);
    }

    /// 损坏时留存损坏文件，并用最新一份通过自检的快照恢复。
    #[cfg(desktop)]
    #[test]
    fn repair_database_restores_newest_healthy_snapshot() {
        let temp = scratch_dir(&format!("dawntick-repair-test-{}", std::process::id()));
        let backups = temp.join("backups");
        std::fs::create_dir_all(&backups).expect("建备份目录");
        let db = temp.join(DATABASE_FILE_NAME);
        std::fs::write(&db, b"broken").expect("写损坏库");
        std::fs::write(temp.join(format!("{DATABASE_FILE_NAME}-wal")), b"wal").expect("写 wal");

        let healthy = backups.join("dawn-tick-20260101-000000.db");
        write_sqlite_file(&healthy, "CREATE TABLE t (a INTEGER)");
        // 更新的空快照与损坏快照都不该被选中
        std::fs::write(backups.join("dawn-tick-20260102-000000.db"), b"").expect("写空快照");
        std::fs::write(backups.join("dawn-tick-20260103-000000.db"), b"broken").expect("写损坏快照");

        let notice = repair_database(&temp).expect("损坏库应给出结论");
        assert!(notice.contains("dawn-tick.db.corrupt-"), "结论要带留存名: {notice}");
        assert!(notice.contains("dawn-tick-20260101-000000.db"), "结论要带快照名: {notice}");
        assert!(database_healthy(&db), "恢复后的库应健康");
        assert_eq!(
            std::fs::read(&db).expect("读回数据库"),
            std::fs::read(&healthy).expect("读快照"),
            "恢复内容应等于快照"
        );
        let names: Vec<String> = std::fs::read_dir(&temp)
            .expect("列目录")
            .flatten()
            .map(|item| item.file_name().to_string_lossy().to_string())
            .filter(|name| name.starts_with("dawn-tick.db.corrupt-"))
            .collect();
        assert!(
            names.iter().any(|name| !name.ends_with("-wal") && !name.ends_with("-shm")),
            "损坏库本身应留存: {names:?}"
        );
        assert!(names.iter().any(|name| name.ends_with("-wal")), "附带文件应一起留存: {names:?}");
        assert!(
            !list_backup_entries_in(&backups).expect("列快照").iter().any(|entry| entry.bytes == 0),
            "空快照不进列表"
        );
        let _ = std::fs::remove_dir_all(&temp);
    }

    /// 库健康时不动任何文件。
    #[cfg(desktop)]
    #[test]
    fn repair_database_keeps_healthy_database() {
        let temp = scratch_dir(&format!("dawntick-repair-ok-test-{}", std::process::id()));
        let db = temp.join(DATABASE_FILE_NAME);
        write_sqlite_file(&db, "CREATE TABLE t (a INTEGER)");
        assert!(repair_database(&temp).is_none(), "健康库不该有结论");
        assert!(repair_database(&temp.join("missing")).is_none(), "没有库时不该有结论");
        assert_eq!(
            std::fs::read_dir(&temp).expect("列目录").flatten().count(),
            1,
            "只应有数据库本身"
        );
        let _ = std::fs::remove_dir_all(&temp);
    }

    /// 空快照会被清掉，非空快照与无关文件保留。
    #[cfg(desktop)]
    #[test]
    fn cleanup_empty_backups_only_removes_empty_snapshots() {
        let temp = scratch_dir(&format!("dawntick-empty-backup-test-{}", std::process::id()));
        std::fs::write(temp.join("dawn-tick-20260101-000000.db"), b"").expect("写空快照");
        std::fs::write(temp.join("dawn-tick-20260102-000000.db"), b"db").expect("写非空快照");
        std::fs::write(temp.join("keep.txt"), b"").expect("写无关文件");
        assert_eq!(cleanup_empty_backups_in(&temp), 1);
        assert!(!temp.join("dawn-tick-20260101-000000.db").exists(), "空快照应删除");
        assert!(temp.join("dawn-tick-20260102-000000.db").exists(), "非空快照保留");
        assert!(temp.join("keep.txt").exists(), "无关文件不动");
        assert_eq!(cleanup_empty_backups_in(&temp.join("missing")), 0, "目录不存在按 0 处理");
        let _ = std::fs::remove_dir_all(&temp);
    }
}
