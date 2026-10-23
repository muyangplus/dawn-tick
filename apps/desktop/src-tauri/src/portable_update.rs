//! 便携版自动更新：解压 zip 到数据目录、生成「退出后覆盖 exe 并重启」的脚本。
//!
//! 便携版没有安装程序，只能由外部进程替换正在运行的 exe。流程：
//! 1. 前端下载 zip 并通过 SHA-256 校验后调用 `prepare_portable_update`；
//! 2. 这里校验 zip 必须含 `DawnTick.exe`、拒绝路径穿越，解压到 `<数据目录>/update-staging/`；
//! 3. 在 `%TEMP%` 生成批处理脚本：循环等旧进程释放 exe → `copy /y` 覆盖 → `start` 新 exe
//!    → 删除脚本与暂存目录；脚本以无窗口的独立进程启动；
//! 4. 前端随后调用 `exit_for_update` 退出应用（不能先重启旧进程，否则旧二进制会重新占用文件）。
//!
//! 安全边界：zip 只允许来自临时目录或数据目录（与 `updater::run_installer` 同一白名单思路），
//! 包内只取 `DawnTick.exe` 覆盖当前程序，不执行包内其它文件。

use std::fs::File;
use std::path::{Component, Path, PathBuf};

use crate::paths;

/// 便携包里的程序名：发布流程把可执行文件重命名为它再打包。
pub const PORTABLE_EXE_NAME: &str = "DawnTick.exe";
/// 解压目录名：数据目录下的子目录，每次更新清空重建。
const STAGING_DIR_NAME: &str = "update-staging";
/// 等旧进程释放 exe 的最长轮次（每轮约 1 秒）：自动退出失败时给用户留手动退出的时间。
const WAIT_ROUNDS: u32 = 300;

/// 校验 zip 路径：存在、是普通文件、扩展名 `.zip`，且 `canonicalize` 后落在允许目录内。
pub fn resolve_portable_zip(text: &str, allowed_dirs: &[PathBuf]) -> Result<PathBuf, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("没有提供便携包路径".to_string());
    }
    let path = PathBuf::from(text);
    let canonical = std::fs::canonicalize(&path).map_err(|_| format!("便携包不存在: {text}"))?;
    if !canonical.is_file() {
        return Err(format!("不是便携包文件: {text}"));
    }
    let is_zip = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("zip"))
        .unwrap_or(false);
    if !is_zip {
        return Err("只允许解压 .zip 便携包".to_string());
    }
    let allowed = allowed_dirs.iter().any(|dir| match std::fs::canonicalize(dir) {
        Ok(dir) => paths::path_inside(&canonical, &dir),
        Err(_) => false,
    });
    if !allowed {
        return Err("便携包必须位于临时目录或数据目录内".to_string());
    }
    Ok(canonical)
}

/// zip 条目名 → 安全相对路径：拒绝绝对路径、盘符、`..` 与空名。
pub fn entry_relative_path(name: &str) -> Result<PathBuf, String> {
    let text = name.trim();
    if text.is_empty() {
        return Err("便携包里有空文件名".to_string());
    }
    // 统一分隔符后再拆组件：Windows 上 `/` 与 `\` 混用也必须全部识别
    let normalized = text.replace('\\', "/");
    let bytes = normalized.as_bytes();
    if normalized.starts_with('/')
        || (bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic())
    {
        return Err(format!("便携包含有非法路径: {name}"));
    }
    let mut safe = PathBuf::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("便携包含有非法路径: {name}"));
            }
        }
    }
    if safe.as_os_str().is_empty() {
        return Err(format!("便携包含有非法路径: {name}"));
    }
    Ok(safe)
}

