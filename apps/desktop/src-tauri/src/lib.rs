use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

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
/// 便携版的程序名：打包脚本把可执行文件重命名为 DawnTick.exe。
const PORTABLE_EXE_NAME: &str = "DawnTick.exe";
/// 数据库文件名。
const DATABASE_FILE_NAME: &str = "dawn-tick.db";
/// 自定义存储位置的引导文件（数据库此时还没打开，只能另存一份小 JSON）。
const STORAGE_FILE_NAME: &str = "storage.json";
/// 安装版的程序目录名：%LOCALAPPDATA%\DawnTick。
const INSTALL_DIR_NAME: &str = "DawnTick";

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
}

/// 安装版的程序目录：%LOCALAPPDATA%\DawnTick。
fn install_dir() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA")
        .ok()
        .map(|base| PathBuf::from(base).join(INSTALL_DIR_NAME))
}

/// 安装版的数据目录：%APPDATA%\com.dawntick.app；引导文件也放这里。
fn roaming_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|base| PathBuf::from(base).join("com.dawntick.app"))
        .unwrap_or_else(|_| PathBuf::from("com.dawntick.app"))
}

fn same_path(left: &std::path::Path, right: &std::path::Path) -> bool {
    left.to_string_lossy().eq_ignore_ascii_case(&right.to_string_lossy())
}

