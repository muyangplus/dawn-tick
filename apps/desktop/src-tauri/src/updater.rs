//! 启动安装包（自动更新 I-03 的最后一步）。
//!
//! 安全边界：只允许运行 `stage_update` 写进更新暂存目录、且 SHA-256 与期望一致的 `.exe` / `.msi`，
//! 防止任意可执行文件被前端一句话拉起。启动用系统默认「打开」动词，
//! 由安装程序自己弹出界面（不传 `/S`、`/quiet` 之类的静默参数）。

use std::path::Path;

/// 允许启动的安装包扩展名（大小写不敏感）。
const INSTALLER_EXTENSIONS: [&str; 2] = ["exe", "msi"];

/// 启动安装包：不等待进程结束，也不静默安装。
#[cfg(windows)]
fn launch(target: &Path) -> Result<(), String> {
    // 用系统「打开」动词：.exe 直接运行，.msi 交给 msiexec 并显示安装界面
    crate::shell_open(&target.to_string_lossy(), crate::copy::shell::START_INSTALLER)
}

/// 非 Windows 平台的兜底：直接执行（本仓库实际发布只有 Windows 安装包）。
#[cfg(not(windows))]
fn launch(target: &Path) -> Result<(), String> {
    std::process::Command::new(target)
        .spawn()
        .map(|_| ())
        .map_err(crate::copy::update::installer_failed)
}

/// 运行已暂存的安装包（自动更新的最后一步）。
///
/// 只接受 `stage_update` 写进更新暂存目录的文件，启动前按期望 SHA-256 再核对一次：
/// 下载校验之后、启动之前文件被替换也会被拦下。返回实际启动的路径。
#[tauri::command]
pub fn run_installer(name: String, sha256: String) -> Result<String, String> {
    let target = crate::fs_commands::resolve_staged(&crate::fs_commands::updates_dir(), &name, &sha256, &INSTALLER_EXTENSIONS)?;
    let shown = target.to_string_lossy().to_string();
    launch(&target)?;
    crate::log_info("update", format!("安装程序已启动 path={shown}"));
    Ok(shown)
}
