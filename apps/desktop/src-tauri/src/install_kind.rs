//! 区分 Windows 的「便携版 / 安装版」运行形态。
//!
//! 识别顺序（用户已确认）：
//! 1. 当前 exe 同目录存在 `README-portable.txt` → 便携版（发布流程只把该标记放进便携 zip）；
//! 2. 否则 exe 落在 `%ProgramFiles%`、`%ProgramFiles(x86)%` 或 `%LOCALAPPDATA%\Programs` 下 → 安装版；
//! 3. 其余情况（含开发构建、识别失败）→ 便携版。
//!
//! 判定主体是注入 exe 路径与环境变量的纯函数，单测不依赖真实机器布局。

use std::path::{Path, PathBuf};

/// 便携包标记文件：发布流程把它放在便携 zip 的根目录。
pub const PORTABLE_MARKER: &str = "README-portable.txt";

/// 运行形态：便携版（zip 覆盖 exe）或安装版（交给安装程序）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallKind {
    Portable,
    Installed,
}

impl InstallKind {
    /// 给前端与日志用的稳定小写标识。
    pub fn as_str(self) -> &'static str {
        match self {
            InstallKind::Portable => "portable",
            InstallKind::Installed => "installed",
        }
    }

    /// 中文说明，写进诊断日志。
    pub fn label(self) -> &'static str {
        match self {
            InstallKind::Portable => "便携版",
            InstallKind::Installed => "安装版",
        }
    }
}

/// 判定需要的环境变量：只取安装目录相关的三个，便于单测注入。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstallEnv {
    pub program_files: Option<PathBuf>,
    pub program_files_x86: Option<PathBuf>,
    pub local_app_data: Option<PathBuf>,
}

impl InstallEnv {
    /// 从当前进程环境读取。
    pub fn from_process() -> Self {
        Self {
            program_files: env_path("ProgramFiles"),
            program_files_x86: env_path("ProgramFiles(x86)"),
            local_app_data: env_path("LOCALAPPDATA"),
        }
    }