/// 解压便携包到 `staging`（先清空重建），返回解出来的 `DawnTick.exe` 路径。
///
/// 先整体校验条目再落盘：缺 exe 或存在穿越条目时不在磁盘上留下半成品。
pub fn extract_portable_zip(zip_path: &Path, staging: &Path) -> Result<PathBuf, String> {
    if staging.exists() {
        std::fs::remove_dir_all(staging).map_err(|error| format!("清空更新暂存目录失败: {error}"))?;
    }
    std::fs::create_dir_all(staging).map_err(|error| format!("创建更新暂存目录失败: {error}"))?;

    let file = File::open(zip_path).map_err(|error| format!("打开便携包失败: {error}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("便携包不是有效的 zip: {error}"))?;

    let mut planned: Vec<(usize, PathBuf, bool)> = Vec::new();
    let mut exe_entry: Option<PathBuf> = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("读取便携包条目失败: {error}"))?;
        let relative = entry_relative_path(entry.name())?;
        let is_dir = entry.is_dir();
        if !is_dir {
            let named_exe = relative
                .file_name()
                .map(|name| name.to_string_lossy().eq_ignore_ascii_case(PORTABLE_EXE_NAME))
                .unwrap_or(false);
            if named_exe {
                exe_entry = Some(relative.clone());
            }
        }
        planned.push((index, relative, is_dir));
    }
    let exe_entry = exe_entry.ok_or_else(|| format!("便携包里缺少 {PORTABLE_EXE_NAME}"))?;

    for (index, relative, is_dir) in planned {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("读取便携包条目失败: {error}"))?;
        let target = staging.join(&relative);
        if is_dir {
            std::fs::create_dir_all(&target).map_err(|error| format!("创建目录失败: {error}"))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| format!("创建目录失败: {error}"))?;
        }
        let mut output = File::create(&target).map_err(|error| format!("写入暂存文件失败: {error}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("解压暂存文件失败: {error}"))?;
    }

    let exe = staging.join(&exe_entry);
    if !exe.is_file() {
        return Err(format!("便携包解压后找不到 {PORTABLE_EXE_NAME}"));
    }
    Ok(exe)
}

/// 批处理里的路径字面量：`%` 会被当变量展开，双写成 `%%`。
fn batch_literal(path: &Path) -> String {
    path.to_string_lossy().replace('%', "%%")
}

/// 生成替换脚本：等旧进程退出 → 覆盖当前 exe → 启动新 exe → 清理脚本与暂存目录。
///
/// 失败分支不启动旧版本，保留暂存目录与脚本，用户下次更新会清空重建。
pub fn update_script(exe: &Path, staged_exe: &Path, staging: &Path) -> String {
    let src = batch_literal(staged_exe);
    let dst = batch_literal(exe);
    let staging = batch_literal(staging);
    format!(
        "@echo off\r\n\
setlocal\r\n\
set \"SRC={src}\"\r\n\
set \"DST={dst}\"\r\n\
rem 旧进程退出前 exe 被占用，copy /y 会失败；每秒重试，最多约 {WAIT_ROUNDS} 秒\r\n\
for /l %%i in (1,1,{WAIT_ROUNDS}) do (\r\n\
  copy /y \"%SRC%\" \"%DST%\" >nul 2>nul\r\n\
  if not errorlevel 1 goto replaced\r\n\
  ping -n 2 127.0.0.1 >nul\r\n\
)\r\n\
goto failed\r\n\
:replaced\r\n\
start \"\" \"%DST%\"\r\n\
goto cleanup\r\n\
:failed\r\n\
rem 替换失败：保留暂存目录与脚本，下次更新会清空重建\r\n\
exit /b 1\r\n\
:cleanup\r\n\
rmdir /s /q \"{staging}\" >nul 2>nul\r\n\
(goto) 2>nul & del \"%~f0\"\r\n"
    )
}

/// 脚本名里的随机段：进程号 + 纳秒时间戳，避免与上一次残留的脚本重名。
fn random_suffix() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    format!("{:x}{:x}", std::process::id(), nanos)
}

/// 暂存目录：数据目录下的 `update-staging`。
pub fn staging_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(STAGING_DIR_NAME)
}

/// 以独立、无窗口的进程启动脚本：本进程退出不会带走它。
#[cfg(windows)]
fn launch_script(script: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    /// `CREATE_NO_WINDOW`：不弹控制台窗口。
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("cmd.exe")
        .arg("/C")
        .arg(script)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动更新脚本失败: {error}"))
}

