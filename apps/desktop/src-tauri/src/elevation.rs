//! 管理员权限：检测、提权重启与拒绝访问时的处理。

#[allow(unused_imports)] // 只在部分目标平台用到
use super::*;
#[allow(unused_imports)] // 只在部分目标平台用到
use std::fs::create_dir_all;

#[cfg(windows)]
pub(crate) const ELEVATE_MARKER: &str = "--elevated-attempt";
#[cfg(windows)]

/// 是否已具备管理员权限：用机器级 Run 键的写权限做探测。
#[cfg(windows)]
pub(crate) fn is_elevated() -> bool {
    use windows_sys::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, HKEY_LOCAL_MACHINE, KEY_SET_VALUE};
    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    let path: Vec<u16> = RUN_KEY.encode_utf16().chain(std::iter::once(0)).collect();
    let mut handle: isize = 0;
    let status = unsafe { RegOpenKeyExW(HKEY_LOCAL_MACHINE, path.as_ptr(), 0, KEY_SET_VALUE, &mut handle) };
    if status == 0 {
        unsafe { RegCloseKey(handle) };
        true
    } else {
        false
    }
}

/// 用户主动请求提权：以管理员身份重新启动自己（弹 UAC）。
#[cfg(windows)]
pub(crate) fn request_elevation_restart() -> Result<(), String> {
    if is_elevated() {
        return Err(copy::elevation::ALREADY_ELEVATED.to_string());
    }

    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe = std::env::current_exe().map_err(copy::common::program_path_failed)?;
    let mut params: Vec<String> = std::env::args().skip(1).filter(|arg| arg != ELEVATE_MARKER).collect();
    params.push(ELEVATE_MARKER.to_string());
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() };
    let verb = wide("runas");
    let file = wide(&exe.to_string_lossy());
    let args = wide(&params.join(" "));
    let result = unsafe {
        ShellExecuteW(
            0,
            verb.as_ptr(),
            file.as_ptr(),
            args.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result as isize) <= 32 {
        return Err(copy::elevation::request_failed(result as isize));
    }
    log_info("permission", "管理员实例已启动");
    Ok(())
}

/// 由界面调用：申请管理员权限并以管理员身份重新启动。
#[tauri::command]
pub async fn relaunch_elevated() -> Result<(), String> {
    #[cfg(windows)]
    {
        request_elevation_restart()?;
        // 管理员实例接管单实例后本实例退出
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(800));
            std::process::exit(0);
        });
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(copy::common::UNSUPPORTED_PLATFORM.to_string())
    }
}

#[derive(serde::Serialize)]
pub(crate) struct ElevationStatus {
    pub(crate) elevated: bool,
}

/// 当前是否具备管理员权限，供界面显示。
#[tauri::command]
pub fn elevation_status() -> ElevationStatus {
    #[cfg(windows)]
    {
        ElevationStatus { elevated: is_elevated() }
    }
    #[cfg(not(windows))]
    {
        ElevationStatus { elevated: false }
    }
}

/// 数据库是否可写：目录建写探针 + 数据库文件开写句柄（文件不存在时以目录可写为准）。
#[cfg(windows)]
pub(crate) fn database_writable() -> bool {
    let dir = data_dir();
    if create_dir_all(&dir).is_err() {
        return false;
    }
    let probe = dir.join("dawntick-write-probe.tmp");
    if std::fs::write(&probe, b"probe").is_err() {
        return false;
    }
    let _ = std::fs::remove_file(&probe);
    let file = database_file(&dir);
    if !file.exists() {
        return true;
    }
    std::fs::OpenOptions::new().write(true).open(&file).is_ok()
}

#[cfg(not(windows))]
pub(crate) fn database_writable() -> bool {
    true
}

/// 启动期是否出现过「拒绝访问」，用于决定是否自动提权。
#[cfg(windows)]
pub(crate) static ACCESS_DENIED_SEEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
pub(crate) fn note_access_denied(context: &str, detail: &str) {
    if looks_like_access_denied(detail) {
        ACCESS_DENIED_SEEN.store(true, std::sync::atomic::Ordering::SeqCst);
        log_warn("permission", format!("访问被拒绝，稍后按需提权 context={context}"));
    }
}

/// 遇到拒绝访问时自动申请管理员权限并重启；返回 true 表示调用方应立即退出。
/// 已提权或本次启动已尝试过提权时不再循环。
#[cfg(windows)]
pub(crate) fn elevate_on_access_denied(reason: &str) -> bool {
    if is_elevated() {
        log_error("permission", format!("已是管理员权限仍被拒绝访问 reason={reason}"));
        return false;
    }
    if std::env::args().any(|arg| arg == ELEVATE_MARKER) {
        log_error("permission", format!("提权后仍被拒绝访问，继续运行 reason={reason}"));
        return false;
    }
    match request_elevation_restart() {
        Ok(()) => {
            log_info("permission", format!("已申请管理员权限，等待提权实例接管 reason={reason}"));
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_millis(800));
                std::process::exit(0);
            });
            true
        }
        Err(error) => {
            log_warn("permission", format!("申请管理员权限失败，以普通权限继续运行 reason={reason} error={error}"));
            false
        }
    }
}
