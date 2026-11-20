//! 单实例：再次启动时的接管、交接与唤起主窗口。

#[allow(unused_imports)] // 只在部分目标平台用到
use super::*;
#[allow(unused_imports)] // 只在部分目标平台用到
use std::path::PathBuf;

/// 再次启动时的处置方式。
#[cfg(windows)]
pub(crate) enum InstanceRole {
    /// 本进程持有数据目录实例锁：可以打开数据库
    Owner(instance_lock::InstanceLock),
    /// 已有同版本或更新版本实例：唤回窗口后退出，不打开数据库
    FocusExisting,
    /// 数据目录被拒绝访问：先申请管理员权限，提权实例拿到锁后才打开数据库
    NeedsElevation(String),
    /// 没有可用锁且不能提权：只提示并退出，绝不打开数据库
    Blocked(String),
}

/// 提权交接：等旧实例退出并释放实例锁的上限。
#[cfg(windows)]
pub(crate) const INSTANCE_HANDOFF_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// 版本接管：请求老版本退出后，等它释放实例锁的上限。
#[cfg(windows)]
pub(crate) const INSTANCE_TAKEOVER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

#[cfg(windows)]
pub(crate) fn instance_state_path() -> Option<PathBuf> {
    app_dir().map(|dir| dir.join("instance.json"))
}

#[cfg(windows)]
pub(crate) fn quit_request_path() -> Option<PathBuf> {
    app_dir().map(|dir| dir.join("instance-quit.json"))
}

#[cfg(windows)]
pub(crate) fn process_alive(pid: u32) -> bool {
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
pub(crate) fn focus_main_window() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    let title: Vec<u16> = "晓刻 DawnTick".encode_utf16().chain(std::iter::once(0)).collect();
    let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
    if hwnd == 0 {
        log_warn("app", "已有实例的主窗口不存在，无法唤回");
        return false;
    }
    unsafe {
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
    }
    true
}

/// 本进程是否就是「提权后重新启动」的实例。
#[cfg(windows)]
pub(crate) fn launch_has_elevate_marker() -> bool {
    std::env::args().any(|arg| arg == ELEVATE_MARKER)
}

/// 数据目录/锁文件相关的「拒绝访问」判定；提权与锁失败共用一套字样。
#[cfg(windows)]
pub(crate) fn looks_like_access_denied(text: &str) -> bool {
    text.contains("拒绝访问") || text.contains("os error 5")
}