/// 便携版判定：程序名是 DawnTick.exe 且不在安装目录下。
/// 开发构建（dawn-tick-desktop.exe）与安装版都按安装版处理，数据留在 %APPDATA%。
fn portable_layout(exe: &std::path::Path, install: Option<&std::path::Path>) -> bool {
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

fn is_portable_layout() -> bool {
    match std::env::current_exe() {
        Ok(exe) => portable_layout(&exe, install_dir().as_deref()),
        Err(_) => false,
    }
}

/// 默认数据目录：便携版取程序所在目录（拷走即可带走全部数据），安装版取 %APPDATA%。
fn default_data_dir() -> PathBuf {
    if is_portable_layout() {
        if let Some(dir) = exe_dir() {
            return dir;
        }
    }
    roaming_dir()
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct StorageConfig {
    #[serde(default)]
    path: String,
}

fn storage_config_file() -> PathBuf {
    roaming_dir().join(STORAGE_FILE_NAME)
}

/// 用户填的自定义存储位置；没填过返回 None。
fn custom_storage_path() -> Option<String> {
    let config = read_json::<StorageConfig>(&storage_config_file())?;
    let text = config.path.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// 相对路径以程序所在目录为基准。
fn resolve_storage_path(text: &str) -> PathBuf {
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
fn ensure_writable_dir(dir: &std::path::Path) -> Result<(), String> {
    create_dir_all(dir).map_err(|error| format!("创建目录失败({error})"))?;
    let probe = dir.join("dawntick-storage-probe.tmp");
    std::fs::write(&probe, b"probe").map_err(|error| format!("写入失败({error})"))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// 在默认目录与自定义位置之间做选择；自定义位置不可用时退回默认并带上提示。
fn choose_data_dir(default: PathBuf, custom: Option<String>) -> (PathBuf, Option<String>) {
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
fn resolve_data_dir() -> (PathBuf, Option<String>) {
    choose_data_dir(default_data_dir(), custom_storage_path())
}

fn data_dir() -> PathBuf {
    resolve_data_dir().0
}

fn database_file(dir: &std::path::Path) -> PathBuf {
    dir.join(DATABASE_FILE_NAME)
}

/// 数据库地址：绝对路径，位于数据目录内。
fn database_url_string() -> String {
    let file = database_file(&data_dir());
    format!("sqlite:{}", file.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn database_url() -> String {
    database_url_string()
}

/// 存储位置信息，供设置页展示与回填。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInfo {
    /// 实际使用的数据目录
    dir: String,
    /// 没设置自定义位置时使用的目录
    default_dir: String,
    /// 用户填的自定义位置（原样返回，便于回填输入框）
    custom_path: String,
    /// 便携版：程序名 DawnTick.exe 且不在安装目录下
    portable: bool,
    /// 引导文件路径
    config_file: String,
    /// 数据目录当前是否可写
    writable: bool,
    /// 自定义位置不可用时的提示
    fallback_reason: Option<String>,
    /// 数据库文件
    db_file: String,
    db_exists: bool,
    db_bytes: u64,
    /// 数据库旁边的 -wal / -shm / -journal 文件
    sidecars: Vec<String>,
    /// 日志目录
    log_dir: String,
    /// 本次改位置时复制过去的文件名
    copied: Vec<String>,
}

fn storage_info_of(dir: &std::path::Path, fallback_reason: Option<String>, copied: Vec<String>) -> StorageInfo {
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
fn storage_info() -> StorageInfo {
    let (dir, fallback) = resolve_data_dir();
    storage_info_of(&dir, fallback, Vec::new())
}

/// 复制数据文件：数据库（含 WAL 附带文件）、窗口几何与现有日志；目标已有同名文件时保留目标。
fn copy_data_files(from: &std::path::Path, to: &std::path::Path) -> Vec<String> {
    let mut copied = Vec::new();
    if same_path(from, to) {
        return copied;
    }
    let mut names = vec![
        DATABASE_FILE_NAME.to_string(),
        "window.json".to_string(),
        LOG_FILE_NAME.to_string(),
        "startup.log".to_string(),
    ];
    for suffix in ["-wal", "-shm"] {
        names.push(format!("{DATABASE_FILE_NAME}{suffix}"));
    }
    for name in names {
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

/// 设置或清除自定义存储位置：清空即恢复默认。改完需要重启才生效。
#[tauri::command]
fn set_storage_path(path: String) -> Result<StorageInfo, String> {
    let text = path.trim().to_string();
    let config_file = storage_config_file();
    if text.is_empty() {
        let _ = std::fs::remove_file(&config_file);
        let (dir, fallback) = resolve_data_dir();
        append_log(&format!("存储位置已恢复默认: {}", dir.display()));
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
    append_log(&format!(
        "存储位置已改为: {}（复制 {} 个文件）",
        target.display(),
        copied.len()
    ));
    Ok(storage_info_of(&target, None, copied))
}

/// 在资源管理器里打开数据目录，返回目录路径。
#[tauri::command]
fn open_data_dir() -> Result<String, String> {
    let dir = data_dir();
    create_dir_all(&dir).map_err(|error| format!("创建数据目录失败: {error}"))?;
    shell_open(&dir.to_string_lossy(), "打开数据目录")?;
    append_log(&format!("已打开数据目录: {}", dir.display()));
    Ok(dir.to_string_lossy().to_string())
}

/// 由界面调用：改完存储位置后立即重启。
#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    append_log("按用户请求重启应用");
    app.restart();
}

/// 数据库快照目录：数据目录下的 backups。
fn backups_dir() -> PathBuf {
    data_dir().join("backups")
}

/// 待生效的恢复请求：重启时在打开数据库之前套用。
fn pending_restore_file() -> PathBuf {
    data_dir().join("pending-restore.json")
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupEntry {
    name: String,
    bytes: u64,
    /// 文件修改时间（UTC 毫秒）
    created_at: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct PendingRestore {
    name: String,
}

/// 快照文件名：dawn-tick-<yyyyMMdd-HHmmss>.db，按名字排序即为时间顺序。
fn backup_name(unix_ms: i64) -> String {
    let offset = local_offset_minutes();
    let shifted = unix_ms + i64::from(offset) * 60_000;
    let days = shifted.div_euclid(86_400_000);
    let rest = shifted.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hour = rest / 3_600_000;
    let minute = (rest % 3_600_000) / 60_000;
    let second = (rest % 60_000) / 1000;
    format!("dawn-tick-{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}.db")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

/// 快照名只允许 backups 目录内的 dawn-tick-*.db，拒绝任何路径穿越。
fn safe_backup_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains(['/', '\\', ':'])
        || !trimmed.starts_with("dawn-tick-")
        || !trimmed.ends_with(".db")
    {
        return Err("快照名不合法".to_string());
    }
    Ok(trimmed.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupTarget {
    name: String,
    path: String,
    /// 已转义，可直接拼进 `VACUUM INTO ...` 的 SQL 字面量
    sql_literal: String,
}

/// 取下一个快照的目标路径：建目录、给出唯一文件名与 SQL 字面量。
#[tauri::command]
fn backup_target() -> Result<BackupTarget, String> {
    let dir = backups_dir();
    create_dir_all(&dir).map_err(|error| format!("创建备份目录失败: {error}"))?;
    let name = backup_name(now_ms());
    let path = dir.join(&name);
    let literal = format!("'{}'", path.to_string_lossy().replace('\'', "''"));
    Ok(BackupTarget {
        name,
        path: path.to_string_lossy().to_string(),
        sql_literal: literal,
    })
}

fn list_backup_entries() -> Result<Vec<BackupEntry>, String> {
    let dir = backups_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for item in std::fs::read_dir(&dir).map_err(|error| format!("读取备份目录失败: {error}"))? {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().to_string();
        if !name.starts_with("dawn-tick-") || !name.ends_with(".db") {
            continue;
        }
        let Ok(meta) = item.metadata() else { continue };
        let created_at = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0);
        entries.push(BackupEntry {
            name,
            bytes: meta.len(),
            created_at,
        });
    }
    entries.sort_by(|left, right| right.name.cmp(&left.name));
    Ok(entries)
}

/// 列出全部快照，最新的排在最前。
#[tauri::command]
fn list_backups() -> Result<Vec<BackupEntry>, String> {
    list_backup_entries()
}

#[tauri::command]
fn delete_backup(name: String) -> Result<(), String> {
    let safe = safe_backup_name(&name)?;
    let path = backups_dir().join(&safe);
    std::fs::remove_file(&path).map_err(|error| format!("删除快照失败: {error}"))?;
    append_log(&format!("已删除快照: {safe}"));
    Ok(())
}

/// 只保留最新的 keep 份，返回实际删掉的份数。
#[tauri::command]
fn prune_backups(keep: usize) -> Result<usize, String> {
    let entries = list_backup_entries()?;
    let mut removed = 0;
    for entry in entries.into_iter().skip(keep) {
        if std::fs::remove_file(backups_dir().join(&entry.name)).is_ok() {
            removed += 1;
        }
    }
    if removed > 0 {
        append_log(&format!("已按保留份数清理 {removed} 份快照"));
    }
    Ok(removed)
}

/// 排队一份恢复请求：重启时在打开数据库之前用快照覆盖当前库。
#[tauri::command]
fn restore_backup(name: String) -> Result<String, String> {
    let safe = safe_backup_name(&name)?;
    if !backups_dir().join(&safe).is_file() {
        return Err("快照不存在".to_string());
    }
    write_json(&pending_restore_file(), &PendingRestore { name: safe.clone() })
        .then_some(())
        .ok_or_else(|| "写入恢复请求失败".to_string())?;
    append_log(&format!("已排队恢复快照: {safe}"));
    Ok(safe)
}

/// 启动时套用排队的恢复请求：覆盖数据库并清掉 WAL 附带文件。
fn apply_pending_restore() {
    let marker = pending_restore_file();
    let Some(pending) = read_json::<PendingRestore>(&marker) else {
        return;
    };
    let _ = std::fs::remove_file(&marker);
    let Ok(safe) = safe_backup_name(&pending.name) else {
        append_log("恢复请求里的快照名不合法，已忽略");
        return;
    };
    let source = backups_dir().join(&safe);
    if !source.is_file() {
        append_log(&format!("恢复请求的快照不存在，已忽略: {safe}"));
        return;
    }
    let dir = data_dir();
    let _ = create_dir_all(&dir);
    let db = database_file(&dir);
    for path in [
        db.clone(),
        dir.join(format!("{DATABASE_FILE_NAME}-wal")),
        dir.join(format!("{DATABASE_FILE_NAME}-shm")),
        dir.join(format!("{DATABASE_FILE_NAME}-journal")),
    ] {
        let _ = std::fs::remove_file(&path);
    }
    match std::fs::copy(&source, &db) {
        Ok(bytes) => append_log(&format!("已套用快照 {safe}（{bytes} 字节）")),
        Err(error) => append_log(&format!("套用快照失败: {error}")),
    }
}


/// 日志目录候选：数据目录优先，其次 %LOCALAPPDATA%\com.dawntick.app，最后 %TEMP%\DawnTick。
fn compute_log_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![data_dir()];
    if let Some(dir) = app_dir() {
        dirs.push(dir);
    }
    if let Ok(temp) = std::env::var("TEMP") {
        dirs.push(PathBuf::from(temp).join("DawnTick"));
    }
    dirs
}

/// 日志目录只解析一次：解析要读引导文件与探针，不能每写一行都算一遍。
static LOG_DIRS: std::sync::OnceLock<Vec<PathBuf>> = std::sync::OnceLock::new();

fn log_dirs() -> &'static [PathBuf] {
    LOG_DIRS.get_or_init(compute_log_dirs)
}

/// 以追加方式打开某个候选目录里的日志文件；不可写返回 None。
fn open_log_file(dir: &std::path::Path) -> Option<std::fs::File> {
    if create_dir_all(dir).is_err() {
        return None;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(LOG_FILE_NAME))
        .ok()
}

/// 日志实际落盘的目录：第一个写得进去的候选。
fn log_file_dir() -> Option<PathBuf> {
    log_dirs()
        .iter()
        .find(|dir| open_log_file(dir).is_some())
        .cloned()
        .or_else(|| log_dirs().first().cloned())
}

/// 同一条日志写到控制台：有控制台句柄时直接写，否则退回标准输出。
#[cfg(windows)]
fn console_log(message: &str) {
    use windows_sys::Win32::Foundation::{INVALID_HANDLE_VALUE, HANDLE};
    use windows_sys::Win32::System::Console::{GetStdHandle, WriteConsoleW, STD_OUTPUT_HANDLE};
    unsafe {
        let handle: HANDLE = GetStdHandle(STD_OUTPUT_HANDLE);
        if handle != 0 && handle != INVALID_HANDLE_VALUE {
            let line: Vec<u16> = message.encode_utf16().chain(std::iter::once(b'\n' as u16)).collect();
            let mut written: u32 = 0;
            if WriteConsoleW(
                handle,
                line.as_ptr() as *const std::ffi::c_void,
                line.len() as u32,
                &mut written,
                std::ptr::null(),
            ) != 0
            {
                return;
            }
        }
    }
    let _ = writeln!(std::io::stdout(), "{message}");
}

#[cfg(not(windows))]
fn console_log(message: &str) {
    let _ = writeln!(std::io::stdout(), "{message}");
}

/// 启动时把日志接到控制台：已挂控制台就不动，否则先附加到父进程控制台；
/// 提权实例无法附加时新开一个控制台窗口，保证管理员运行也能看到日志。
#[cfg(windows)]
fn ensure_console() {
    use windows_sys::Win32::System::Console::{
        AllocConsole, AttachConsole, GetConsoleWindow, SetConsoleTitleW, ATTACH_PARENT_PROCESS,
    };
    unsafe {
        if GetConsoleWindow() != 0 {
            return;
        }
        if AttachConsole(ATTACH_PARENT_PROCESS) != 0 {
            return;
        }
        if !is_elevated() {
            return;
        }
        if AllocConsole() != 0 {
            let title: Vec<u16> = "晓刻 DawnTick 日志"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            SetConsoleTitleW(title.as_ptr());
            let _ = writeln!(std::io::stdout(), "晓刻 DawnTick 日志已连接到本控制台");
        }
    }
}

#[cfg(not(windows))]
fn ensure_console() {}

/// 关掉开发者特性时释放日志控制台，让 dev 构建表现与正式版一致。
#[tauri::command]
fn set_dev_console(enabled: bool) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Console::FreeConsole;
        if enabled {
            ensure_console();
        } else {
            unsafe {
                FreeConsole();
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
    }
}

/// 日志统一格式：`2026-10-13 18:01:34.123 +08:00 [info] scope: 消息`。
/// 时间戳口径为本地时间 + 与 UTC 的偏移，文件与控制台用同一行。

/// 天数（1970-01-01 起，可为负）→ 公历年月日（Howard Hinnant 的 civil_from_days）。
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 把 UTC 毫秒按给定偏移格式化成日志时间戳。
fn format_log_timestamp(unix_ms: i64, offset_minutes: i32) -> String {
    let shifted = unix_ms + i64::from(offset_minutes) * 60_000;
    let days = shifted.div_euclid(86_400_000);
    let rest = shifted.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hours = rest / 3_600_000;
    let minutes = (rest % 3_600_000) / 60_000;
    let seconds = (rest % 60_000) / 1000;
    let millis = rest % 1000;
    let sign = if offset_minutes < 0 { '-' } else { '+' };
    let abs = offset_minutes.abs();
    format!(
        "{year:04}-{month:02}-{day:02} {hours:02}:{minutes:02}:{seconds:02}.{millis:03} {sign}{:02}:{:02}",
        abs / 60,
        abs % 60
    )
}

/// 当前本地时间相对 UTC 的偏移（分钟）。
#[cfg(windows)]
fn local_offset_minutes() -> i32 {
    use windows_sys::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};
    /// 系统处于夏令时（windows-sys 0.52 未导出该常量，取值见 Win32 文档）。
    const TIME_ZONE_ID_DAYLIGHT: u32 = 2;
    unsafe {
        let mut info: TIME_ZONE_INFORMATION = std::mem::zeroed();
        let state = GetTimeZoneInformation(&mut info);
        let mut bias = info.Bias + info.StandardBias;
        if state == TIME_ZONE_ID_DAYLIGHT {
            bias += info.DaylightBias;
        }
        -bias
    }
}

#[cfg(not(windows))]
fn local_offset_minutes() -> i32 {
    0
}

/// 一行日志的前缀：时间戳 + 空格。
fn log_prefix() -> String {
    let unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0);
    format!("{} ", format_log_timestamp(unix_ms, local_offset_minutes()))
}

/// 日志文件名（与前端「应用诊断日志」同一份）。
const LOG_FILE_NAME: &str = "dawn-tick.log";
/// 日志级别：error < warn < info < debug < trace。0 表示不写文件（控制台仍输出）。
static LOG_LEVEL: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(3);
static LOG_FILE_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

fn level_rank(level: &str) -> u8 {
    match level {
        "error" => 1,
        "warn" => 2,
        "info" => 3,
        "debug" => 4,
        "trace" => 5,
        _ => 3,
    }
}

/// 前端设置好级别与开关后调用：级别决定写文件的门槛，开关决定是否写文件。
#[tauri::command]
fn set_log_settings(level: String, file_enabled: bool) {
    LOG_LEVEL.store(level_rank(&level), std::sync::atomic::Ordering::Relaxed);
    LOG_FILE_ENABLED.store(file_enabled, std::sync::atomic::Ordering::Relaxed);
}

/// 判断某行是否该写：从行内 `[level]` 解析等级，低于门槛就丢弃。
fn should_write(line: &str) -> bool {
    if !LOG_FILE_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
        return false;
    }
    let level = line
        .split('[')
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .unwrap_or("info");
    level_rank(level) <= LOG_LEVEL.load(std::sync::atomic::Ordering::Relaxed)
}

fn append_log(message: &str) {
    let line = format!("{}{message}", log_prefix());
    if !should_write(&line) {
        console_log(&line);
        return;
    }
    for dir in log_dirs() {
        if let Some(mut file) = open_log_file(dir) {
            let _ = writeln!(file, "{line}");
            break;
        }
    }
    console_log(&line);
}

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// 开机自启注册的命令行参数：只有带该参数启动才按「启动时隐藏窗口」处理。
const HIDDEN_ARG: &str = "--hidden";
/// 提权实例的标记参数：只写机器级启动项后退出。
const MAIN_WINDOW: &str = "main";
/// 托盘创建结果：(是否成功, 细节)
static TRAY_STATE: std::sync::Mutex<Option<(bool, String)>> = std::sync::Mutex::new(None);
/// 内嵌教务窗口的标签。
const IMPORT_WINDOW: &str = "import";

/// 注入到教务页面的脚本：右下角按钮，点击后把页面（含同源 iframe）带回应用页面。
const IMPORT_INJECTION: &str = include_str!("import-injection.js");

/// 教务页面把内容带到应用自身页面后，由该页面交回主窗口。
/// 全程不经过任何本机端口，避免与其他监听程序相互影响。
#[tauri::command]
async fn submit_page_import(app: tauri::AppHandle, payload: String) -> Result<(), String> {
    use tauri::Emitter;
    if !payload.contains("<<<DAWNTICK>>>") {
        append_log("教务页面交回的内容缺少标记，已忽略");
        return Err("内容缺少标记".into());
    }
    append_log(&format!("教务页面交回 {} 字节", payload.len()));
    app.emit("import-payload", payload)
        .map_err(|error| format!("转发回传内容失败: {error}"))
}

/// 打开内嵌教务窗口，由用户自行登录并打开课表页。
/// 必须用 async：同步命令在主线程上执行，而创建窗口要等待主线程，会自锁。
#[tauri::command]
async fn open_import_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri::Manager;
    let parsed: tauri::Url = url.parse().map_err(|error| format!("网址不正确: {error}"))?;
    append_log("开始创建教务窗口");
    if let Some(existing) = app.get_webview_window(IMPORT_WINDOW) {
        let _ = existing.close();
    }
    let new_window_target = app.clone();
    tauri::WebviewWindowBuilder::new(&app, IMPORT_WINDOW, tauri::WebviewUrl::External(parsed))
        .title("登录教务并打开课表页")
        .inner_size(1100.0, 780.0)
        .initialization_script(IMPORT_INJECTION)
        // 记录每次页面导航，便于判断「点了没反应」是没触发跳转还是被拦下。
        .on_navigation(|target| {
            append_log(&format!("教务窗口导航: {target}"));
            true
        })
        // 教务菜单多用 window.open 打开子页面，默认会被拒绝且没有任何提示。
        // 改为在本窗口内跳转：登录会话与「导入到晓刻」按钮都保留。
        .on_new_window(move |target, _features| {
            append_log(&format!("教务页面请求新窗口，改为本窗口打开: {target}"));
            let handle = new_window_target.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(30));
                if let Some(window) = handle.get_webview_window(IMPORT_WINDOW) {
                    if let Err(error) = window.navigate(target) {
                        append_log(&format!("教务窗口内跳转失败: {error}"));
                    }
                }
            });
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
        .map_err(|error| format!("打开教务窗口失败: {error}"))?;
    append_log("教务窗口已创建");
    Ok(())
}

/// 关闭内嵌教务窗口。同样用 async，避免在窗口销毁上等待主线程。
#[tauri::command]
async fn close_import_window(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(IMPORT_WINDOW) {
        let _ = window.close();
    }
}

fn app_dir() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA")
        .ok()
        .map(|base| PathBuf::from(base).join("com.dawntick.app"))
}

fn read_json<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn write_json<T: serde::Serialize>(path: &std::path::Path, value: &T) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    if create_dir_all(parent).is_err() {
        return false;
    }
    let Ok(text) = serde_json::to_string(value) else {
        return false;
    };
    std::fs::write(path, text).is_ok()
}

#[derive(serde::Serialize, serde::Deserialize)]
struct InstanceStateFile {
    pid: u32,
    version: String,
}

/// 接管请求：只认新鲜且非本进程写入的请求，避免遗留文件把后续启动顶掉。
#[derive(serde::Serialize, serde::Deserialize)]
struct QuitRequest {
    pid: u32,
    version: String,
    at: u64,
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

const QUIT_REQUEST_MAX_AGE: u64 = 120;

#[derive(serde::Serialize, serde::Deserialize)]
struct StartupPrefs {
    hidden: bool,
}

fn parse_version(text: &str) -> (u32, u32, u32) {
    let core = text.split(['-', '+']).next().unwrap_or(text);
    let mut parts = core.split('.').map(|part| part.parse::<u32>().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

fn version_is_newer(candidate: &str, current: &str) -> bool {
    parse_version(candidate) > parse_version(current)
}

fn read_startup_prefs() -> StartupPrefs {
    app_dir()
        .and_then(|dir| read_json::<StartupPrefs>(&dir.join("startup.json")))
        .unwrap_or(StartupPrefs { hidden: true })
}

/// 只有带 `--hidden`（开机自启）启动且偏好为隐藏时才隐藏窗口；
/// 手动双击始终显示主窗口，避免「点了没反应」。
fn hidden_for_launch(args: &[String], prefs: &StartupPrefs) -> bool {
    args.iter().any(|arg| arg == HIDDEN_ARG) && prefs.hidden
}

fn start_hidden() -> bool {
    let args: Vec<String> = std::env::args().collect();
    hidden_for_launch(&args, &read_startup_prefs())
}

/// release 版没有控制台，panic 信息必须落盘才能排查。
fn install_panic_logger() {
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
fn data_root_hint() -> String {
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
fn show_error_box(title: &str, message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() };
    let title_wide = wide(title);
    let message_wide = wide(message);
    unsafe {
        MessageBoxW(0, message_wide.as_ptr(), title_wide.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

#[cfg(not(windows))]
fn show_error_box(_title: &str, _message: &str) {}

/// 记录数据库路径与可写性，便于定位 readonly 类报错。只读探测，不改动数据。
#[cfg(windows)]
fn log_database_status() {
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
fn log_database_status() {}

/// WebView2 的用户数据目录同一时刻只能被一个进程使用，且目录若由提权进程创建，
/// 普通权限将无法写入，表现为「双击没反应」。三层兜底：可用则不动，
/// 不可用先改名让 WebView2 重建，改名也失败就改用可写目录。
#[cfg(windows)]
fn ensure_webview_folder_writable() {
    // 数据目录锁死：不再列候选、不再探测回退
    let locked = data_dir();
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
fn probe_folder(folder: &std::path::Path) -> Result<(), String> {
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
fn describe_holders() -> String {
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
struct ProcessInfo {
    pid: u32,
    parent: u32,
    name: String,
}

#[cfg(windows)]
fn is_our_app(name: &str) -> bool {
    name.eq_ignore_ascii_case("DawnTick.exe") || name.eq_ignore_ascii_case("dawn-tick-desktop.exe")
}

#[cfg(windows)]
fn list_processes() -> Vec<ProcessInfo> {
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
fn is_writable(dir: &std::path::Path) -> bool {
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

#[cfg(desktop)]
fn ensure_mini(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    if let Some(window) = app.get_webview_window("mini") {
        return Some(window);
    }
    let built = WebviewWindowBuilder::new(app, "mini", WebviewUrl::App("mini.html".into()))
        .title("晓刻 DawnTick · 悬浮窗")
        .inner_size(240.0, 104.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .visible(false)
        .build();
    match built {
        Ok(window) => {
            // 首次出现放在主屏右下角，避免出现在奇怪的位置
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let size = monitor.size();
                let scale = monitor.scale_factor();
                let width = (260.0 * scale) as i32;
                let height = (140.0 * scale) as i32;
                let x = size.width as i32 - width;
                let y = size.height as i32 - height;
                let _ = window.set_position(tauri::PhysicalPosition::new(x.max(0), y.max(0)));
            }
            Some(window)
        }
        Err(error) => {
            append_log(&format!("创建悬浮窗失败: {error}"));
            None
        }
    }
}

/// 悬浮窗各样式对应的窗口尺寸（逻辑像素）。
fn widget_size(variant: &str) -> (f64, f64) {
    match variant {
        "today" => (268.0, 236.0),
        "minimal" => (196.0, 68.0),
        "combo" => (288.0, 268.0),
        _ => (240.0, 104.0),
    }
}

/// 按当前样式调整悬浮窗大小并显示。
#[tauri::command]
async fn show_widget(app: tauri::AppHandle, variant: Option<String>) -> Result<(), String> {
    let key = variant.unwrap_or_else(|| "bar".to_string());
    let window = ensure_mini(&app).ok_or_else(|| "悬浮窗不可用".to_string())?;
    let (width, height) = widget_size(&key);
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    window.show().map_err(|error| format!("显示悬浮窗失败: {error}"))?;
    let _ = window.set_focus();
    append_log(&format!("已显示悬浮窗（{key}）"));
    Ok(())
}

/// 隐藏悬浮窗。
#[tauri::command]
async fn hide_widget(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("mini") {
        window.hide().map_err(|error| format!("隐藏悬浮窗失败: {error}"))?;
        append_log("已隐藏悬浮窗");
    }
    Ok(())
}

/// 允许交给外部程序的链接：只有 http 与 https，且不含换行与引号。
fn external_url_is_allowed(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return false;
    }
    !url.chars().any(|item| item == '\r' || item == '\n' || item == '"')
}

/// 交给 shell 打开一个目标（链接或目录）。
#[cfg(windows)]
fn shell_open(target: &str, what: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() };
    let verb = wide("open");
    let file = wide(target);
    let result = unsafe {
        ShellExecuteW(
            0,
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result as isize) <= 32 {
        return Err(format!("{what}失败（代码 {}）", result as isize));
    }
    Ok(())
}

/// 用系统默认浏览器打开链接；应用自身不加载该页面。
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !external_url_is_allowed(&url) {
        return Err("只支持 http 与 https 链接".to_string());
    }
    #[cfg(windows)]
    {
        shell_open(&url, "打开默认浏览器")?;
        append_log(&format!("已在默认浏览器打开链接: {url}"));
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("当前平台不支持".to_string())
    }
}

/// 把文本写到用户选定的路径：导出备份与日志用。
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<String, String> {
    let target = std::path::PathBuf::from(&path);
    if target.as_os_str().is_empty() {
        return Err("没有选择保存位置".to_string());
    }
    std::fs::write(&target, content.as_bytes()).map_err(|error| format!("写入失败: {error}"))?;
    append_log(&format!("已写入文件: {path}（{} 字节）", content.len()));
    Ok(path)
}

/// 标准 Base64 解码；长度或字符不合法时返回 None。
fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    for byte in text.bytes() {
        if byte == b'=' || byte.is_ascii_whitespace() {
            continue;
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    if bits >= 6 {
        return None;
    }
    Some(out)
}

/// 把 Base64 内容按二进制写到用户选定的路径：整包 zip 导出用。
#[tauri::command]
fn write_binary_file(path: String, base64: String) -> Result<String, String> {
    let target = std::path::PathBuf::from(&path);
    if target.as_os_str().is_empty() {
        return Err("没有选择保存位置".to_string());
    }
    let bytes = decode_base64(&base64).ok_or_else(|| "内容不是合法的 Base64".to_string())?;
    std::fs::write(&target, &bytes).map_err(|error| format!("写入失败: {error}"))?;
    append_log(&format!("已写入文件: {path}（{} 字节）", bytes.len()));
    Ok(path)
}

/// 在资源管理器里打开日志目录，返回目录路径。
#[tauri::command]
fn open_log_dir() -> Result<String, String> {
    let dir = log_file_dir().ok_or_else(|| "无法定位日志目录".to_string())?;
    create_dir_all(&dir).map_err(|error| format!("创建日志目录失败: {error}"))?;
    #[cfg(windows)]
    {
        shell_open(&dir.to_string_lossy(), "打开日志目录")?;
        append_log(&format!("已打开日志目录: {}", dir.display()));
    }
    Ok(dir.to_string_lossy().to_string())
}

/// 再次启动时的处置方式。
#[cfg(windows)]
#[derive(Debug, PartialEq, Eq)]
enum InstanceRole {
    /// 本进程成为唯一实例
    Owner,
    /// 已有同版本或更新版本实例，唤回它的窗口后退出
    FocusExisting,
}

#[cfg(windows)]
fn instance_state_path() -> Option<PathBuf> {
    app_dir().map(|dir| dir.join("instance.json"))
}

#[cfg(windows)]
fn quit_request_path() -> Option<PathBuf> {
    app_dir().map(|dir| dir.join("instance-quit.json"))
}

#[cfg(windows)]
fn process_alive(pid: u32) -> bool {
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
fn focus_main_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    let title: Vec<u16> = "晓刻 DawnTick".encode_utf16().chain(std::iter::once(0)).collect();
    let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
    if hwnd == 0 {
        append_log("未找到已有主窗口，无法唤到前台");
        return;
    }
    unsafe {
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
    }
}

/// 独占标记：同名互斥体存在即表示已有实例在运行。
#[cfg(windows)]
fn hold_instance_mutex() -> bool {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    let name: Vec<u16> = "Local\\DawnTick-SingleInstance"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle == 0 {
        append_log("创建单实例互斥体失败，按独占处理");
        return true;
    }
    // 句柄随进程生命周期保留，进程退出时系统自动释放
    let _ = handle;
    (unsafe { GetLastError() }) != ERROR_ALREADY_EXISTS
}

/// 探测已有实例并按版本决定：新版顶掉老版本，同版本或更老则唤回主窗口。
#[cfg(windows)]
fn decide_instance() -> InstanceRole {
    if hold_instance_mutex() {
        return InstanceRole::Owner;
    }

    let running: Option<InstanceStateFile> = instance_state_path().and_then(|path| read_json(&path));
    let Some(state) = running else {
        append_log("已有实例但缺少状态文件，按同版本处理");
        return InstanceRole::FocusExisting;
    };
    if !process_alive(state.pid) {
        append_log(&format!("状态文件中的进程 {} 已退出，本次接管", state.pid));
        return InstanceRole::Owner;
    }
    if !version_is_newer(APP_VERSION, &state.version) {
        append_log(&format!(
            "已有实例 v{}（本进程 v{APP_VERSION}），唤回主窗口",
            state.version
        ));
        return InstanceRole::FocusExisting;
    }

    append_log(&format!(
        "本进程 v{APP_VERSION} 新于运行中的 v{}，请求老版本退出",
        state.version
    ));
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
    for _ in 0..80 {
        if !process_alive(state.pid) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if process_alive(state.pid) {
        append_log("老版本未在 8 秒内退出，仍然继续启动");
    }
    InstanceRole::Owner
}

#[cfg(windows)]
fn write_instance_state() {
    if let Some(path) = instance_state_path() {
        write_json(&path, &InstanceStateFile { pid: std::process::id(), version: APP_VERSION.to_string() });
    }
}

/// 监听新版本的接管请求，收到后退出本实例。
#[cfg(windows)]
fn spawn_takeover_watcher(app: tauri::AppHandle) {
    // 启动时清掉上一次运行遗留的请求：那是发给上一个实例的
    if let Some(path) = quit_request_path() {
        if std::fs::remove_file(&path).is_ok() {
            append_log("清理遗留的接管请求文件");
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
            append_log("忽略过期的接管请求");
            continue;
        }
        if version_is_newer(&request.version, APP_VERSION) {
            append_log(&format!("新版本 v{} 请求接管，退出当前实例", request.version));
            app.exit(0);
            return;
        }
    });
}

/// 常驻托盘（D29）：主窗口关闭时隐藏而不退出，紧凑条由托盘控制。
#[cfg(desktop)]
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let show_main = MenuItem::with_id(app, "show_main", "显示主窗口", true, None::<&str>)?;
    let show_mini = MenuItem::with_id(app, "show_mini", "显示悬浮窗", true, None::<&str>)?;
    let hide_mini = MenuItem::with_id(app, "hide_mini", "隐藏悬浮窗", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_main, &show_mini, &hide_mini, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("晓刻 DawnTick")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_main" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "show_mini" => {
                if let Some(window) = ensure_mini(app) {
                    let _ = window.show();
                }
            }
            "hide_mini" => {
                if let Some(window) = app.get_webview_window("mini") {
                    let _ = window.hide();
                }
            }
            "quit" => {
                // 退出前补一次落盘，避免最后 500ms 内的移动/缩放随防抖一起丢掉
                if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
                    save_geometry_now(&main);
                }
                app.exit(0)
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let Some(window) = ensure_mini(tray.app_handle()) else {
                    return;
                };
                let visible = window.is_visible().unwrap_or(false);
                if visible {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                }
            }
        });

    let mut icon_source = "none".to_string();
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
        icon_source = format!("window-icon {}x{}", icon.width(), icon.height());
    }
    match builder.build(app) {
        Ok(_) => {
            append_log(&format!("托盘已创建（{icon_source}）"));
            if let Ok(mut state) = TRAY_STATE.lock() {
                *state = Some((true, icon_source));
            }
            Ok(())
        }
        Err(error) => {
            append_log(&format!("托盘创建失败: {error}"));
            if let Ok(mut state) = TRAY_STATE.lock() {
                *state = Some((false, format!("{icon_source} / {error}")));
            }
            Err(error)
        }
    }
}

/// 托盘当前状态，供界面显示，避免靠猜。
#[tauri::command]
fn tray_status() -> serde_json::Value {
    let (created, detail) = TRAY_STATE
        .lock()
        .ok()
        .and_then(|state| state.clone())
        .unwrap_or((false, "尚未初始化".to_string()));
    serde_json::json!({ "created": created, "detail": detail })
}

/// 前端日志落盘：与 panic、启动错误写入同一文件。
#[tauri::command]
fn log_event(level: String, scope: String, message: String, detail: Option<String>) {
    // detail 为前端附带的 JSON 明细；为空时省略，保证日志行格式稳定
    let tail = match detail {
        Some(text) if !text.is_empty() && text != "null" => format!(" {text}"),
        _ => String::new(),
    };
    append_log(&format!("[{level}] {scope}: {message}{tail}"));
}

#[tauri::command]
fn save_startup_prefs(hidden: bool) {
    save_startup_prefs_inner(hidden);
}

fn save_startup_prefs_inner(hidden: bool) {
    if let Some(dir) = app_dir() {
        write_json(&dir.join("startup.json"), &StartupPrefs { hidden });
    }
}

/// 开机自启：直接写注册表，用户级失败时可提权写机器级。
#[cfg(windows)]
mod autostart_reg {
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
        HKEY, KEY_READ, KEY_SET_VALUE, REG_SZ,
    };

    pub const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const VALUE_NAME: &str = "DawnTick";

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn command_line() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|error| format!("获取程序路径失败: {error}"))?;
        Ok(format!("\"{}\" {}", exe.display(), super::HIDDEN_ARG))
    }

    fn open(root: HKEY, key_path: &str, access: u32) -> Option<HKEY> {
        let path = wide(key_path);
        let mut key: HKEY = 0;
        let status = unsafe { RegOpenKeyExW(root, path.as_ptr(), 0, access, &mut key) };
        if status == ERROR_SUCCESS {
            Some(key)
        } else {
            None
        }
    }

    pub fn write_to(root: HKEY, key_path: &str, value_name: &str, value: &str) -> Result<(), String> {
        let path = wide(key_path);
        let mut key: HKEY = 0;
        let status = unsafe {
            RegCreateKeyExW(
                root,
                path.as_ptr(),
                0,
                std::ptr::null(),
                0,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut key,
                std::ptr::null_mut(),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!("打开注册表项失败，代码 {status}"));
        }
        let mut data: Vec<u8> = value.encode_utf16().flat_map(|unit| unit.to_le_bytes()).collect();
        data.extend_from_slice(&[0, 0]);
        let name = wide(value_name);
        let status =
            unsafe { RegSetValueExW(key, name.as_ptr(), 0, REG_SZ, data.as_ptr(), data.len() as u32) };
        unsafe { RegCloseKey(key) };
        if status != ERROR_SUCCESS {
            return Err(format!("写入启动项失败，代码 {status}"));
        }
        Ok(())
    }

    pub fn read_from(root: HKEY, key_path: &str, value_name: &str) -> Option<String> {
        let key = open(root, key_path, KEY_READ)?;
        let name = wide(value_name);
        let mut size: u32 = 0;
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut size,
            )
        };
        if status != ERROR_SUCCESS || size == 0 {
            unsafe { RegCloseKey(key) };
            return None;
        }
        let mut buffer = vec![0u8; size as usize];
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                buffer.as_mut_ptr(),
                &mut size,
            )
        };
        unsafe { RegCloseKey(key) };
        if status == ERROR_FILE_NOT_FOUND || status != ERROR_SUCCESS {
            return None;
        }
        let units: Vec<u16> = buffer
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .take_while(|unit| *unit != 0)
            .collect();
        Some(String::from_utf16_lossy(&units))
    }

    pub fn remove_from(root: HKEY, key_path: &str, value_name: &str) -> bool {
        let Some(key) = open(root, key_path, KEY_SET_VALUE) else {
            return false;
        };
        let name = wide(value_name);
        let status = unsafe { RegDeleteValueW(key, name.as_ptr()) };
        unsafe { RegCloseKey(key) };
        status == ERROR_SUCCESS
    }

    pub fn write(root: HKEY, value: &str) -> Result<(), String> {
        write_to(root, RUN_KEY, VALUE_NAME, value)
    }

    pub fn read(root: HKEY) -> Option<String> {
        read_from(root, RUN_KEY, VALUE_NAME)
    }

    pub fn remove(root: HKEY) -> bool {
        remove_from(root, RUN_KEY, VALUE_NAME)
    }
}

#[derive(serde::Serialize)]
struct AutostartStatus {
    user: bool,
    machine: bool,
}

#[cfg(windows)]
fn autostart_status_inner() -> AutostartStatus {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    AutostartStatus {
        user: autostart_reg::read(HKEY_CURRENT_USER).is_some(),
        machine: autostart_reg::read(HKEY_LOCAL_MACHINE).is_some(),
    }
}

#[cfg(not(windows))]
fn autostart_status_inner() -> AutostartStatus {
    AutostartStatus {
        user: false,
        machine: false,
    }
}

#[tauri::command]
fn autostart_status() -> AutostartStatus {
    autostart_status_inner()
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<AutostartStatus, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::HKEY_CURRENT_USER;
        if enabled {
            let command = autostart_reg::command_line()?;
            autostart_reg::write(HKEY_CURRENT_USER, &command)?;
            append_log("已写入用户级开机自启");
        } else {
            let user = autostart_reg::remove(HKEY_CURRENT_USER);
            append_log(&format!("已移除用户级开机自启（用户级={user}）"));
        }
        Ok(autostart_status_inner())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("当前平台不支持开机自启".to_string())
    }
}

#[cfg(windows)]
const ELEVATE_MARKER: &str = "--elevated-attempt";
#[cfg(windows)]

/// 是否已具备管理员权限：用机器级 Run 键的写权限做探测。
#[cfg(windows)]
fn is_elevated() -> bool {
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
fn request_elevation_restart() -> Result<(), String> {
    if is_elevated() {
        return Err("已具备管理员权限，无需提权".to_string());
    }

    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe = std::env::current_exe().map_err(|error| format!("取程序路径失败: {error}"))?;
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
        return Err(format!("申请管理员权限被取消或失败（代码 {}）", result as isize));
    }
    append_log("用户请求提权，已启动管理员实例");
    Ok(())
}

/// 由界面调用：申请管理员权限并以管理员身份重新启动。
#[tauri::command]
async fn relaunch_elevated() -> Result<(), String> {
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
        Err("当前平台不支持".to_string())
    }
}

#[derive(serde::Serialize)]
struct ElevationStatus {
    elevated: bool,
}

/// 当前是否具备管理员权限，供界面显示。
#[tauri::command]
fn elevation_status() -> ElevationStatus {
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
fn database_writable() -> bool {
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
fn database_writable() -> bool {
    true
}

/// 启动期是否出现过「拒绝访问」，用于决定是否自动提权。
#[cfg(windows)]
static ACCESS_DENIED_SEEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
fn note_access_denied(context: &str, detail: &str) {
    if detail.contains("拒绝访问") || detail.contains("os error 5") {
        ACCESS_DENIED_SEEN.store(true, std::sync::atomic::Ordering::SeqCst);
        append_log(&format!("{context}: 拒绝访问（已记录，稍后按需提权）"));
    }
}

/// 遇到拒绝访问时自动申请管理员权限并重启；返回 true 表示调用方应立即退出。
/// 已提权或本次启动已尝试过提权时不再循环。
#[cfg(windows)]
fn elevate_on_access_denied(reason: &str) -> bool {
    if is_elevated() {
        append_log(&format!("{reason}：已具备管理员权限，仍被拒绝访问"));
        return false;
    }
    if std::env::args().any(|arg| arg == ELEVATE_MARKER) {
        append_log(&format!("{reason}：提权后仍被拒绝访问，继续以普通权限运行"));
        return false;
    }
    match request_elevation_restart() {
        Ok(()) => {
            append_log(&format!("{reason}：已申请管理员权限，等待提权实例接管"));
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_millis(800));
                std::process::exit(0);
            });
            true
        }
        Err(error) => {
            append_log(&format!("{reason}：申请管理员权限失败，继续以普通权限运行: {error}"));
            false
        }
    }
}

/// 主窗口几何，字段与 `window.json` 一一对应。
/// `width/height/x/y` 是**物理像素**（且宽高是内尺寸），与旧版文件完全一致；
/// `monitor` 是后加的显示器指纹，旧文件没有该字段、反序列化为 `None`，
/// 此时一律按旧的物理像素逻辑恢复（向后兼容，不 panic）。
/// 注意：宽高是窗口**内尺寸**（客户区），与 `set_size` 的语义一致；
/// 若存外尺寸（`outer_size`），恢复时会被再加一圈边框，窗口每次重启都变大。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
struct WindowGeometry {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
    /// 窗口所在显示器的指纹；缺失（旧文件）或非法时为 None → 走物理像素回退路径。
    /// 为 None 时不写该字段，落盘形态与旧版完全一致。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    monitor: Option<MonitorRef>,
}

/// 窗口所在显示器的指纹：名称、保存时的缩放因子，以及窗口逻辑坐标相对
/// 该显示器逻辑原点的偏移（逻辑像素）。
/// 跨不同缩放的显示器搬窗口时，物理坐标会随缩放整体放大/缩小而失真，
/// 只有「同一块显示器 + 逻辑偏移 + 逻辑尺寸」才是可移植的。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
struct MonitorRef {
    /// `monitor.name()` 的结果；Windows 上可能拿不到名称，此时为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    /// 保存时该显示器的缩放因子（1.0 / 1.25 / 1.5 / 2.0 …）。
    /// 字段缺失（手改过的旧文件）时为 0.0，重映射会因非法而退回物理逻辑。
    #[serde(default)]
    scale_factor: f64,
    /// 窗口逻辑坐标相对显示器逻辑原点的偏移（逻辑像素）= (窗口物理坐标 - 显示器物理原点) / scale。
    #[serde(default)]
    offset_x: f64,
    #[serde(default)]
    offset_y: f64,
}

/// 当前显示器快照：物理原点按**当前** scale 换算成逻辑原点，
/// 这样「显示器逻辑原点 + 保存的逻辑偏移」就直接是窗口的目标逻辑坐标。
#[derive(Debug, Clone, PartialEq)]
struct MonitorSnapshot {
    name: Option<String>,
    logical_x: f64,
    logical_y: f64,
    scale_factor: f64,
}

/// 重映射结果：窗口在目标显示器上的逻辑坐标与逻辑尺寸（逻辑像素）。
#[derive(Debug, Clone, Copy, PartialEq)]
struct LogicalTarget {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale_factor: f64,
}

/// 显示器可见矩形（物理像素）。抽成纯数据类型，便于对可见性判定做单元测试。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ScreenRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// 尺寸下限：小于该值基本是最小化过程中的脏数据。
const MIN_WINDOW_SIZE: u32 = 400;
/// 尺寸上限：防止显示器热插拔等异常写出离谱尺寸。
const MAX_WINDOW_SIZE: u32 = 10000;
/// 坐标绝对值上限：Windows 虚拟桌面坐标不会超出该范围。
const MAX_WINDOW_COORD: u32 = 20000;
/// 位置容错边距（像素）：窗口与显示器的重叠在宽、高上都达到该值才算「可见」。
const VISIBLE_MARGIN: i32 = 40;
/// 移动/缩放落盘防抖窗口：500ms 内只写一次。
const GEOMETRY_DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(500);
/// 缩放因子上限：Windows 单屏缩放最高 500%，留一倍余量，用于挡住脏数据。
const MAX_SCALE_FACTOR: f64 = 10.0;
/// 重映射后逻辑尺寸的合法区间：换算结果超出该区间说明 scale/物理尺寸已损坏，退回物理逻辑。
const MIN_LOGICAL_SIZE: f64 = 100.0;
const MAX_LOGICAL_SIZE: f64 = MAX_WINDOW_SIZE as f64;
/// 逻辑坐标绝对值上限（与物理坐标同口径）。
const MAX_LOGICAL_COORD: f64 = MAX_WINDOW_COORD as f64;

/// 几何是否合理：宽高在 [400, 10000]，坐标绝对值不超过 20000。
fn geometry_is_sane(geometry: &WindowGeometry) -> bool {
    (MIN_WINDOW_SIZE..=MAX_WINDOW_SIZE).contains(&geometry.width)
        && (MIN_WINDOW_SIZE..=MAX_WINDOW_SIZE).contains(&geometry.height)
        // 用 unsigned_abs 而不是 abs：i32::MIN 上 abs 会溢出 panic
        && geometry.x.unsigned_abs() <= MAX_WINDOW_COORD
        && geometry.y.unsigned_abs() <= MAX_WINDOW_COORD
}

/// 保存的位置是否仍落在某台显示器的可见区域内。
/// 判定口径：窗口矩形与某台显示器矩形的重叠，宽和高都要 ≥ `margin` 像素（容错边距）。
/// 拿不到显示器列表时返回 false —— 宁可不设位置改居中，也不要开出一扇看不见的窗口。
fn position_visible(x: i32, y: i32, width: u32, height: u32, screens: &[ScreenRect], margin: i32) -> bool {
    if screens.is_empty() {
        return false;
    }
    let clamp = |value: u32| -> i32 { value.min(i32::MAX as u32) as i32 };
    let left = x;
    let top = y;
    let right = x.saturating_add(clamp(width));
    let bottom = y.saturating_add(clamp(height));
    screens.iter().any(|screen| {
        let screen_right = screen.x.saturating_add(clamp(screen.width));
        let screen_bottom = screen.y.saturating_add(clamp(screen.height));
        let overlap_width = right.min(screen_right) - left.max(screen.x);
        let overlap_height = bottom.min(screen_bottom) - top.max(screen.y);
        overlap_width >= margin && overlap_height >= margin
    })
}

/// 纯函数：按保存的显示器指纹，把窗口几何换算成目标显示器上的逻辑坐标/尺寸。
/// 返回 `None` 表示**不做**重映射（没有指纹、找不到同名显示器、或数值非法），
/// 调用方应退回物理像素逻辑。任何输入都不 panic。
///
/// 换算口径：逻辑尺寸 = 保存的物理尺寸 / 保存时的 scale（即「当时看起来」的大小），
/// 逻辑位置 = 当前显示器逻辑原点 + 保存的逻辑偏移（同一块屏幕上相对位置不变）。
fn remap_to_monitor(geometry: &WindowGeometry, monitors: &[MonitorSnapshot]) -> Option<LogicalTarget> {
    let saved = geometry.monitor.as_ref()?;
    // scale 缺失（旧文件默认 0.0）或非法：无法把物理尺寸换算成逻辑尺寸，退回旧逻辑
    let saved_scale = saved.scale_factor;
    if !saved_scale.is_finite() || saved_scale <= 0.0 || saved_scale > MAX_SCALE_FACTOR {
        return None;
    }
    if !saved.offset_x.is_finite() || !saved.offset_y.is_finite() {
        return None;
    }
    if saved.offset_x.abs() > MAX_LOGICAL_COORD || saved.offset_y.abs() > MAX_LOGICAL_COORD {
        return None;
    }
    // 只有同名显示器才敢套用偏移：换了显示器/单屏切换时偏移量没有可移植性。
    // 名称为空或缺失时也无法匹配（None 绝不与 None 相等）。
    let name = saved.name.as_deref().filter(|name| !name.is_empty())?;
    let target = monitors
        .iter()
        .find(|monitor| monitor.name.as_deref() == Some(name))?;
    if !target.scale_factor.is_finite() || target.scale_factor <= 0.0 {
        return None;
    }

    let width = geometry.width as f64 / saved_scale;
    let height = geometry.height as f64 / saved_scale;
    let x = target.logical_x + saved.offset_x;
    let y = target.logical_y + saved.offset_y;
    // NaN/无穷一律拒绝（NaN 的比较结果恒为 false，必须先判 is_finite）
    if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
        return None;
    }
    if x.abs() > MAX_LOGICAL_COORD || y.abs() > MAX_LOGICAL_COORD {
        return None;
    }
    if !(MIN_LOGICAL_SIZE..=MAX_LOGICAL_SIZE).contains(&width)
        || !(MIN_LOGICAL_SIZE..=MAX_LOGICAL_SIZE).contains(&height)
    {
        return None;
    }

    Some(LogicalTarget {
        x,
        y,
        width,
        height,
        scale_factor: target.scale_factor,
    })
}

