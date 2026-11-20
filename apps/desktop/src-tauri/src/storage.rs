//! 数据目录、存储位置与数据库地址。

use super::*;
use std::fs::create_dir_all;
use std::path::PathBuf;

/// 便携版的程序名：打包脚本把可执行文件重命名为 DawnTick.exe。
pub(crate) const PORTABLE_EXE_NAME: &str = "DawnTick.exe";
/// 数据库文件名。
pub(crate) const DATABASE_FILE_NAME: &str = "dawn-tick.db";
/// 自定义存储位置的引导文件（数据库此时还没打开，只能另存一份小 JSON）。
pub(crate) const STORAGE_FILE_NAME: &str = "storage.json";
/// 安装版的程序目录名：%LOCALAPPDATA%\DawnTick。
pub(crate) const INSTALL_DIR_NAME: &str = "DawnTick";

pub(crate) fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
}

/// 安装版的程序目录：%LOCALAPPDATA%\DawnTick。
pub(crate) fn install_dir() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA")
        .ok()
        .map(|base| PathBuf::from(base).join(INSTALL_DIR_NAME))
}

/// 安装版的数据目录：%APPDATA%\com.dawntick.app；引导文件也放这里。
pub(crate) fn roaming_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|base| PathBuf::from(base).join("com.dawntick.app"))
        .unwrap_or_else(|_| PathBuf::from("com.dawntick.app"))
}

pub(crate) fn same_path(left: &std::path::Path, right: &std::path::Path) -> bool {
    left.to_string_lossy().eq_ignore_ascii_case(&right.to_string_lossy())
}

/// 便携版判定：程序名是 DawnTick.exe 且不在安装目录下。
/// 开发构建（dawn-tick-desktop.exe）与安装版都按安装版处理，数据留在 %APPDATA%。
pub(crate) fn portable_layout(exe: &std::path::Path, install: Option<&std::path::Path>) -> bool {
    let named = exe
        .file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case(PORTABLE_EXE_NAME))
        .unwrap_or(false);
    if !named {
        return false;
    }
    match (
        exe.parent().filter(|dir| !dir.as_os_str().is_empty()),
        install,
    ) {
        (Some(dir), Some(root)) => !same_path(dir, root),
        (Some(_), None) => true,
        _ => false,
    }
}

pub(crate) fn is_portable_layout() -> bool {
    match std::env::current_exe() {
        Ok(exe) => portable_layout(&exe, install_dir().as_deref()),
        Err(_) => false,
    }
}