/// 用数据目录下的 `instance.lock` 判断本进程能否成为唯一写入者。
///
/// 关键约束：**拿不到锁就绝不打开数据库**。已有实例时只唤回窗口或提示关闭；
/// 提权实例则轮询等旧实例把锁交出来，等不到就给可读错误并退出。
#[cfg(windows)]
pub(crate) fn decide_instance() -> InstanceRole {
    let dir = data_dir();
    let elevated = launch_has_elevate_marker();
    match instance_lock::acquire(&dir) {
        instance_lock::Gate::Owner(lock) => {
            log_info("app", format!("已取得实例锁 lock={}", lock.path().display()));
            InstanceRole::Owner(lock)
        }
        instance_lock::Gate::Unavailable { lock, reason } => {
            log_error("app", format!("实例锁创建失败 lock={} reason={reason}", lock.display()));
            if looks_like_access_denied(&reason) {
                ACCESS_DENIED_SEEN.store(true, std::sync::atomic::Ordering::SeqCst);
                if !elevated {
                    return InstanceRole::NeedsElevation(format!(
                        "数据目录不可写，无法建立实例锁（{reason}）"
                    ));
                }
            }
            InstanceRole::Blocked(format!(
                "无法在数据目录建立实例锁：{reason}\n\n\
                 为避免两个实例同时写坏数据库，本次启动已停止，不会打开数据库。\n\
                 请把程序移到可写目录，或以管理员身份运行后重试。\n\n\
                 锁文件：{}",
                lock.display()
            ))
        }
        instance_lock::Gate::Busy { lock, reason } => {
            log_info("app", format!("实例锁被占用 lock={} reason={reason}", lock.display()));
            if elevated {
                log_info("app", "提权实例等待旧实例释放实例锁");
                return match instance_lock::acquire_waiting(&dir, INSTANCE_HANDOFF_TIMEOUT) {
                    instance_lock::Gate::Owner(lock) => {
                        log_info("app", "提权实例已取得实例锁");
                        InstanceRole::Owner(lock)
                    }
                    instance_lock::Gate::Busy { .. } => InstanceRole::Blocked(format!(
                        "等待旧实例退出超时（{} 秒），本次未打开数据库。\n\
                         请关闭所有晓刻窗口（可在任务管理器结束 DawnTick.exe）后重试。\n\n\
                         锁文件：{}",
                        INSTANCE_HANDOFF_TIMEOUT.as_secs(),
                        lock.display()
                    )),
                    instance_lock::Gate::Unavailable { reason, .. } => InstanceRole::Blocked(format!(
                        "等待旧实例退出后仍无法建立实例锁（{reason}），本次未打开数据库。"
                    )),
                };
            }

            let running: Option<InstanceStateFile> = instance_state_path().and_then(|path| read_json(&path));
            let Some(state) = running else {
                log_warn("app", "实例状态文件缺失，按同版本处理");
                return InstanceRole::FocusExisting;
            };
            if !process_alive(state.pid) {
                log_warn("app", format!("记录的实例进程已退出，尝试接管实例锁 pid={}", state.pid));
                return match instance_lock::acquire_waiting(&dir, std::time::Duration::from_secs(2)) {
                    instance_lock::Gate::Owner(lock) => {
                        log_info("app", "已接管实例锁");
                        InstanceRole::Owner(lock)
                    }
                    instance_lock::Gate::Busy { .. } => {
                        log_warn("app", "实例锁仍被占用，按已有实例处理");
                        InstanceRole::FocusExisting
                    }
                    instance_lock::Gate::Unavailable { reason, .. } => {
                        InstanceRole::Blocked(format!("接管实例锁失败（{reason}），本次未打开数据库。"))
                    }
                };
            }
            if !version_is_newer(APP_VERSION, &state.version) {
                log_info(
                    "app",
                    format!("唤回已有实例 running={} self={APP_VERSION}", state.version),
                );
                return InstanceRole::FocusExisting;
            }

            log_info(
                "app",
                format!("请求旧版本实例退出 running={} self={APP_VERSION}", state.version),
            );
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
            match instance_lock::acquire_waiting(&dir, INSTANCE_TAKEOVER_TIMEOUT) {
                instance_lock::Gate::Owner(lock) => {
                    log_info("app", "旧版本已释放实例锁，本次接管");
                    InstanceRole::Owner(lock)
                }
                instance_lock::Gate::Busy { .. } => {
                    log_warn("app", format!("旧版本未按时释放实例锁，改为唤回已有窗口 timeout_s={}", INSTANCE_TAKEOVER_TIMEOUT.as_secs()));
                    InstanceRole::FocusExisting
                }
                instance_lock::Gate::Unavailable { reason, .. } => {
                    InstanceRole::Blocked(format!("接管实例锁失败（{reason}），本次未打开数据库。"))
                }
            }
        }
    }
}

#[cfg(windows)]
pub(crate) fn write_instance_state() {
    if let Some(path) = instance_state_path() {
        write_json(&path, &InstanceStateFile { pid: std::process::id(), version: APP_VERSION.to_string() });
    }
}

/// 监听新版本的接管请求，收到后退出本实例。
#[cfg(windows)]
pub(crate) fn spawn_takeover_watcher(app: tauri::AppHandle) {
    // 启动时清掉上一次运行遗留的请求：那是发给上一个实例的
    if let Some(path) = quit_request_path() {
        if std::fs::remove_file(&path).is_ok() {
            log_debug("app", "已删除遗留的接管请求文件");
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
            log_debug("app", "接管请求已过期，忽略");
            continue;
        }
        if version_is_newer(&request.version, APP_VERSION) {
            log_info("app", format!("新版本请求接管，退出当前实例 version={}", request.version));
            app.exit(0);
            return;
        }
    });
}