/// 由 tauri 的显示器对象构造快照。scale 非法（0/负/NaN/超界）时返回 None，
/// 该显示器不参与重映射，调用方自然退回物理像素逻辑。
#[cfg(desktop)]
fn snapshot_of(monitor: &tauri::Monitor) -> Option<MonitorSnapshot> {
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 || scale > MAX_SCALE_FACTOR {
        return None;
    }
    let origin = monitor.position();
    Some(MonitorSnapshot {
        name: monitor.name().map(|name| name.to_string()),
        logical_x: origin.x as f64 / scale,
        logical_y: origin.y as f64 / scale,
        scale_factor: scale,
    })
}

/// 窗口几何文件：放在数据目录内，与其他状态文件同处。
#[cfg(desktop)]
fn window_geometry_path() -> PathBuf {
    data_dir().join("window.json")
}

/// 读取并校验窗口几何。缺失、损坏或数值不合理都返回 None（用默认值），绝不 panic、不弹窗。
#[cfg(desktop)]
fn read_window_geometry() -> Option<WindowGeometry> {
    let path = window_geometry_path();
    let Some(geometry) = read_json::<WindowGeometry>(&path) else {
        if path.exists() {
            append_log("窗口几何文件不可解析，按默认值处理");
        }
        return None;
    };
    if !geometry_is_sane(&geometry) {
        append_log(&format!(
            "窗口几何不合理，按默认值处理: {}x{} @ ({},{})",
            geometry.width, geometry.height, geometry.x, geometry.y
        ));
        return None;
    }
    Some(geometry)
}