#[cfg(not(windows))]
fn launch_script(_script: &Path) -> Result<(), String> {
    Err("当前平台不支持便携版自动替换，请到发布页手动下载".to_string())
}

/// 准备便携版更新：校验 zip 来源 → 解压到暂存目录 → 生成并启动替换脚本。
///
/// 返回脚本路径，前端据此提示「应用将退出并自动替换」。此时**不要**重启旧进程：
/// 旧二进制会重新占用 exe，脚本永远覆盖不了。
#[tauri::command]
pub fn prepare_portable_update(zip_path: String) -> Result<String, String> {
    let allowed = vec![crate::data_dir(), std::env::temp_dir()];
    let zip_path = resolve_portable_zip(&zip_path, &allowed)?;
    let exe = std::env::current_exe().map_err(|error| format!("拿不到当前程序路径: {error}"))?;
    let staging = staging_dir(&crate::data_dir());
    let staged_exe = extract_portable_zip(&zip_path, &staging)?;
    let script = std::env::temp_dir().join(format!("dawn-tick-update-{}.cmd", random_suffix()));
    std::fs::write(&script, update_script(&exe, &staged_exe, &staging))
        .map_err(|error| format!("写入更新脚本失败: {error}"))?;
    launch_script(&script)?;
    crate::append_log(&format!(
        "便携版更新已准备: 脚本 {}，暂存 {}，新程序 {}",
        script.to_string_lossy(),
        staging.to_string_lossy(),
        staged_exe.to_string_lossy()
    ));
    Ok(script.to_string_lossy().to_string())
}