    /// 安装版可能落地的根目录：两个 Program Files 与 `%LOCALAPPDATA%\Programs`。
    fn install_roots(&self) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(dir) = &self.program_files {
            roots.push(dir.clone());
        }
        if let Some(dir) = &self.program_files_x86 {
            roots.push(dir.clone());
        }
        if let Some(dir) = &self.local_app_data {
            roots.push(dir.join("Programs"));
        }
        roots
    }
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// 归一化路径文本：统一分隔符、去掉末尾分隔符、忽略大小写（Windows 路径语义）。
fn normalized(text: &str) -> String {
    text.replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

/// `path` 是否落在 `dir` 之内（含 `dir` 自身）；不按裸前缀比较，避免 `Program Files Evil` 误判。
fn path_inside(path: &str, dir: &str) -> bool {
    if dir.is_empty() {
        return false;
    }
    path == dir || path.starts_with(&format!("{dir}/"))
}

/// 纯判定：exe 路径 + 环境变量 + 同目录标记文件是否存在 → 运行形态。
///
/// 标记文件优先：便携包被放进 Program Files 时仍按便携版处理（数据随目录走）。
pub fn classify_install_kind(exe: &Path, env: &InstallEnv, has_portable_marker: bool) -> InstallKind {
    if has_portable_marker {
        return InstallKind::Portable;
    }
    let exe = normalized(&exe.to_string_lossy());
    if exe.is_empty() {
        return InstallKind::Portable;
    }
    let installed = env
        .install_roots()
        .iter()
        .any(|root| path_inside(&exe, &normalized(&root.to_string_lossy())));
    if installed {
        InstallKind::Installed
    } else {
        InstallKind::Portable
    }
}

/// 同目录是否有便携包标记文件。
pub fn has_portable_marker(exe: &Path) -> bool {
    exe.parent()
        .map(|dir| dir.join(PORTABLE_MARKER).is_file())
        .unwrap_or(false)
}

/// 当前进程的运行形态；拿不到 exe 路径时按便携版处理（识别不到 → 便携版）。
pub fn current_install_kind() -> InstallKind {
    match std::env::current_exe() {
        Ok(exe) => classify_install_kind(&exe, &InstallEnv::from_process(), has_portable_marker(&exe)),
        Err(_) => InstallKind::Portable,
    }
}

/// 给前端判定「便携版 / 安装版」：便携版走 zip 覆盖替换，安装版走安装程序。
#[tauri::command]
pub fn windows_install_kind() -> String {
    let kind = current_install_kind();
    crate::append_log(&format!(
        "Windows 运行形态判定: {}（{}）",
        kind.label(),
        kind.as_str()
    ));
    kind.as_str().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program_files_env() -> InstallEnv {
        InstallEnv {
            program_files: Some(PathBuf::from(r"C:\Program Files")),
            program_files_x86: Some(PathBuf::from(r"C:\Program Files (x86)")),
            local_app_data: Some(PathBuf::from(r"C:\Users\me\AppData\Local")),
        }
    }

    #[test]
    fn portable_marker_wins_even_under_install_roots() {
        let exe = Path::new(r"C:\Program Files\DawnTick\DawnTick.exe");
        assert_eq!(
            classify_install_kind(exe, &program_files_env(), true),
            InstallKind::Portable,
            "同目录有 README-portable.txt 时按便携版处理"
        );
        assert_eq!(
            classify_install_kind(exe, &program_files_env(), false),
            InstallKind::Installed
        );
    }

    #[test]
    fn program_files_layouts_are_installed() {
        let env = program_files_env();
        for exe in [
            r"C:\Program Files\DawnTick\DawnTick.exe",
            r"C:\Program Files\DawnTick\sub\DawnTick.exe",
            r"C:\Program Files (x86)\DawnTick\DawnTick.exe",
            r"C:\Users\me\AppData\Local\Programs\DawnTick\DawnTick.exe",
        ] {
            assert_eq!(
                classify_install_kind(Path::new(exe), &env, false),
                InstallKind::Installed,
                "{exe} 应判为安装版"
            );
        }
    }

    #[test]
    fn case_and_separators_do_not_matter() {
        let env = program_files_env();
        for exe in [
            r"c:\program files\dawntick\DAWNTICK.EXE",
            "C:/Program Files/DawnTick/DawnTick.exe",
            r"C:\Users\ME\AppData\Local\PROGRAMS\DawnTick.exe",
        ] {
            assert_eq!(
                classify_install_kind(Path::new(exe), &env, false),
                InstallKind::Installed,
                "{exe} 应判为安装版"
            );
        }
    }

    #[test]
    fn everything_else_is_portable() {
        let env = program_files_env();
        for exe in [
            r"D:\DawnTick\DawnTick.exe",
            r"E:\work\dsh\dawn-tick\target\debug\dawn-tick-desktop.exe",
            r"C:\Users\me\Downloads\DawnTick\DawnTick.exe",
        ] {
            assert_eq!(
                classify_install_kind(Path::new(exe), &env, false),
                InstallKind::Portable,
                "{exe} 识别不到时按便携版处理"
            );
        }
        // 空环境与空路径都按便携版处理
        assert_eq!(
            classify_install_kind(Path::new(r"C:\DawnTick\DawnTick.exe"), &InstallEnv::default(), false),
            InstallKind::Portable
        );
        assert_eq!(
            classify_install_kind(Path::new(""), &env, false),
            InstallKind::Portable
        );
    }

    #[test]
    fn sibling_prefixes_are_not_install_dirs() {
        let env = program_files_env();
        for exe in [
            r"C:\Program Files Evil\DawnTick\DawnTick.exe",
            r"C:\Program Files (x86)evil\DawnTick\DawnTick.exe",
            r"C:\Users\me\AppData\Local\Programs2\DawnTick.exe",
            r"C:\Users\me\AppData\Local\DawnTick\DawnTick.exe",
        ] {
            assert_eq!(
                classify_install_kind(Path::new(exe), &env, false),
                InstallKind::Portable,
                "{exe} 只是前缀相同，不应判为安装版"
            );
        }
    }

    #[test]
    fn marker_file_is_detected_next_to_exe() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-tmp")
            .join(format!("install-kind-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("应能建测试目录");
        let exe = dir.join("DawnTick.exe");
        std::fs::write(&exe, b"MZ").expect("应能写文件");
        assert!(!has_portable_marker(&exe));
        std::fs::write(dir.join(PORTABLE_MARKER), b"stub").expect("应能写标记文件");
        assert!(has_portable_marker(&exe));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
