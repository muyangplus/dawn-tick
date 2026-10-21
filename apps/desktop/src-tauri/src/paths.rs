//! 资源管理器定位与路径包含判定的纯函数（供 `reveal_path` 与安装包白名单共用）。

use std::path::{Path, PathBuf};

/// 定位目标：文件在资源管理器里**选中**，目录直接打开。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RevealTarget {
    File(PathBuf),
    Dir(PathBuf),
}

impl RevealTarget {
    pub fn path(&self) -> &Path {
        match self {
            RevealTarget::File(path) | RevealTarget::Dir(path) => path,
        }
    }
}

/// 校验路径并分类；空路径与不存在的路径都返回可直接展示的中文错误。
pub fn classify_reveal_target(text: &str) -> Result<RevealTarget, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("没有提供要打开的路径".to_string());
    }
    let path = PathBuf::from(text);
    let metadata = std::fs::metadata(&path).map_err(|_| format!("路径不存在: {text}"))?;
    if metadata.is_dir() {
        Ok(RevealTarget::Dir(path))
    } else {
        Ok(RevealTarget::File(path))
    }
}

/// `explorer.exe` 的参数：文件用 `/select,<路径>` 打开所在目录并选中它，目录直接打开。
pub fn explorer_args(target: &RevealTarget) -> Vec<String> {
    match target {
        RevealTarget::File(path) => vec![format!("/select,{}", path.to_string_lossy())],
        RevealTarget::Dir(path) => vec![path.to_string_lossy().to_string()],
    }
}

/// 归一成便于比较的文本：先按组件消掉 `.` / `..`（防目录穿越），
/// 再把分隔符统一成 `/`、去掉末尾分隔符；Windows 下忽略大小写。
pub fn comparable_path(path: &Path) -> String {
    let mut buffer = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                buffer.pop();
            }
            other => buffer.push(other.as_os_str()),
        }
    }
    let text = buffer.to_string_lossy().replace('\\', "/");
    let text = text.trim_end_matches('/').to_string();
    #[cfg(windows)]
    {
        text.to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    {
        text
    }
}

/// `path` 是否落在 `dir` 之内（含 `dir` 自身）。两侧都应先 `canonicalize`，
/// 否则 `..`、8.3 短名与符号链接都可能绕过判定。
pub fn path_inside(path: &Path, dir: &Path) -> bool {
    let dir = comparable_path(dir);
    if dir.is_empty() {
        return false;
    }
    let path = comparable_path(path);
    path == dir || path.starts_with(&format!("{dir}/"))
}

/// 在 Windows 资源管理器里定位文件/目录，返回定位到的路径。
///
/// - 文件：`explorer /select,<路径>`，打开所在目录并选中该文件；
/// - 目录：直接打开该目录；
/// - 路径不存在：返回 `路径不存在: …`，不启动任何进程。
#[tauri::command]
pub fn reveal_path(path: String) -> Result<String, String> {
    let target = classify_reveal_target(&path)?;
    #[cfg(windows)]
    {
        let args = explorer_args(&target);
        std::process::Command::new("explorer.exe")
            .args(&args)
            .spawn()
            .map_err(|error| format!("打开资源管理器失败: {error}"))?;
    }
    #[cfg(not(windows))]
    {
        return Err("当前平台不支持在资源管理器中定位".to_string());
    }
    #[allow(unreachable_code)]
    let shown = target.path().to_string_lossy().to_string();
    crate::append_log(&format!("已在资源管理器中定位: {shown}"));
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
    fn empty_path_is_rejected() {
        for text in ["", "   ", "\t\n"] {
            let error = classify_reveal_target(text).expect_err("空路径应报错");
            assert!(error.contains("没有提供"), "{error}");
        }
    }

    #[test]
    fn missing_path_reports_not_found() {
        let missing = std::env::temp_dir().join("dawntick-definitely-missing-file.tmp");
        let error = classify_reveal_target(&missing.to_string_lossy()).expect_err("不存在应报错");
        assert!(error.contains("路径不存在"), "{error}");
        assert!(error.contains("dawntick-definitely-missing-file.tmp"), "{error}");
    }

    #[test]
    fn file_and_dir_are_classified() {
        let dir = scratch_dir("classify");
        let file = dir.join("export.csv");
        std::fs::write(&file, b"id,title").expect("应能写文件");

        assert_eq!(classify_reveal_target(&file.to_string_lossy()), Ok(RevealTarget::File(file.clone())));
        assert_eq!(classify_reveal_target(&dir.to_string_lossy()), Ok(RevealTarget::Dir(dir.clone())));
        // 首尾空白被忽略
        assert_eq!(
            classify_reveal_target(&format!("  {}  ", file.to_string_lossy())),
            Ok(RevealTarget::File(file))
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn explorer_args_select_for_files_and_open_for_dirs() {
        let file = RevealTarget::File(PathBuf::from(r"C:\Users\me\Desktop\课表.csv"));
        assert_eq!(
            explorer_args(&file),
            vec![r"/select,C:\Users\me\Desktop\课表.csv".to_string()]
        );
        let dir = RevealTarget::Dir(PathBuf::from(r"C:\Users\me\Desktop"));
        assert_eq!(explorer_args(&dir), vec![r"C:\Users\me\Desktop".to_string()]);
    }

    #[test]
    fn path_inside_matches_children_only() {
        let root = Path::new(r"C:\Users\me\Downloads");
        assert!(path_inside(Path::new(r"C:\Users\me\Downloads\setup.exe"), root));
        assert!(path_inside(Path::new(r"C:\Users\me\Downloads\sub\a\setup.exe"), root));
        // 目录自身算在内
        assert!(path_inside(root, root));
        // 前缀相同但不是子路径
        assert!(!path_inside(Path::new(r"C:\Users\me\Downloads2\setup.exe"), root));
        assert!(!path_inside(Path::new(r"C:\Users\me\Downloads\..\Windows\setup.exe"), root));
        assert!(!path_inside(Path::new(r"C:\Windows\setup.exe"), root));
        // 分隔符混用与大小写（Windows 下忽略大小写）
        assert!(path_inside(Path::new("C:/Users/me/Downloads/setup.exe"), root));
        assert!(path_inside(Path::new(r"c:\users\ME\downloads\SETUP.EXE"), root));
        // 空目录不匹配任何路径
        assert!(!path_inside(Path::new(r"C:\Windows\setup.exe"), Path::new("")));
    }
}