/// 落盘并记日志。数值不合理时不写入，保留上一次的有效值。
#[cfg(desktop)]
fn save_window_geometry(geometry: &WindowGeometry) -> bool {
    if !geometry_is_sane(geometry) {
        return false;
    }
    if !write_json(&window_geometry_path(), geometry) {
        append_log("窗口几何写入失败");
        return false;
    }
    append_log(&format!(
        "窗口几何已保存: {}x{} @ ({},{}) 最大化={}",
        geometry.width, geometry.height, geometry.x, geometry.y, geometry.maximized
    ));
    true
}

/// 待落盘的最新几何：防抖期间的多次事件只保留最后一个值。
#[cfg(desktop)]
static GEOMETRY_PENDING: std::sync::Mutex<Option<WindowGeometry>> = std::sync::Mutex::new(None);
/// 是否已有计时线程在等待落盘，保证每 500ms 最多起一个线程。
#[cfg(desktop)]
static GEOMETRY_TIMER_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// 最大化前最后一次普通状态的几何：最大化时保存它，避免之后「还原」出铺满屏幕的窗口。
#[cfg(desktop)]
static GEOMETRY_LAST_NORMAL: std::sync::Mutex<Option<WindowGeometry>> = std::sync::Mutex::new(None);

/// 记录窗口所在显示器的指纹：名称、当前 scale，以及窗口相对该显示器逻辑原点的偏移。
/// 拿不到显示器信息时返回 None —— 几何照旧保存，只是不含指纹（恢复时走物理像素逻辑）。
#[cfg(desktop)]
fn capture_monitor_ref(
    window: &tauri::WebviewWindow,
    position: tauri::PhysicalPosition<i32>,
) -> Option<MonitorRef> {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => Some(monitor),
        Ok(None) => None,
        Err(error) => {
            append_log(&format!("获取窗口所在显示器失败: {error}"));
            None
        }
    };
    // 跨屏或窗口刚建立时 current_monitor 可能为空：退回主显示器，总比没有指纹强
    let monitor = match monitor.or_else(|| window.primary_monitor().ok().flatten()) {
        Some(monitor) => monitor,
        None => {
            append_log("拿不到显示器信息，本次窗口几何不含显示器指纹");
            return None;
        }
    };
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let origin = monitor.position();
    // 逻辑偏移 = 物理偏移 / 当前 scale；用 saturating_sub 防止极端坐标溢出
    let offset_x = position.x.saturating_sub(origin.x) as f64 / scale;
    let offset_y = position.y.saturating_sub(origin.y) as f64 / scale;
    if !offset_x.is_finite() || !offset_y.is_finite() {
        return None;
    }
    Some(MonitorRef {
        name: monitor.name().map(|name| name.to_string()),
        scale_factor: scale,
        offset_x,
        offset_y,
    })
}

