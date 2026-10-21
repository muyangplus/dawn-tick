//! 启动安装包（自动更新 I-03 的最后一步）。
//!
//! 安全边界：只允许运行**下载到临时目录或数据目录**里的 `.exe` / `.msi`，
//! 防止任意可执行文件被前端一句话拉起。启动用系统默认「打开」动词，
//! 由安装程序自己弹出界面（不传 `/S`、`/quiet` 之类的静默参数）。

use std::path::{Path, PathBuf};

use crate::paths;

/// 允许启动的安装包扩展名（大小写不敏感）。
const INSTALLER_EXTENSIONS: [&str; 2] = ["exe", "msi"];

/// 扩展名是否在白名单内。
pub fn installer_extension_ok(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => INSTALLER_EXTENSIONS
            .iter()
            .any(|allowed| ext.eq_ignore_ascii_case(allowed)),
        None => false,
    }
}

/// 校验并规范化安装包路径：
/// 1. 路径非空、存在且是普通文件；
/// 2. 扩展名是 exe / msi；
/// 3. `canonicalize` 之后落在允许目录（临时目录、数据目录）之内——
///    先解析符号链接/短名，避免 `..` 或软链接指到目录外。
pub fn resolve_installer(text: &str, allowed_dirs: &[PathBuf]) -> Result<PathBuf, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("没有提供安装包路径".to_string());
    }
    let path = PathBuf::from(text);
    let canonical =
        std::fs::canonicalize(&path).map_err(|_| format!("安装包不存在: {text}"))?;
    if !canonical.is_file() {
        return Err(format!("不是可执行的安装包文件: {text}"));
    }
    if !installer_extension_ok(&canonical) {
        return Err("只允许运行 .exe 或 .msi 安装包".to_string());
    }
    let allowed = allowed_dirs.iter().any(|dir| match std::fs::canonicalize(dir) {
        Ok(dir) => paths::path_inside(&canonical, &dir),
        Err(_) => false,
    });
    if !allowed {
        return Err("安装包必须位于临时目录或数据目录内".to_string());
    }
    Ok(canonical)
}

/// 启动安装包：不等待进程结束，也不静默安装。
#[cfg(windows)]
fn launch(target: &Path) -> Result<(), String> {
    // 用系统「打开」动词：.exe 直接运行，.msi 交给 msiexec 并显示安装界面
    crate::shell_open(&target.to_string_lossy(), "启动安装程序")
}

/// 非 Windows 平台的兜底：直接执行（本仓库实际发布只有 Windows 安装包）。
#[cfg(not(windows))]
fn launch(target: &Path) -> Result<(), String> {
    std::process::Command::new(target)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动安装包失败: {error}"))
}

