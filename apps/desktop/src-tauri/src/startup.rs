//! 启动期辅助：应用目录 JSON、启动偏好、panic 记录、错误弹窗与启动自检。

use super::*;
use std::fs::create_dir_all;
#[allow(unused_imports)] // 只在部分目标平台用到
use std::fs::OpenOptions;
use std::path::PathBuf;

pub(crate) fn app_dir() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA")
        .ok()
        .map(|base| PathBuf::from(base).join("com.dawntick.app"))
}

pub(crate) fn read_json<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

pub(crate) fn write_json<T: serde::Serialize>(path: &std::path::Path, value: &T) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    if create_dir_all(parent).is_err() {
        return false;
    }
    let Ok(text) = serde_json::to_string(value) else {
        return false;
    };
    // 先写临时文件再改名：写到一半断电不会留下半截 JSON（storage.json 损坏会静默退回默认目录，看起来像数据没了）
    let staging = path.with_extension("json.tmp");
    if std::fs::write(&staging, text).is_err() {
        let _ = std::fs::remove_file(&staging);
        return false;
    }
    std::fs::rename(&staging, path).is_ok()
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct InstanceStateFile {
    pub(crate) pid: u32,
    pub(crate) version: String,
}

/// 接管请求：只认新鲜且非本进程写入的请求，避免遗留文件把后续启动顶掉。
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct QuitRequest {
    pub(crate) pid: u32,
    pub(crate) version: String,
    pub(crate) at: u64,
}

pub(crate) fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

pub(crate) const QUIT_REQUEST_MAX_AGE: u64 = 120;

#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct StartupPrefs {
    pub(crate) hidden: bool,
}

pub(crate) fn parse_version(text: &str) -> (u32, u32, u32) {
    let core = text.split(['-', '+']).next().unwrap_or(text);
    let mut parts = core.split('.').map(|part| part.parse::<u32>().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

pub(crate) fn version_is_newer(candidate: &str, current: &str) -> bool {
    parse_version(candidate) > parse_version(current)
}

pub(crate) fn read_startup_prefs() -> StartupPrefs {
    app_dir()
        .and_then(|dir| read_json::<StartupPrefs>(&dir.join("startup.json")))
        .unwrap_or(StartupPrefs { hidden: true })
}

/// 只有带 `--hidden`（开机自启）启动且偏好为隐藏时才隐藏窗口；
/// 手动双击始终显示主窗口，避免「点了没反应」。
pub(crate) fn hidden_for_launch(args: &[String], prefs: &StartupPrefs) -> bool {
    args.iter().any(|arg| arg == HIDDEN_ARG) && prefs.hidden
}

pub(crate) fn start_hidden() -> bool {
    let args: Vec<String> = std::env::args().collect();
    hidden_for_launch(&args, &read_startup_prefs())
}

/// release 版没有控制台，panic 信息必须落盘才能排查。
pub(crate) fn install_panic_logger() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let text = info.to_string();
        append_log(&format!("panic: {info}"));
        let mut message = text.clone();
        // 已实测：把便携版放在受限制的目录里运行时，WebView2 的 App Container
        // 无法使用其中的数据目录，表现为 setup 阶段「拒绝访问」。
        if text.contains("Failed to setup app") && (text.contains("拒绝访问") || text.contains("os error 5")) {
            message.push_str(
                "\n\n可能原因：程序所在目录的权限不允许 WebView2 在其中创建数据目录。\n\
                 请把 DawnTick.exe 移到你有完全控制权的普通目录（例如桌面或文档下新建的文件夹）再运行。\n\
                 确认方式：把整个文件夹复制到桌面后双击运行，若能启动即为该原因。",
            );
        }
        message.push_str(&format!("\n\n数据目录与日志：{}", data_root_hint()));
        append_log(&message);
        show_error_box("晓刻 DawnTick 启动失败", &message);
        default_hook(info);
    }));
}