/// 取当前窗口几何。最小化期间尺寸没有意义，返回 None 跳过本次保存。
#[cfg(desktop)]
fn capture_window_geometry(window: &tauri::WebviewWindow) -> Option<WindowGeometry> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    // 用内尺寸：tauri 的 set_size 设的就是内尺寸，二者配套才能原样往返
    let size = window.inner_size().ok()?;
    let position = window.outer_position().ok()?;
    let current = WindowGeometry {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        maximized,
        monitor: capture_monitor_ref(window, position),
    };
    if !maximized {
        if let Ok(mut slot) = GEOMETRY_LAST_NORMAL.lock() {
            *slot = Some(current.clone());
        }
        return Some(current);
    }
    // 最大化时的尺寸/坐标是铺满屏幕的值：改用最大化前的普通几何，
    // 这样用户之后点「还原」仍能得到原来的大小与位置。
    match GEOMETRY_LAST_NORMAL.lock().ok().and_then(|slot| slot.clone()) {
        Some(mut normal) => {
            normal.maximized = true;
            Some(normal)
        }
        None => Some(current),
    }
}

/// 防抖落盘：500ms 内的多次移动/缩放只写一次。
#[cfg(desktop)]
fn schedule_geometry_save(window: &tauri::WebviewWindow) {
    let Some(geometry) = capture_window_geometry(window) else {
        return;
    };
    if let Ok(mut slot) = GEOMETRY_PENDING.lock() {
        *slot = Some(geometry);
    }
    if GEOMETRY_TIMER_RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return; // 已有计时线程在等待，本次事件的值已并入待写入
    }
    std::thread::spawn(|| {
        std::thread::sleep(GEOMETRY_DEBOUNCE);
        GEOMETRY_TIMER_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
        let pending = GEOMETRY_PENDING.lock().ok().and_then(|mut slot| slot.take());
        if let Some(geometry) = pending {
            save_window_geometry(&geometry);
        }
    });
}