/// 退出应用让替换脚本接手：脚本已经在等 exe 释放，这里只负责尽快退出。
#[tauri::command]
pub fn exit_for_update(app: tauri::AppHandle) -> Result<(), String> {
    crate::append_log("退出应用以完成便携版更新");
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn scratch_dir(name: &str) -> PathBuf {
        // 不用系统临时目录：CI/沙箱对 %TEMP% 的写权限不稳定，测试目录放在 target 下
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-tmp")
            .join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("应能建测试目录");
        dir
    }

    /// 用真实 zip 写包：测试只依赖 zip 读写，不碰发布流程。
    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) -> PathBuf {
        let file = File::create(path).expect("应能建 zip");
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in entries {
            writer.start_file(*name, options).expect("应能写入 zip 条目");
            writer.write_all(bytes).expect("应能写 zip 内容");
        }
        writer.finish().expect("应能结束 zip");
        path.to_path_buf()
    }

    #[test]
    fn extracts_package_with_portable_exe() {
        let dir = scratch_dir("portable-extract");
        let zip = write_zip(
            &dir.join("DawnTick-update.zip"),
            &[
                ("DawnTick.exe", b"MZ-new-binary"),
                ("README-portable.txt", b"portable"),
            ],
        );
        let staging = dir.join("update-staging");
        let exe = extract_portable_zip(&zip, &staging).expect("应能解压");
        assert_eq!(exe, staging.join(PORTABLE_EXE_NAME));
        assert_eq!(std::fs::read(&exe).expect("应能读 exe"), b"MZ-new-binary");
        assert!(staging.join("README-portable.txt").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extraction_rebuilds_stale_staging_dir() {
        let dir = scratch_dir("portable-clean-staging");
        let stale = dir.join("update-staging").join("old.txt");
        std::fs::create_dir_all(stale.parent().expect("应有父目录")).expect("应能建目录");
        std::fs::write(&stale, b"stale").expect("应能写文件");
        let zip = write_zip(&dir.join("update.zip"), &[("DawnTick.exe", b"MZ")]);
        let staging = dir.join("update-staging");
        extract_portable_zip(&zip, &staging).expect("应能解压");
        assert!(!staging.join("old.txt").exists(), "旧暂存内容应被清空");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extraction_rejects_package_without_exe() {
        let dir = scratch_dir("portable-no-exe");
        let zip = write_zip(
            &dir.join("update.zip"),
            &[("README-portable.txt", b"portable")],
        );
        let error = extract_portable_zip(&zip, &dir.join("staging")).expect_err("缺 exe 应拒绝");
        assert!(error.contains(PORTABLE_EXE_NAME), "{error}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extraction_rejects_path_traversal_entries() {
        let dir = scratch_dir("portable-traversal");
        let zip = write_zip(
            &dir.join("update.zip"),
            &[
                ("DawnTick.exe", b"MZ"),
                ("../evil.txt", b"pwned"),
            ],
        );
        let staging = dir.join("staging");
        let error = extract_portable_zip(&zip, &staging).expect_err("穿越条目应拒绝");
        assert!(error.contains("非法路径"), "{error}");
        assert!(
            !dir.join("evil.txt").exists(),
            "穿越目标不能写到暂存目录之外"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn entry_names_are_validated() {
        assert_eq!(
            entry_relative_path("DawnTick.exe").expect("普通文件名应允许"),
            PathBuf::from("DawnTick.exe")
        );
        assert_eq!(
            entry_relative_path("sub/README-portable.txt").expect("子目录应允许"),
            PathBuf::from("sub").join("README-portable.txt")
        );
        for name in [
            "",
            "   ",
            "../evil.txt",
            "sub/../../evil.txt",
            "/etc/passwd",
            r"C:\Windows\evil.txt",
            "..\\evil.txt",
        ] {
            assert!(
                entry_relative_path(name).is_err(),
                "{name:?} 应被拒绝"
            );
        }
    }

    #[test]
    fn zip_outside_allowed_dirs_is_rejected() {
        let allowed = scratch_dir("portable-zip-allowed");
        let outside = scratch_dir("portable-zip-outside");
        let zip = write_zip(&outside.join("update.zip"), &[("DawnTick.exe", b"MZ")]);
        let error = resolve_portable_zip(&zip.to_string_lossy(), &[allowed.clone()])
            .expect_err("目录外应拒绝");
        assert!(error.contains("临时目录或数据目录"), "{error}");

        // 扩展名不是 zip 的一律拒绝
        let not_zip = allowed.join("update.exe");
        std::fs::write(&not_zip, b"MZ").expect("应能写文件");
        let error = resolve_portable_zip(&not_zip.to_string_lossy(), &[allowed.clone()])
            .expect_err("非 zip 应拒绝");
        assert!(error.contains(".zip"), "{error}");

        let inside = write_zip(&allowed.join("update.zip"), &[("DawnTick.exe", b"MZ")]);
        assert!(resolve_portable_zip(&inside.to_string_lossy(), &[allowed.clone()]).is_ok());

        let _ = std::fs::remove_dir_all(&allowed);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn script_replaces_exe_and_cleans_up() {
        let exe = Path::new(r"C:\Users\me\DawnTick\DawnTick.exe");
        let staged = Path::new(r"C:\Users\me\DawnTick\update-staging\DawnTick.exe");
        let staging = Path::new(r"C:\Users\me\DawnTick\update-staging");
        let script = update_script(exe, staged, staging);
        assert!(script.contains(r#"set "SRC=C:\Users\me\DawnTick\update-staging\DawnTick.exe""#), "{script}");
        assert!(script.contains(r#"set "DST=C:\Users\me\DawnTick\DawnTick.exe""#), "{script}");
        assert!(script.contains("copy /y \"%SRC%\" \"%DST%\""), "{script}");
        assert!(script.contains("start \"\" \"%DST%\""), "{script}");
        assert!(script.contains("rmdir /s /q"), "{script}");
        assert!(script.contains("del \"%~f0\""), "{script}");
        assert!(script.contains(&format!("for /l %%i in (1,1,{WAIT_ROUNDS})")), "{script}");
    }

    #[test]
    fn script_escapes_percent_in_paths() {
        // 批处理里 `%` 会被当变量展开，必须双写；否则路径含 % 时脚本会读错变量
        let script = update_script(
            Path::new(r"C:\100%\DawnTick.exe"),
            Path::new(r"C:\100%\update-staging\DawnTick.exe"),
            Path::new(r"C:\100%\update-staging"),
        );
        assert!(script.contains(r"C:\100%%\DawnTick.exe"), "{script}");
    }
}
