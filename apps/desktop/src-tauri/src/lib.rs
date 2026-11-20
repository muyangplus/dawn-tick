
mod copy;
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
    log_info("app", format!("应用启动 version={APP_VERSION}"));

    // 先判单实例：拿不到数据目录锁就绝不打开数据库（唤回旧窗口或提示关闭）
    #[cfg(windows)]
    let _instance_lock = match decide_instance() {
        InstanceRole::Owner(lock) => {
            write_instance_state();
            lock
        }
        InstanceRole::NeedsElevation(reason) => {
            log_warn("permission", format!("需要管理员权限，暂不打开数据库 reason={reason}"));
            match request_elevation_restart() {
                Ok(()) => {
                    log_info("permission", "管理员实例已启动，等待其接管实例锁");
                    // 旧实例不写库，只等提权实例拿到锁之前保持进程存活，随后退出让出锁
                    std::thread::spawn(|| {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                        std::process::exit(0);
                    });
                    return;
                }
                Err(error) => {
                    let message = copy::startup::elevation_failed(&reason, &error);
                    log_error("permission", format!("申请管理员权限失败，启动停止 reason={reason} error={error}"));
                    show_error_box(copy::startup::CANNOT_START_TITLE, &message);
                    return;
                }
            }
        }
        InstanceRole::FocusExisting => {
            let focused = focus_main_window();
            if !focused {
                log_warn("app", "已有实例在运行，唤回窗口失败");
                show_error_box(copy::startup::ALREADY_RUNNING_TITLE, copy::startup::ALREADY_RUNNING);
            }
            log_info("app", "本次启动退出，交给已有实例");
            return;
        }
        InstanceRole::Blocked(reason) => {
            log_error("app", format!("启动停止，未打开数据库 reason={reason}"));
            show_error_box(copy::startup::CANNOT_START_TITLE, &reason);
            return;
        }
    };

    #[cfg(not(windows))]
    let _instance_lock = match instance_lock::acquire(&data_dir()) {
        instance_lock::Gate::Owner(lock) => lock,
        instance_lock::Gate::Busy { lock, reason } => {
            log_info("app", format!("已有实例占用数据目录，本次启动退出 lock={} reason={reason}", lock.display()));
            return;
        }
        instance_lock::Gate::Unavailable { lock, reason } => {
            log_error("app", format!("实例锁建立失败，启动停止 lock={} reason={reason}", lock.display()));
            return;
        }
    };

    // 先套用排队的恢复请求：必须在打开数据库之前完成
    apply_pending_restore();

    // 打开数据库之前的自检：先清掉空快照，再处理损坏的数据库
    let empty = cleanup_empty_backups_in(&backups_dir());
    if empty > 0 {
        log_warn("backup", format!("已清理空快照 count={empty}"));
    }
    if let Some(notice) = repair_database(&data_dir()) {
        set_recovery_notice(notice);
    }

    // 旧的 window.json 不再使用（窗口几何改存数据库），顺手清掉
    let legacy_geometry = data_dir().join("window.json");
    if legacy_geometry.is_file() && std::fs::remove_file(&legacy_geometry).is_ok() {
        log_debug("app", "已删除旧版 window.json");
    }

    #[cfg(windows)]
    ensure_webview_folder_writable();

    #[cfg(windows)]
    log_database_status();

    // 提权实例拿到锁之后，还要等旧实例把数据库文件句柄放掉；等不到就给可读错误，不硬开库
    #[cfg(windows)]
    if launch_has_elevate_marker() && !database_writable() {
        log_info("storage", "等待数据库文件可写");
        if !instance_lock::wait_until(std::time::Duration::from_secs(10), database_writable) {
            log_error("storage", "数据库文件等待超时仍不可写，启动停止");
            show_error_box(copy::startup::DATABASE_LOCKED_TITLE, copy::startup::DATABASE_NOT_WRITABLE);
            return;
        }
        log_info("storage", "数据库文件已可写");
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
                        log_info("app", "主窗口按设置隐藏，仅驻留托盘");
                    } else if let Err(error) = window.show() {
                        log_error("app", format!("主窗口显示失败 error={error}"));
                    }
                }
                None => log_error("app", "主窗口不存在"),
            }

            // 托盘失败不阻止应用启动，仅记录
            if let Err(error) = setup_tray(app.handle()) {
                log_warn("app", format!("托盘初始化失败，继续启动 error={error}"));
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
        let message = copy::startup::run_failed(&error);
        log_error("app", format!("Tauri 运行失败 error={error}"));
        eprintln!("{message}");
        show_error_box(copy::startup::START_FAILED_TITLE, &message);
    }
}

#[cfg(test)]
mod tests;