/// 关窗/退出等时机立即落盘：丢弃排队中的旧值，改写成当前值。
#[cfg(desktop)]
fn save_geometry_now(window: &tauri::WebviewWindow) {
    if let Ok(mut slot) = GEOMETRY_PENDING.lock() {
        *slot = None;
    }
    if let Some(geometry) = capture_window_geometry(window) {
        save_window_geometry(&geometry);
    }
}

/// 恢复主窗口几何。决策顺序：
/// 1. 读 `window.json`；缺失/损坏/数值不合理 → 直接用默认几何，什么都不做；
/// 2. 采集当前显示器：物理矩形用于可见性判断，逻辑原点 + 当前 scale 用于 DPI 重映射；
/// 3. 若保存的显示器**名称能在当前 `available_monitors()` 里找到**且数值合法 →
///    **DPI 重映射**：逻辑尺寸 = 保存的物理尺寸 / 保存时的 scale，
///    逻辑位置 = 当前显示器逻辑原点 + 保存的逻辑偏移，用 `LogicalSize`/`LogicalPosition` 落位，
///    由系统按新缩放换算成物理像素；
/// 4. 找不到同名显示器（换显示器/单屏切换）或指纹缺失/非法 → **退回旧的物理像素逻辑**：
///    先 `set_size(PhysicalSize)`，位置按 40px（`VISIBLE_MARGIN`）重叠容错判断，
///    不可见则居中；
/// 5. 最后按保存的 `maximized` 决定是否最大化。
/// 任何一步失败都只写 `append_log`，不 panic、不弹窗。
#[cfg(desktop)]
fn restore_main_window_geometry(window: &tauri::WebviewWindow) {
    let Some(geometry) = read_window_geometry() else {
        return;
    };

    // 显示器信息只取一次：物理矩形给可见性判断，逻辑快照给重映射
    let (screens, snapshots) = match window.available_monitors() {
        Ok(monitors) => (
            monitors
                .iter()
                .map(|monitor| ScreenRect {
                    x: monitor.position().x,
                    y: monitor.position().y,
                    width: monitor.size().width,
                    height: monitor.size().height,
                })
                .collect::<Vec<ScreenRect>>(),
            monitors.iter().filter_map(snapshot_of).collect::<Vec<MonitorSnapshot>>(),
        ),
        Err(error) => {
            append_log(&format!("获取显示器信息失败: {error}"));
            (Vec::new(), Vec::new())
        }
    };

    // 先算重映射目标：命中同名显示器才走逻辑坐标，否则一律退回物理像素
    let target = remap_to_monitor(&geometry, &snapshots);

    let position_note = match target {
        Some(target) => {
            // 重映射路径：逻辑尺寸 + 逻辑坐标，交给系统按当前缩放渲染
            if let Err(error) = window.set_size(tauri::LogicalSize::new(target.width, target.height)) {
                append_log(&format!("恢复窗口尺寸失败: {error}"));
            }
            if let Err(error) = window.set_position(tauri::LogicalPosition::new(target.x, target.y)) {
                append_log(&format!("恢复窗口位置失败: {error}"));
            }
            let monitor_name = geometry
                .monitor
                .as_ref()
                .and_then(|monitor| monitor.name.as_deref())
                .unwrap_or("未知显示器");
            append_log(&format!(
                "窗口几何已按显示器 {monitor_name}（scale {}）重映射: {}x{} @ ({:.0},{:.0})",
                target.scale_factor, target.width, target.height, target.x, target.y
            ));
            format!("({:.0},{:.0})（逻辑重映射）", target.x, target.y)
        }
        None => {
            // 回退路径：沿用旧的物理像素逻辑
            if let Err(error) = window.set_size(tauri::PhysicalSize::new(geometry.width, geometry.height)) {
                append_log(&format!("恢复窗口尺寸失败: {error}"));
            }
            append_log(&format!(
                "窗口几何未重映射（{}），按物理像素恢复",
                remap_skip_reason(&geometry, &snapshots)
            ));
            if position_visible(
                geometry.x,
                geometry.y,
                geometry.width,
                geometry.height,
                &screens,
                VISIBLE_MARGIN,
            ) {
                if let Err(error) = window.set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y)) {
                    append_log(&format!("恢复窗口位置失败: {error}"));
                }
                format!("({},{})", geometry.x, geometry.y)
            } else {
                // 保存的位置已不在任何显示器可见区域内：只应用大小，位置改为居中。
                if let Err(error) = window.center() {
                    append_log(&format!("窗口居中失败: {error}"));
                }
                format!("居中（原位置 ({},{}) 不在可见区域）", geometry.x, geometry.y)
            }
        }
    };

    // 记录普通状态几何，供之后最大化时保存使用
    if let Ok(mut slot) = GEOMETRY_LAST_NORMAL.lock() {
        *slot = Some(WindowGeometry { maximized: false, ..geometry.clone() });
    }

    if geometry.maximized {
        if let Err(error) = window.maximize() {
            append_log(&format!("恢复最大化失败: {error}"));
        }
    }

    append_log(&format!(
        "窗口几何已恢复: {}x{} @ {} 最大化={}",
        geometry.width, geometry.height, position_note, geometry.maximized
    ));
}