/// 运行已下载的安装包（I-03 自动更新的最后一步）。
///
/// 返回实际启动的规范化路径；前端据此提示「安装程序已启动」。
#[tauri::command]
pub fn run_installer(path: String) -> Result<String, String> {
    let allowed = vec![crate::data_dir(), std::env::temp_dir()];
    let target = resolve_installer(&path, &allowed)?;
    let shown = target.to_string_lossy().to_string();
    launch(&target)?;
    crate::append_log(&format!("已启动安装程序: {shown}"));
    Ok(shown)
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn extension_whitelist_is_case_insensitive() {
        assert!(installer_extension_ok(Path::new("update.exe")));
        assert!(installer_extension_ok(Path::new("update.EXE")));
        assert!(installer_extension_ok(Path::new(r"C:\Temp\setup.msi")));
        assert!(installer_extension_ok(Path::new("setup.Msi")));
        // 其它可执行/脚本一律拒绝
        assert!(!installer_extension_ok(Path::new("update.bat")));
        assert!(!installer_extension_ok(Path::new("update.ps1")));
        assert!(!installer_extension_ok(Path::new("update.zip")));
        assert!(!installer_extension_ok(Path::new("update.exe.txt")));
        assert!(!installer_extension_ok(Path::new("update")));
        assert!(!installer_extension_ok(Path::new(r"C:\Temp\update.")));
    }

    #[test]
    fn empty_and_missing_paths_are_rejected() {
        let allowed = [scratch_dir("missing-allowed")];
        assert!(resolve_installer("", &allowed)
            .expect_err("空路径应报错")
            .contains("没有提供"));
        let missing = allowed[0].join("nope.exe");
        let error = resolve_installer(&missing.to_string_lossy(), &allowed).expect_err("不存在应报错");
        assert!(error.contains("安装包不存在"), "{error}");
        let _ = std::fs::remove_dir_all(&allowed[0]);
    }

    #[test]
    fn installer_inside_allowed_dir_is_accepted() {
        let allowed = [scratch_dir("allowed")];
        let exe = allowed[0].join("DawnTick_0.4.2_x64-setup.exe");
        std::fs::write(&exe, b"MZ").expect("应能写文件");
        let resolved = resolve_installer(&exe.to_string_lossy(), &allowed).expect("应允许");
        assert_eq!(
            resolved,
            std::fs::canonicalize(&exe).expect("应能规范化"),
            "返回规范化后的路径"
        );

        // 子目录里也允许
        let sub = allowed[0].join("downloads");
        std::fs::create_dir_all(&sub).expect("应能建子目录");
        let msi = sub.join("update.msi");
        std::fs::write(&msi, b"MSI").expect("应能写文件");
        assert!(resolve_installer(&msi.to_string_lossy(), &allowed).is_ok());

        let _ = std::fs::remove_dir_all(&allowed[0]);
    }

    #[test]
    fn installer_outside_allowed_dirs_is_rejected() {
        let allowed = [scratch_dir("inside")];
        let outside = scratch_dir("outside");
        let exe = outside.join("update.exe");
        std::fs::write(&exe, b"MZ").expect("应能写文件");
        let error = resolve_installer(&exe.to_string_lossy(), &allowed).expect_err("目录外应拒绝");
        assert!(error.contains("临时目录或数据目录"), "{error}");

        // 前缀相同的兄弟目录不能误判为「在内」
        let sibling = PathBuf::from(format!("{}-evil", allowed[0].to_string_lossy()));
        let _ = std::fs::remove_dir_all(&sibling);
        std::fs::create_dir_all(&sibling).expect("应能建兄弟目录");
        let sibling_exe = sibling.join("update.exe");
        std::fs::write(&sibling_exe, b"MZ").expect("应能写文件");
        assert!(
            resolve_installer(&sibling_exe.to_string_lossy(), &allowed).is_err(),
            "同前缀的兄弟目录不算在内"
        );

        let _ = std::fs::remove_dir_all(&allowed[0]);
        let _ = std::fs::remove_dir_all(&outside);
        let _ = std::fs::remove_dir_all(&sibling);
    }

    #[test]
    fn non_installer_extension_is_rejected_even_inside_allowed_dir() {
        let allowed = [scratch_dir("bad-ext")];
        let script = allowed[0].join("update.bat");
        std::fs::write(&script, b"echo hi").expect("应能写文件");
        let error = resolve_installer(&script.to_string_lossy(), &allowed).expect_err("应拒绝");
        assert!(error.contains(".exe"), "{error}");
        assert!(error.contains(".msi"), "{error}");
        let _ = std::fs::remove_dir_all(&allowed[0]);
    }

    #[test]
    fn directory_named_like_installer_is_rejected() {
        let allowed = [scratch_dir("dir-as-exe")];
        let fake = allowed[0].join("update.exe");
        std::fs::create_dir_all(&fake).expect("应能建目录");
        let error = resolve_installer(&fake.to_string_lossy(), &allowed).expect_err("目录应拒绝");
        assert!(error.contains("不是可执行的安装包文件"), "{error}");
        let _ = std::fs::remove_dir_all(&allowed[0]);
    }

    #[test]
    fn traversal_out_of_allowed_dir_is_rejected() {
        let allowed = [scratch_dir("traversal")];
        let outside = scratch_dir("traversal-outside");
        let exe = outside.join("update.exe");
        std::fs::write(&exe, b"MZ").expect("应能写文件");
        // 用 .. 拼出来的路径 canonicalize 后落在允许目录之外
        let sneaky = allowed[0].join("..").join(
            outside
                .file_name()
                .expect("应有目录名"),
        ).join("update.exe");
        let error = resolve_installer(&sneaky.to_string_lossy(), &allowed)
            .expect_err("目录穿越应拒绝");
        assert!(error.contains("临时目录或数据目录"), "{error}");
        let _ = std::fs::remove_dir_all(&allowed[0]);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn missing_allowed_dir_grants_nothing() {
        let allowed = [std::env::temp_dir().join("dawntick-definitely-missing-dir")];
        let inside = scratch_dir("orphan");
        let exe = inside.join("update.exe");
        std::fs::write(&exe, b"MZ").expect("应能写文件");
        assert!(resolve_installer(&exe.to_string_lossy(), &allowed).is_err());
        let _ = std::fs::remove_dir_all(&inside);
    }
}