/// 便于用户排查的目录提示。
pub(crate) fn data_root_hint() -> String {
    let mut parts = vec![format!("数据目录 {}", data_dir().display())];
    if let Ok(base) = std::env::var("LOCALAPPDATA") {
        parts.push(format!("日志回退目录 {base}\\com.dawntick.app"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            parts.push(format!("程序目录 {}", dir.display()));
        }
    }
    parts.join("；")
}

/// 启动失败时给出可见提示，避免进程静默退出。
#[cfg(windows)]
pub(crate) fn show_error_box(title: &str, message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() };
    let title_wide = wide(title);
    let message_wide = wide(message);
    unsafe {
        MessageBoxW(0, message_wide.as_ptr(), title_wide.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

#[cfg(not(windows))]
pub(crate) fn show_error_box(_title: &str, _message: &str) {}

/// 记录数据库路径与可写性，便于定位 readonly 类报错。只读探测，不改动数据。
#[cfg(windows)]
pub(crate) fn log_database_status() {
    let (dir, fallback) = resolve_data_dir();
    if let Some(reason) = fallback {
        append_log(&reason);
    }
    let file = database_file(&dir);
    append_log(&format!("数据目录: {}", dir.display()));
    append_log(&format!("数据库路径: {}", file.display()));
    append_log(&format!(
        "数据库文件: {}",
        match std::fs::metadata(&file) {
            Ok(meta) => format!("存在，{} 字节", meta.len()),
            Err(error) => format!("不可用({error})"),
        }
    ));

    let probe = dir.join("dawntick-write-probe.tmp");
    match create_dir_all(&dir).and_then(|()| std::fs::write(&probe, b"probe")) {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            append_log("数据库目录可写");
        }
        Err(error) => append_log(&format!("数据库目录不可写: {error}")),
    }

    match std::fs::OpenOptions::new().write(true).open(&file) {
        Ok(_) => append_log("数据库文件可写"),
        Err(error) => append_log(&format!("数据库文件不可写: {error}")),
    }

    for suffix in ["-wal", "-shm", "-journal"] {
        let side = dir.join(format!("{DATABASE_FILE_NAME}{suffix}"));
        if let Ok(meta) = std::fs::metadata(&side) {
            append_log(&format!(
                "附带文件 {DATABASE_FILE_NAME}{suffix}: {} 字节",
                meta.len()
            ));
        }
    }
}

#[cfg(not(windows))]
pub(crate) fn log_database_status() {}

/// WebView2 的用户数据目录同一时刻只能被一个进程使用，且目录若由提权进程创建，
/// 普通权限将无法写入，表现为「双击没反应」。三层兜底：可用则不动，
/// 不可用先改名让 WebView2 重建，改名也失败就改用可写目录。
#[cfg(windows)]
pub(crate) fn ensure_webview_folder_writable() {
    // WebView2 用户数据目录固定在 %LOCALAPPDATA%\com.dawntick.app\EBWebView：
    // 不占便携目录，也不受程序目录权限影响；首次运行把旧的 <数据目录>\EBWebView 搬过去，搬不动就继续用旧位置
    let base = app_dir().unwrap_or_else(data_dir);
    let legacy = data_dir().join("EBWebView");
    if !same_path(&base, &data_dir()) && legacy.is_dir() {
        let target = base.join("EBWebView");
        if !target.exists() {
            let _ = create_dir_all(&base);
            match std::fs::rename(&legacy, &target) {
                Ok(()) => append_log(&format!("WebView2 数据目录已迁到 {}", base.display())),
                Err(error) => {
                    append_log(&format!("WebView2 数据目录迁移失败（{error}），继续用旧位置"));
                    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", data_dir());
                    return;
                }
            }
        } else if std::fs::remove_dir_all(&legacy).is_ok() {
            // 新位置已经有 WebView2 数据了：数据目录里这份是迁移后的残留，清掉
            append_log("已清理数据目录里残留的 EBWebView");
        }
    }
    let locked = base;
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &locked);
    match probe_folder(&locked) {
        Ok(()) => append_log(&format!("WebView2 数据目录已锁定: {}", locked.display())),
        Err(error) => {
            note_access_denied(&format!("锁定目录 {}", locked.display()), &error);
            append_log(&format!("WebView2 数据目录不可写: {error}"));
        }
    }
    return;
}

/// 真实验证一个目录能否作为 WebView2 数据目录：建目录、建 EBWebView 子目录、写并删除探针文件。
pub(crate) fn probe_folder(folder: &std::path::Path) -> Result<(), String> {
    create_dir_all(folder).map_err(|error| format!("创建失败({error})"))?;
    let inner = folder.join("EBWebView");
    create_dir_all(&inner).map_err(|error| format!("创建 EBWebView 失败({error})"))?;
    let probe = inner.join("dawntick-probe.tmp");
    std::fs::write(&probe, b"probe").map_err(|error| format!("写入失败({error})"))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// 列出正在使用或残留占用 WebView2 目录的进程。保留供排查使用，暂未接入命令。
#[cfg(windows)]
#[allow(dead_code)]
pub(crate) fn describe_holders() -> String {
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
pub(crate) struct ProcessInfo {
    pub(crate) pid: u32,
    pub(crate) parent: u32,
    pub(crate) name: String,
}

#[cfg(windows)]
pub(crate) fn is_our_app(name: &str) -> bool {
    name.eq_ignore_ascii_case("DawnTick.exe") || name.eq_ignore_ascii_case("dawn-tick-desktop.exe")
}

#[cfg(windows)]
pub(crate) fn list_processes() -> Vec<ProcessInfo> {
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
#[allow(dead_code)]
pub(crate) fn is_writable(dir: &std::path::Path) -> bool {
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