/// 没走重映射的原因，仅用于日志（判断口径与 `remap_to_monitor` 的提前返回一一对应）。
fn remap_skip_reason(geometry: &WindowGeometry, monitors: &[MonitorSnapshot]) -> String {
    let Some(saved) = geometry.monitor.as_ref() else {
        return "旧文件无显示器信息".to_string();
    };
    match saved.name.as_deref().filter(|name| !name.is_empty()) {
        None => "文件未记录显示器名称".to_string(),
        Some(name) => {
            if monitors.iter().any(|monitor| monitor.name.as_deref() == Some(name)) {
                // 名称能对上却仍被拒：只可能是 scale/偏移/换算结果非法
                "显示器指纹数值非法".to_string()
            } else {
                format!("当前没有名为 {name} 的显示器")
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ensure_console();
    install_panic_logger();
    append_log(&format!("应用启动 v{APP_VERSION}"));

    // 先判单实例：已有实例时直接唤回它的窗口并退出，不触碰 WebView2 目录
    #[cfg(windows)]
    match decide_instance() {
        InstanceRole::FocusExisting => {
            focus_main_window();
            append_log("本次启动退出");
            return;
        }
        InstanceRole::Owner => write_instance_state(),
    }

    // 先套用排队的恢复请求：必须在打开数据库之前完成
    apply_pending_restore();

    #[cfg(windows)]
    ensure_webview_folder_writable();

    #[cfg(windows)]
    log_database_status();

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
            open_import_window,
            close_import_window,
            submit_page_import,
            show_widget,
            hide_widget,
            tray_status,
            open_external_url,
            open_log_dir,
            write_text_file,
            write_binary_file
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
        .plugin(tauri_plugin_dialog::init());

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
                        append_log("按设置隐藏主窗口，仅驻留托盘");
                    } else if let Err(error) = window.show() {
                        append_log(&format!("显示主窗口失败: {error}"));
                    }
                }
                None => append_log("未找到主窗口"),
            }

            // 托盘失败不阻止应用启动，仅记录
            if let Err(error) = setup_tray(app.handle()) {
                append_log(&format!("托盘初始化失败: {error}"));
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
        let message = format!("运行 Tauri 应用失败: {error}");
        append_log(&message);
        eprintln!("{message}");
        show_error_box("晓刻 DawnTick 启动失败", &message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare_detects_newer() {
        assert!(version_is_newer("0.2.0", "0.1.9"));
        assert!(version_is_newer("0.1.1", "0.1.0"));
        assert!(version_is_newer("1.0.0-beta.2", "0.9.9"));
        assert!(version_is_newer("0.1.10", "0.1.9"));
        assert!(!version_is_newer("0.1.0", "0.1.0"));
        assert!(!version_is_newer("0.0.9", "0.1.0"));
        assert!(!version_is_newer("0.1.0-beta.1", "0.1.0"));
    }

    #[test]
    fn hidden_only_for_autostart_launch() {
        let hide = StartupPrefs { hidden: true };
        let show = StartupPrefs { hidden: false };
        let autostart = vec!["DawnTick.exe".to_string(), HIDDEN_ARG.to_string()];
        let manual = vec!["DawnTick.exe".to_string()];

        assert!(hidden_for_launch(&autostart, &hide));
        assert!(!hidden_for_launch(&autostart, &show));
        assert!(!hidden_for_launch(&manual, &hide));
        assert!(!hidden_for_launch(&manual, &show));
    }

    #[test]
    fn log_timestamp_matches_local_offset() {
        assert_eq!(format_log_timestamp(0, 0), "1970-01-01 00:00:00.000 +00:00");
        assert_eq!(format_log_timestamp(0, 480), "1970-01-01 08:00:00.000 +08:00");
        assert_eq!(format_log_timestamp(0, -330), "1969-12-31 18:30:00.000 -05:30");
        assert_eq!(format_log_timestamp(1_700_000_000_000, 0), "2023-11-14 22:13:20.000 +00:00");
        assert_eq!(
            format_log_timestamp(1_700_000_000_123, 480),
            "2023-11-15 06:13:20.123 +08:00"
        );
    }

    #[test]
    fn log_prefix_has_local_offset() {
        let prefix = log_prefix();
        let chars: Vec<char> = prefix.chars().collect();
        assert_eq!(chars.len(), 31, "{prefix}");
        assert_eq!(chars[10], ' ');
        assert_eq!(chars[23], ' ');
        assert!(chars[24] == '+' || chars[24] == '-', "{prefix}");
        assert_eq!(chars[30], ' ');
    }

    #[test]
    fn external_link_scheme_is_restricted() {
        assert!(external_url_is_allowed("https://github.com/muyangplus/dawn-tick-presets"));
        assert!(external_url_is_allowed("HTTP://example.com/issue/new?template=request-school.yml"));
        assert!(!external_url_is_allowed("file:///C:/Windows/System32"));
        assert!(!external_url_is_allowed("javascript:alert(1)"));
        assert!(!external_url_is_allowed("C:\\Windows\\System32\\calc.exe"));
        assert!(!external_url_is_allowed("https://example.com/\r\ncalc"));
        assert!(!external_url_is_allowed("https://example.com/\"quoted\""));
    }

    #[test]
    fn version_parse_handles_suffixes() {
        assert_eq!(parse_version("1.2.3"), (1, 2, 3));
        assert_eq!(parse_version("1.2.3-beta.4"), (1, 2, 3));
        assert_eq!(parse_version("1.2"), (1, 2, 0));
        assert_eq!(parse_version("oops"), (0, 0, 0));
    }

    #[cfg(windows)]
    #[test]
    fn our_app_name_matching() {
        assert!(is_our_app("DawnTick.exe"));
        assert!(is_our_app("dawn-tick-desktop.exe"));
        assert!(is_our_app("DAWNTICK.EXE"));
        assert!(!is_our_app("msedgewebview2.exe"));
        assert!(!is_our_app("explorer.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn registry_write_read_delete_roundtrip() {
        use windows_sys::Win32::System::Registry::HKEY_CURRENT_USER;
        // 用临时子键，避免触碰真实启动项
        let key_path = "Software\\DawnTickTest";
        let value_name = "Probe";
        let sample = "\"C:\\tmp\\DawnTick.exe\" --hidden";

        match autostart_reg::write_to(HKEY_CURRENT_USER, key_path, value_name, sample) {
            Ok(()) => {}
            Err(error) if error.contains("代码 5") => {
                // 受限令牌下无法写 HKCU，跳过而不是误报
                eprintln!("跳过：当前进程无权写注册表（{error}）");
                return;
            }
            Err(error) => panic!("写入失败: {error}"),
        }
        assert_eq!(
            autostart_reg::read_from(HKEY_CURRENT_USER, key_path, value_name).as_deref(),
            Some(sample),
            "读回内容应与写入一致"
        );
        assert!(
            autostart_reg::remove_from(HKEY_CURRENT_USER, key_path, value_name),
            "删除应成功"
        );
        assert!(
            autostart_reg::read_from(HKEY_CURRENT_USER, key_path, value_name).is_none(),
            "删除后应读不到"
        );
    }

    #[test]
    fn autostart_command_contains_hidden_flag() {
        #[cfg(windows)]
        {
            let command = autostart_reg::command_line().expect("应能取到程序路径");
            assert!(command.contains(HIDDEN_ARG), "启动项需带 --hidden: {command}");
            assert!(command.starts_with('"'), "程序路径需加引号: {command}");
        }
    }

    fn geometry(width: u32, height: u32, x: i32, y: i32, maximized: bool) -> WindowGeometry {
        WindowGeometry { width, height, x, y, maximized, monitor: None }
    }

    /// 带显示器指纹的几何：物理尺寸 + 保存时的显示器（名称/scale/逻辑偏移）。
    fn geometry_on_monitor(
        width: u32,
        height: u32,
        x: i32,
        y: i32,
        name: Option<&str>,
        scale: f64,
        offset: (f64, f64),
    ) -> WindowGeometry {
        WindowGeometry {
            width,
            height,
            x,
            y,
            maximized: false,
            monitor: Some(MonitorRef {
                name: name.map(|name| name.to_string()),
                scale_factor: scale,
                offset_x: offset.0,
                offset_y: offset.1,
            }),
        }
    }

    /// 当前显示器快照：物理原点 (origin_x, origin_y) 按当前 scale 换算成逻辑原点。
    fn snapshot(name: Option<&str>, origin_x: i32, origin_y: i32, scale: f64) -> MonitorSnapshot {
        MonitorSnapshot {
            name: name.map(|name| name.to_string()),
            logical_x: origin_x as f64 / scale,
            logical_y: origin_y as f64 / scale,
            scale_factor: scale,
        }
    }

    #[test]
    fn geometry_accepts_normal_values() {
        assert!(geometry_is_sane(&geometry(1200, 800, 100, 80, false)));
        assert!(geometry_is_sane(&geometry(1000, 720, 0, 0, true)));
        // 边界值本身合法
        assert!(geometry_is_sane(&geometry(MIN_WINDOW_SIZE, MIN_WINDOW_SIZE, 0, 0, false)));
        assert!(geometry_is_sane(&geometry(MAX_WINDOW_SIZE, MAX_WINDOW_SIZE, 0, 0, false)));
        // 副屏在主屏左侧/上方时为负坐标，仍然合法
        assert!(geometry_is_sane(&geometry(1200, 800, -1920, -200, false)));
    }

    #[test]
    fn geometry_rejects_bad_sizes_and_coords() {
        assert!(!geometry_is_sane(&geometry(MIN_WINDOW_SIZE - 1, 800, 0, 0, false)));
        assert!(!geometry_is_sane(&geometry(1200, MIN_WINDOW_SIZE - 1, 0, 0, false)));
        assert!(!geometry_is_sane(&geometry(MAX_WINDOW_SIZE + 1, 800, 0, 0, false)));
        assert!(!geometry_is_sane(&geometry(1200, MAX_WINDOW_SIZE + 1, 0, 0, false)));
        // 最小化过程中可能出现的 0 尺寸
        assert!(!geometry_is_sane(&geometry(0, 0, 0, 0, false)));
        assert!(!geometry_is_sane(&geometry(1200, 800, 20001, 0, false)));
        assert!(!geometry_is_sane(&geometry(1200, 800, 0, -20001, false)));
        // i32::MIN 不能让校验 panic
        assert!(!geometry_is_sane(&geometry(1200, 800, i32::MIN, 0, false)));
        assert!(!geometry_is_sane(&geometry(1200, 800, 0, i32::MIN, false)));
    }

    #[test]
    fn geometry_json_roundtrip_matches_spec() {
        let text = r#"{"width":1200,"height":800,"x":100,"y":80,"maximized":false}"#;
        let parsed: WindowGeometry = serde_json::from_str(text).expect("应能解析");
        assert_eq!(parsed, geometry(1200, 800, 100, 80, false));
        assert_eq!(serde_json::to_string(&parsed).expect("应能序列化"), text);
        // 字段缺失 / 损坏一律按默认值处理
        assert!(serde_json::from_str::<WindowGeometry>(r#"{"width":1200}"#).is_err());
        assert!(serde_json::from_str::<WindowGeometry>("not json").is_err());
    }

    /// 旧文件没有 monitor 字段：照旧解析、照旧写回，一个字节都不变。
    #[test]
    fn geometry_old_file_without_monitor_still_parses() {
        let text = r#"{"width":1532,"height":978,"x":175,"y":138,"maximized":false}"#;
        let parsed: WindowGeometry = serde_json::from_str(text).expect("旧文件应能解析");
        assert_eq!(parsed, geometry(1532, 978, 175, 138, false));
        assert!(parsed.monitor.is_none(), "旧文件不应凭空得到显示器指纹");
        assert_eq!(serde_json::to_string(&parsed).expect("应能序列化"), text);
    }

    /// monitor 子字段缺失（手改过的文件）不能解析失败：scale 兜底为 0.0，重映射因此退回物理逻辑。
    #[test]
    fn monitor_field_with_missing_scale_falls_back() {
        let parsed: WindowGeometry = serde_json::from_str(
            r#"{"width":1200,"height":800,"x":0,"y":0,"maximized":false,"monitor":{"name":"屏A","offset_x":10.0,"offset_y":20.0}}"#,
        )
        .expect("monitor 子字段缺失也应能解析");
        let saved = parsed.monitor.clone().expect("应带显示器指纹");
        assert_eq!(saved.scale_factor, 0.0, "缺失的 scale 兜底为 0.0");
        assert!(remap_to_monitor(&parsed, &[snapshot(Some("屏A"), 0, 0, 1.0)]).is_none());
        assert_eq!(remap_skip_reason(&parsed, &[snapshot(Some("屏A"), 0, 0, 1.0)]), "显示器指纹数值非法");
    }

    /// 带显示器指纹的 JSON 往返：字段名与形态固定。
    #[test]
    fn geometry_json_roundtrip_with_monitor() {
        let saved = geometry_on_monitor(1600, 1000, 1920, 0, Some("DELL U2720Q"), 1.5, (100.0, 50.0));
        let text = serde_json::to_string(&saved).expect("应能序列化");
        assert_eq!(
            text,
            r#"{"width":1600,"height":1000,"x":1920,"y":0,"maximized":false,"monitor":{"name":"DELL U2720Q","scale_factor":1.5,"offset_x":100.0,"offset_y":50.0}}"#
        );
        assert_eq!(serde_json::from_str::<WindowGeometry>(&text).expect("应能解析"), saved);
        // 拿不到显示器名称时省略 name 字段，仍然可解析
        let nameless = geometry_on_monitor(1200, 800, 0, 0, None, 1.0, (0.0, 0.0));
        let text = serde_json::to_string(&nameless).expect("应能序列化");
        assert!(!text.contains("name"), "名称为 None 时不写 name: {text}");
        assert_eq!(serde_json::from_str::<WindowGeometry>(&text).expect("应能解析"), nameless);
    }

    /// 同名显示器 + scale 变化：位置按逻辑偏移重算，尺寸按保存时的逻辑尺寸。
    #[test]
    fn remap_uses_same_monitor_and_new_scale() {
        // 保存时：scale 1.0，窗口物理 1600x1000，逻辑偏移 (300,200)
        let saved = geometry_on_monitor(1600, 1000, 1920 + 300, 200, Some("DELL U2720Q"), 1.0, (300.0, 200.0));
        // 现在的布局：外接屏物理原点 x=1600，当前缩放 1.25 → 逻辑原点 (1280,0)
        let monitors = [
            snapshot(Some("内置屏"), 0, 0, 1.25),
            snapshot(Some("DELL U2720Q"), 1600, 0, 1.25),
        ];
        let target = remap_to_monitor(&saved, &monitors).expect("同名显示器应能重映射");
        assert_eq!((target.width, target.height), (1600.0, 1000.0), "逻辑尺寸 = 物理尺寸 / 保存时 scale");
        assert_eq!((target.x, target.y), (1580.0, 200.0), "逻辑位置 = 显示器当前逻辑原点 + 保存的逻辑偏移");
        assert_eq!(target.scale_factor, 1.25);

        // 反向：高 DPI 下保存（scale 2.0），在 100% 显示器上恢复 → 逻辑尺寸只有一半的物理值
        let saved_hi = geometry_on_monitor(2400, 1600, 100, 50, Some("高 DPI 屏"), 2.0, (50.0, 25.0));
        let target = remap_to_monitor(&saved_hi, &[snapshot(Some("高 DPI 屏"), 0, 0, 1.0)])
            .expect("应能重映射");
        assert_eq!(
            (target.x, target.y, target.width, target.height),
            (50.0, 25.0, 1200.0, 800.0)
        );

        // 同一块屏但周围布局变了（左侧多了副屏）：逻辑原点变负，仍按偏移落位
        let moved = remap_to_monitor(&saved, &[snapshot(Some("DELL U2720Q"), -2560, 0, 1.25)])
            .expect("应能重映射");
        assert_eq!((moved.x, moved.y), (-1748.0, 200.0));
    }

    /// 找不到同名显示器（换屏/单屏切换/枚举失败）：一律退回物理像素逻辑。
    #[test]
    fn remap_falls_back_when_monitor_not_found() {
        let monitors = [snapshot(Some("内置屏"), 0, 0, 1.5)];
        let unplugged = geometry_on_monitor(1200, 800, 100, 80, Some("已拔掉的外接屏"), 1.0, (100.0, 80.0));
        assert!(remap_to_monitor(&unplugged, &monitors).is_none());
        assert!(remap_skip_reason(&unplugged, &monitors).contains("已拔掉的外接屏"));

        // 旧文件没有指纹
        let legacy = geometry(1200, 800, 100, 80, false);
        assert!(remap_to_monitor(&legacy, &monitors).is_none());
        assert_eq!(remap_skip_reason(&legacy, &monitors), "旧文件无显示器信息");

        // 保存与当前都没有名称 / 名称为空串：都不算同名
        let nameless = geometry_on_monitor(1200, 800, 100, 80, None, 1.0, (100.0, 80.0));
        assert!(remap_to_monitor(&nameless, &[snapshot(None, 0, 0, 1.0)]).is_none());
        let empty = geometry_on_monitor(1200, 800, 100, 80, Some(""), 1.0, (100.0, 80.0));
        assert!(remap_to_monitor(&empty, &[snapshot(Some(""), 0, 0, 1.0)]).is_none());
        assert_eq!(remap_skip_reason(&nameless, &monitors), "文件未记录显示器名称");

        // 枚举显示器失败（空列表）
        assert!(remap_to_monitor(&unplugged, &[]).is_none());
    }

    /// 极端 / 非法输入：不 panic，一律退回 None。
    #[test]
    fn remap_rejects_invalid_input_without_panic() {
        let good = [snapshot(Some("屏A"), 0, 0, 2.0)];
        let ok = geometry_on_monitor(1200, 800, 0, 0, Some("屏A"), 1.0, (0.0, 0.0));
        assert!(remap_to_monitor(&ok, &good).is_some(), "正常输入应能重映射");

        // scale 非法：0（字段缺失的兜底值）/ 负数 / 无穷 / NaN / 超界
        for scale in [0.0, -1.5, f64::INFINITY, f64::NAN, MAX_SCALE_FACTOR * 2.0] {
            let saved = geometry_on_monitor(1200, 800, 0, 0, Some("屏A"), scale, (10.0, 10.0));
            assert!(remap_to_monitor(&saved, &good).is_none(), "scale={scale} 应被拒绝");
        }
        // 偏移非法：NaN / 无穷 / 超界
        for offset in [f64::NAN, f64::INFINITY, -f64::INFINITY, MAX_LOGICAL_COORD * 2.0] {
            let saved = geometry_on_monitor(1200, 800, 0, 0, Some("屏A"), 1.0, (offset, offset));
            assert!(remap_to_monitor(&saved, &good).is_none(), "offset={offset} 应被拒绝");
        }
        // 显示器逻辑原点为 NaN → 拒绝
        let nan_monitor = MonitorSnapshot {
            name: Some("屏A".to_string()),
            logical_x: f64::NAN,
            logical_y: 0.0,
            scale_factor: 1.0,
        };
        let saved = geometry_on_monitor(1200, 800, 0, 0, Some("屏A"), 1.0, (0.0, 0.0));
        assert!(remap_to_monitor(&saved, &[nan_monitor]).is_none());
        // 当前显示器 scale 非法 → 拒绝
        let bad_scale_monitor = MonitorSnapshot {
            name: Some("屏A".to_string()),
            logical_x: 0.0,
            logical_y: 0.0,
            scale_factor: 0.0,
        };
        assert!(remap_to_monitor(&saved, &[bad_scale_monitor]).is_none());

        // 换算出的逻辑尺寸超出 [MIN_LOGICAL_SIZE, MAX_LOGICAL_SIZE] → 拒绝
        let tiny = geometry_on_monitor(MIN_WINDOW_SIZE, MIN_WINDOW_SIZE, 0, 0, Some("屏A"), 9.0, (0.0, 0.0));
        assert!(remap_to_monitor(&tiny, &good).is_none(), "逻辑尺寸过小应被拒绝");
        let huge = geometry_on_monitor(u32::MAX, u32::MAX, 0, 0, Some("屏A"), 1.0, (0.0, 0.0));
        assert!(remap_to_monitor(&huge, &good).is_none(), "逻辑尺寸过大应被拒绝");
        // 极端物理坐标 + 极端偏移不能让自己溢出成 NaN/无穷
        let extreme = geometry_on_monitor(1200, 800, i32::MIN, i32::MAX, Some("屏A"), 1.0, (MAX_LOGICAL_COORD, -MAX_LOGICAL_COORD));
        let _ = remap_to_monitor(&extreme, &good);
    }

    /// 找一个可写的临时目录：优先系统临时目录，受限环境（只允许写工作区）退回 target 下。
    #[cfg(desktop)]
    fn scratch_dir(name: &str) -> PathBuf {
        let candidates = [
            std::env::temp_dir().join(name),
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join(name),
        ];
        for candidate in candidates {
            let _ = std::fs::remove_dir_all(&candidate);
            if std::fs::create_dir_all(&candidate).is_ok() {
                return candidate;
            }
        }
        panic!("找不到可写的临时目录");
    }

    /// 落盘/读取的完整往返：用临时目录顶替 APPDATA，避免污染真实数据目录。
    #[cfg(desktop)]
    #[test]
    fn geometry_file_roundtrip_uses_data_dir() {
        let temp = scratch_dir(&format!("dawntick-geometry-test-{}", std::process::id()));
        let previous_appdata = std::env::var("APPDATA").ok();
        let previous_local = std::env::var("LOCALAPPDATA").ok();
        std::env::set_var("APPDATA", &temp);
        std::env::set_var("LOCALAPPDATA", &temp);

        let file = temp.join("com.dawntick.app").join("window.json");
        // 文件缺失：按默认值处理
        assert!(read_window_geometry().is_none());

        // 写入后能原样读回，且落在 <data_dir>\window.json
        let sample = geometry(1200, 800, 100, 80, false);
        assert!(save_window_geometry(&sample), "写入应成功");
        assert!(file.exists(), "文件应位于 {}", file.display());
        assert_eq!(read_window_geometry(), Some(sample));

        // 损坏内容按默认值处理
        std::fs::write(&file, "{不是 JSON").expect("写坏文件");
        assert!(read_window_geometry().is_none());

        // 数值不合理按默认值处理，且不覆盖上一次的有效内容
        std::fs::write(&file, r#"{"width":10,"height":10,"x":0,"y":0,"maximized":false}"#).expect("写小尺寸");
        assert!(read_window_geometry().is_none());
        assert!(!save_window_geometry(&geometry(10, 10, 0, 0, false)), "不合理数值不落盘");

        // 还原环境变量并清理
        match previous_appdata {
            Some(value) => std::env::set_var("APPDATA", value),
            None => std::env::remove_var("APPDATA"),
        }
        match previous_local {
            Some(value) => std::env::set_var("LOCALAPPDATA", value),
            None => std::env::remove_var("LOCALAPPDATA"),
        }
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn position_visible_requires_overlap_margin() {
        let screens = [
            ScreenRect { x: 0, y: 0, width: 1920, height: 1080 },
            ScreenRect { x: -1920, y: 0, width: 1920, height: 1080 },
        ];

        // 完全在主屏内
        assert!(position_visible(100, 80, 1200, 800, &screens, VISIBLE_MARGIN));
        // 在左侧副屏内（负坐标）
        assert!(position_visible(-1900, 0, 1200, 800, &screens, VISIBLE_MARGIN));
        // 贴着主屏右/下边缘，可见部分 70x80 像素，超过 40px 容错边距
        assert!(position_visible(1850, 1000, 1200, 800, &screens, VISIBLE_MARGIN));
        // 只露出 20px：不足容错边距，视为不可见
        assert!(!position_visible(1900, 1000, 1200, 800, &screens, VISIBLE_MARGIN));
        assert!(!position_visible(100, 1060, 1200, 800, &screens, VISIBLE_MARGIN));
        // 显示器已被拔掉：位置停在旧坐标上
        assert!(!position_visible(5000, 5000, 1200, 800, &screens, VISIBLE_MARGIN));
        // 极端坐标不能 panic
        assert!(!position_visible(i32::MIN, i32::MIN, u32::MAX, u32::MAX, &screens, VISIBLE_MARGIN));
        // 拿不到显示器列表时不设位置
        assert!(!position_visible(100, 80, 1200, 800, &[], VISIBLE_MARGIN));
    }

    /// 快照文件名与安全校验。
    #[test]
    fn backup_names_are_stamped_and_sandboxed() {
        let name = backup_name(1_793_000_000_000);
        assert!(name.starts_with("dawn-tick-"), "{name}");
        assert!(name.ends_with(".db"), "{name}");
        let digits: String = name
            .trim_start_matches("dawn-tick-")
            .trim_end_matches(".db")
            .to_string();
        assert_eq!(digits.len(), 15, "yyyyMMdd-HHmmss：{digits}");
        assert!(digits.chars().all(|ch| ch.is_ascii_digit() || ch == '-'));

        assert_eq!(
            safe_backup_name(" dawn-tick-20261014-120000.db ").unwrap(),
            "dawn-tick-20261014-120000.db"
        );
        for bad in [
            "",
            "../dawn-tick-20261014-120000.db",
            "dawn-tick-20261014-120000.db/..",
            r"sub\dawn-tick-20261014-120000.db",
            "dawn-tick-C:20261014-120000.db",
            "other.db",
            "dawn-tick-x.txt",
        ] {
            assert!(safe_backup_name(bad).is_err(), "应拒绝：{bad}");
        }
    }

    /// 标准 Base64 解码：导出整包时按二进制写盘用。
    #[test]
    fn base64_decode_roundtrip() {
        assert_eq!(decode_base64("aGVsbG8="), Some(b"hello".to_vec()));
        assert_eq!(
            decode_base64("5Lit5paH"),
            Some("中文".as_bytes().to_vec())
        );
        assert_eq!(decode_base64(""), Some(Vec::new()));
        assert_eq!(decode_base64("aGVs bG8=\n"), Some(b"hello".to_vec()));
        assert_eq!(decode_base64("不是base64"), None);
        assert_eq!(decode_base64("aGVsbG8"), Some(b"hello".to_vec()), "缺 padding 也能解");
    }

    /// 便携版判定：必须叫 DawnTick.exe 且不在安装目录里。
    #[test]
    fn portable_layout_needs_renamed_exe_outside_install_dir() {
        let install_root = std::path::Path::new(r"C:\Users\me\AppData\Local\DawnTick");
        let installed = std::path::Path::new(r"C:\Users\me\AppData\Local\DawnTick\DawnTick.exe");
        assert!(!portable_layout(installed, Some(install_root)), "安装目录里的同名程序按安装版处理");
        assert!(
            portable_layout(std::path::Path::new(r"D:\dt\DawnTick.exe"), Some(install_root)),
            "别的目录里的便携包按便携版处理"
        );
        assert!(
            portable_layout(std::path::Path::new(r"D:\dt\DawnTick.exe"), None),
            "拿不到安装目录时按便携版处理"
        );
        assert!(
            !portable_layout(std::path::Path::new(r"E:\repo\target\debug\dawn-tick-desktop.exe"), Some(install_root)),
            "开发构建按安装版处理"
        );
        assert!(
            !portable_layout(std::path::Path::new("DawnTick.exe"), Some(install_root)),
            "没有父目录时按安装版处理"
        );
    }

    /// 自定义位置：相对路径以程序所在目录为基准，绝对路径原样使用。
    #[cfg(windows)]
    #[test]
    fn storage_path_resolves_relative_to_exe() {
        let base = exe_dir().expect("测试进程有程序目录");
        assert_eq!(resolve_storage_path("dawn-tick-data"), base.join("dawn-tick-data"));
        assert_eq!(resolve_storage_path(r"D:\dt-data"), PathBuf::from(r"D:\dt-data"));
    }

    /// 自定义位置不可用时退回默认目录并给出提示。
    #[cfg(desktop)]
    #[test]
    fn choose_data_dir_falls_back_when_custom_unusable() {
        let temp = scratch_dir(&format!("dawntick-storage-test-{}", std::process::id()));
        let default = temp.join("default");
        let usable = temp.join("custom");
        let (picked, note) = choose_data_dir(default.clone(), Some(usable.to_string_lossy().to_string()));
        assert_eq!(picked, usable);
        assert!(note.is_none(), "可用位置不应有提示");

        // 把一个文件当目录用：创建目录必然失败
        let blocked = temp.join("blocked");
        std::fs::write(&blocked, b"file").expect("写入占位文件");
        let (picked, note) = choose_data_dir(default.clone(), Some(blocked.to_string_lossy().to_string()));
        assert_eq!(picked, default, "不可用时应退回默认目录");
        assert!(note.is_some(), "不可用时应给出提示");

        let (picked, note) = choose_data_dir(default.clone(), None);
        assert_eq!(picked, default);
        assert!(note.is_none());
        let _ = std::fs::remove_dir_all(&temp);
    }

    /// 换存储位置时复制数据库、几何与日志，目标已有的文件不覆盖。
    #[cfg(desktop)]
    #[test]
    fn copy_data_files_keeps_existing_target() {
        let temp = scratch_dir(&format!("dawntick-copy-test-{}", std::process::id()));
        let from = temp.join("from");
        let to = temp.join("to");
        std::fs::create_dir_all(&from).expect("建源目录");
        std::fs::create_dir_all(&to).expect("建目标目录");
        std::fs::write(from.join(DATABASE_FILE_NAME), b"db").expect("写数据库");
        std::fs::write(from.join(format!("{DATABASE_FILE_NAME}-wal")), b"wal").expect("写 wal");
        std::fs::write(from.join("window.json"), b"{}").expect("写几何");
        std::fs::write(to.join("window.json"), b"keep").expect("目标已有同名文件");

        let copied = copy_data_files(&from, &to);
        assert!(copied.contains(&DATABASE_FILE_NAME.to_string()));
        assert!(copied.contains(&format!("{DATABASE_FILE_NAME}-wal")));
        assert!(!copied.contains(&"window.json".to_string()), "目标已有文件不覆盖");
        assert_eq!(std::fs::read(to.join(DATABASE_FILE_NAME)).expect("读回数据库"), b"db");
        assert_eq!(std::fs::read(to.join("window.json")).expect("读回几何"), b"keep");
        assert!(copy_data_files(&to, &to).is_empty(), "同一个目录不复制");
        let _ = std::fs::remove_dir_all(&temp);
    }
}