/// 默认数据目录：便携版取程序所在目录（拷走即可带走全部数据），安装版取 %APPDATA%。
pub(crate) fn default_data_dir() -> PathBuf {
    if is_portable_layout() {
        if let Some(dir) = exe_dir() {
            return dir;
        }
    }
    roaming_dir()
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub(crate) struct StorageConfig {
    #[serde(default)]
    pub(crate) path: String,
}

pub(crate) fn storage_config_file() -> PathBuf {
    roaming_dir().join(STORAGE_FILE_NAME)
}

/// 用户填的自定义存储位置；没填过返回 None。
pub(crate) fn custom_storage_path() -> Option<String> {
    let config = read_json::<StorageConfig>(&storage_config_file())?;
    let text = config.path.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// 相对路径以程序所在目录为基准。
pub(crate) fn resolve_storage_path(text: &str) -> PathBuf {
    let path = std::path::Path::new(text);
    if path.is_absolute() {
        return path.to_path_buf();
    }
    match exe_dir() {
        Some(dir) => dir.join(path),
        None => path.to_path_buf(),
    }
}

/// 建目录并写探针，确认这个位置真能写进去。
pub(crate) fn ensure_writable_dir(dir: &std::path::Path) -> Result<(), String> {
    create_dir_all(dir).map_err(|error| format!("创建目录失败({error})"))?;
    let probe = dir.join("dawntick-storage-probe.tmp");
    std::fs::write(&probe, b"probe").map_err(|error| format!("写入失败({error})"))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// 在默认目录与自定义位置之间做选择；自定义位置不可用时退回默认并带上提示。
pub(crate) fn choose_data_dir(default: PathBuf, custom: Option<String>) -> (PathBuf, Option<String>) {
    let Some(text) = custom else {
        return (default, None);
    };
    let candidate = resolve_storage_path(&text);
    match ensure_writable_dir(&candidate) {
        Ok(()) => (candidate, None),
        Err(error) => (
            default,
            Some(format!("自定义存储位置不可用（{error}），已改用默认位置")),
        ),
    }
}

/// 实际使用的数据目录；自定义位置不可用时退回默认并带上提示。
pub(crate) fn resolve_data_dir() -> (PathBuf, Option<String>) {
    choose_data_dir(default_data_dir(), custom_storage_path())
}

/// 本次运行实际使用的数据目录：首次解析后固定。
/// 每次重新解析会在两种情况下与已打开的数据库分家：改了存储位置但还没重启（备份、恢复请求落到新目录），
/// 以及自定义目录中途变得不可写（U 盘拔出）时静默换回默认目录。
pub(crate) fn data_dir() -> PathBuf {
    #[cfg(not(test))]
    {
        static ACTIVE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
        ACTIVE.get_or_init(|| resolve_data_dir().0).clone()
    }
    // 单测会在同一进程里换环境变量指向不同目录：不缓存
    #[cfg(test)]
    {
        resolve_data_dir().0
    }
}

pub(crate) fn database_file(dir: &std::path::Path) -> PathBuf {
    dir.join(DATABASE_FILE_NAME)
}

/// 数据库地址：绝对路径，位于数据目录内。
pub(crate) fn database_url_string() -> String {
    let file = database_file(&data_dir());
    format!("sqlite:{}", file.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn database_url() -> String {
    database_url_string()
}

/// 存储位置信息，供设置页展示与回填。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageInfo {
    /// 按当前配置解析出的数据目录（改了存储位置后，重启前与 active_dir 不同）
    pub(crate) dir: String,
    /// 本次运行实际在用的数据目录
    pub(crate) active_dir: String,
    /// 没设置自定义位置时使用的目录
    pub(crate) default_dir: String,
    /// 用户填的自定义位置（原样返回，便于回填输入框）
    pub(crate) custom_path: String,
    /// 便携版：程序名 DawnTick.exe 且不在安装目录下
    pub(crate) portable: bool,
    /// 引导文件路径
    pub(crate) config_file: String,
    /// 数据目录当前是否可写
    pub(crate) writable: bool,
    /// 自定义位置不可用时的提示
    pub(crate) fallback_reason: Option<String>,
    /// 数据库文件
    pub(crate) db_file: String,
    pub(crate) db_exists: bool,
    pub(crate) db_bytes: u64,
    /// 数据库旁边的 -wal / -shm / -journal 文件
    pub(crate) sidecars: Vec<String>,
    /// 日志目录
    pub(crate) log_dir: String,
    /// 本次改位置时复制过去的文件名
    pub(crate) copied: Vec<String>,
}

pub(crate) fn storage_info_of(dir: &std::path::Path, fallback_reason: Option<String>, copied: Vec<String>) -> StorageInfo {
    let file = database_file(dir);
    let meta = std::fs::metadata(&file).ok();
    let mut sidecars = Vec::new();
    for suffix in ["-wal", "-shm", "-journal"] {
        let side = dir.join(format!("{DATABASE_FILE_NAME}{suffix}"));
        if side.exists() {
            sidecars.push(format!("{DATABASE_FILE_NAME}{suffix}"));
        }
    }
    StorageInfo {
        dir: dir.to_string_lossy().to_string(),
        active_dir: data_dir().to_string_lossy().to_string(),
        default_dir: default_data_dir().to_string_lossy().to_string(),
        custom_path: custom_storage_path().unwrap_or_default(),
        portable: is_portable_layout(),
        config_file: storage_config_file().to_string_lossy().to_string(),
        writable: ensure_writable_dir(dir).is_ok(),
        fallback_reason,
        db_file: file.to_string_lossy().to_string(),
        db_exists: meta.is_some(),
        db_bytes: meta.map(|meta| meta.len()).unwrap_or(0),
        sidecars,
        log_dir: log_file_dir()
            .map(|dir| dir.to_string_lossy().to_string())
            .unwrap_or_default(),
        copied,
    }
}

#[tauri::command]
pub fn storage_info() -> StorageInfo {
    let (dir, fallback) = resolve_data_dir();
    storage_info_of(&dir, fallback, Vec::new())
}

/// 复制数据文件：数据库与现有日志；目标已有同名文件时保留目标。
/// 数据库用 `VACUUM INTO` 生成一份自洽的单文件副本：逐个复制正在使用的 db / -wal / -shm 会拿到前后不一致的快照，
/// 目标已有 db 而缺 -wal 时还会把别的库的 WAL 重放上去。窗口几何存在数据库里，跟着数据库一起走。
pub(crate) fn copy_data_files(from: &std::path::Path, to: &std::path::Path) -> Vec<String> {
    let mut copied = Vec::new();
    if same_path(from, to) {
        return copied;
    }
    let source_db = from.join(DATABASE_FILE_NAME);
    let target_db = to.join(DATABASE_FILE_NAME);
    if source_db.is_file() && !target_db.exists() {
        // 目标没有主库：先清掉可能残留的附带文件，免得新库打开时重放
        for suffix in ["-wal", "-shm", "-journal"] {
            let _ = std::fs::remove_file(to.join(format!("{DATABASE_FILE_NAME}{suffix}")));
        }
        match tauri::async_runtime::block_on(vacuum_into(&source_db, &target_db)) {
            Ok(()) => copied.push(DATABASE_FILE_NAME.to_string()),
            Err(error) => {
                let _ = std::fs::remove_file(&target_db);
                log_error("storage", format!("数据库复制到新位置失败 error={error}"));
            }
        }
    }
    for name in [LOG_FILE_NAME.to_string(), "startup.log".to_string()] {
        let source = from.join(&name);
        let target = to.join(&name);
        if !source.is_file() || target.exists() {
            continue;
        }
        if std::fs::copy(&source, &target).is_ok() {
            copied.push(name);
        }
    }
    copied
}

/// 把整个库写成目标路径上的单文件副本（不带 -wal / -shm）。
pub(crate) async fn vacuum_into(source: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    use sqlx::{ConnectOptions, Connection};
    let mut connection = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(source)
        .read_only(true)
        .busy_timeout(std::time::Duration::from_millis(2000))
        .connect()
        .await
        .map_err(|error| error.to_string())?;
    let result = sqlx::query("VACUUM INTO ?")
        .bind(target.to_string_lossy().to_string())
        .execute(&mut connection)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string());
    let _ = connection.close().await;
    result
}

/// 设置或清除自定义存储位置：清空即恢复默认。改完需要重启才生效。
#[tauri::command]
pub async fn set_storage_path(path: String) -> Result<StorageInfo, String> {
    // 要复制整个数据库：放到阻塞线程池
    tauri::async_runtime::spawn_blocking(move || set_storage_path_blocking(path))
        .await
        .map_err(|error| format!("后台任务失败: {error}"))?
}

pub(crate) fn set_storage_path_blocking(path: String) -> Result<StorageInfo, String> {
    let text = path.trim().to_string();
    let config_file = storage_config_file();
    if text.is_empty() {
        let _ = std::fs::remove_file(&config_file);
        let (dir, fallback) = resolve_data_dir();
        log_info("storage", format!("存储位置已恢复默认 dir={}", dir.display()));
        return Ok(storage_info_of(&dir, fallback, Vec::new()));
    }
    let target = resolve_storage_path(&text);
    ensure_writable_dir(&target)?;
    // 先取旧目录：写入引导文件后 data_dir() 就指向新目录了
    let current = data_dir();
    if let Some(parent) = config_file.parent() {
        create_dir_all(parent).map_err(|error| format!("创建引导文件目录失败: {error}"))?;
    }
    if !write_json(&config_file, &StorageConfig { path: text.clone() }) {
        return Err("写入引导文件失败".to_string());
    }
    let copied = if same_path(&current, &target) {
        Vec::new()
    } else {
        copy_data_files(&current, &target)
    };
    log_info(
        "storage",
        format!("存储位置已更改 dir={} copied={}", target.display(), copied.len()),
    );
    Ok(storage_info_of(&target, None, copied))
}

/// 在资源管理器里打开数据目录，返回目录路径。
#[tauri::command]
pub fn open_data_dir() -> Result<String, String> {
    let dir = data_dir();
    create_dir_all(&dir).map_err(|error| format!("创建数据目录失败: {error}"))?;
    #[cfg(windows)]
    {
        shell_open(&dir.to_string_lossy(), "打开数据目录")?;
        log_debug("storage", format!("已打开数据目录 dir={}", dir.display()));
    }
    Ok(dir.to_string_lossy().to_string())
}

/// 由界面调用：改完存储位置后立即重启。
#[tauri::command]
pub fn relaunch_app(app: tauri::AppHandle) {
    log_info("app", "按用户请求重启应用");
    app.restart();
}
