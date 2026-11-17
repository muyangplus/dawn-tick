//! 数据库快照：列举、清理、排队恢复、损坏修复与恢复提示。

use super::*;
use std::fs::create_dir_all;
use std::path::PathBuf;

/// 数据库快照目录：数据目录下的 backups。
pub(crate) fn backups_dir() -> PathBuf {
    data_dir().join("backups")
}

/// 待生效的恢复请求：重启时在打开数据库之前套用。
pub(crate) fn pending_restore_file() -> PathBuf {
    data_dir().join("pending-restore.json")
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupEntry {
    pub(crate) name: String,
    pub(crate) bytes: u64,
    /// 文件修改时间（UTC 毫秒）
    pub(crate) created_at: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct PendingRestore {
    pub(crate) name: String,
}

/// 本地时间戳 yyyyMMdd-HHmmss；快照名与损坏留存名共用。
pub(crate) fn local_stamp(unix_ms: i64) -> String {
    let offset = local_offset_minutes();
    let shifted = unix_ms + i64::from(offset) * 60_000;
    let days = shifted.div_euclid(86_400_000);
    let rest = shifted.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hour = rest / 3_600_000;
    let minute = (rest % 3_600_000) / 60_000;
    let second = (rest % 60_000) / 1000;
    format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}")
}

/// 快照文件名：dawn-tick-<yyyyMMdd-HHmmss>.db，按名字排序即为时间顺序。
pub(crate) fn backup_name(unix_ms: i64) -> String {
    format!("dawn-tick-{}.db", local_stamp(unix_ms))
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

/// 快照名只允许 backups 目录内的 dawn-tick-*.db，拒绝任何路径穿越。
pub(crate) fn safe_backup_name(name: &str) -> Result<String, String> {
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
pub(crate) struct BackupTarget {
    pub(crate) name: String,
    pub(crate) path: String,
    /// 已转义，可直接拼进 `VACUUM INTO ...` 的 SQL 字面量
    pub(crate) sql_literal: String,
}

/// 取下一个快照的目标路径：建目录、给出唯一文件名与 SQL 字面量。
#[tauri::command]
pub fn backup_target() -> Result<BackupTarget, String> {
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

/// 快照条目：跳过 0 字节残留（VACUUM INTO 失败时留下的空文件）。
pub(crate) fn list_backup_entries_in(dir: &std::path::Path) -> Result<Vec<BackupEntry>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for item in std::fs::read_dir(dir).map_err(|error| format!("读取备份目录失败: {error}"))? {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().to_string();
        if !name.starts_with("dawn-tick-") || !name.ends_with(".db") {
            continue;
        }
        let Ok(meta) = item.metadata() else { continue };
        if meta.len() == 0 {
            continue;
        }
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

pub(crate) fn list_backup_entries() -> Result<Vec<BackupEntry>, String> {
    list_backup_entries_in(&backups_dir())
}

/// 列出全部快照，最新的排在最前。
#[tauri::command]
pub fn list_backups() -> Result<Vec<BackupEntry>, String> {
    list_backup_entries()
}

#[tauri::command]
pub fn delete_backup(name: String) -> Result<(), String> {
    let safe = safe_backup_name(&name)?;
    let path = backups_dir().join(&safe);
    std::fs::remove_file(&path).map_err(|error| format!("删除快照失败: {error}"))?;
    append_log(&format!("已删除快照: {safe}"));
    Ok(())
}

/// 只保留最新的 keep 份，返回实际删掉的份数。
#[tauri::command]
pub fn prune_backups(keep: usize) -> Result<usize, String> {
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
pub async fn restore_backup(name: String) -> Result<String, String> {
    let safe = safe_backup_name(&name)?;
    let source = backups_dir().join(&safe);
    if !source.is_file() {
        return Err("快照不存在".to_string());
    }
    let bytes = std::fs::metadata(&source).map(|meta| meta.len()).unwrap_or(0);
    if bytes == 0 {
        return Err("快照是空文件，无法恢复".to_string());
    }
    if !database_healthy_async(&source).await {
        return Err("快照已损坏，无法恢复".to_string());
    }
    write_json(&pending_restore_file(), &PendingRestore { name: safe.clone() })
        .then_some(())
        .ok_or_else(|| "写入恢复请求失败".to_string())?;
    append_log(&format!("已排队恢复快照: {safe}"));
    Ok(safe)
}

/// 启动时套用排队的恢复请求：覆盖数据库并清掉 WAL 附带文件。
pub(crate) fn apply_pending_restore() {
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
    let bytes = std::fs::metadata(&source).map(|meta| meta.len()).unwrap_or(0);
    if bytes == 0 {
        append_log(&format!("恢复请求的快照是空文件，已忽略: {safe}"));
        return;
    }
    if !database_healthy(&source) {
        append_log(&format!("恢复请求的快照未通过自检，已忽略: {safe}"));
        return;
    }
    let dir = data_dir();
    let _ = create_dir_all(&dir);
    let stamp = local_stamp(now_ms());
    match replace_database_with(&dir, &source, &stamp) {
        Ok(bytes) => append_log(&format!("已套用快照 {safe}（{bytes} 字节），原库留存为 .pre-restore-{stamp}")),
        Err(error) => append_log(&format!("套用快照失败，原库未改动: {error}")),
    }
}

/// 用快照替换数据库：先完整复制到临时文件，再把原库连同 -wal / -shm / -journal 改名留存，
/// 最后改名就位。任何一步失败都不会留下「原库已删、新库没到」的空窗。
pub(crate) fn replace_database_with(dir: &std::path::Path, source: &std::path::Path, stamp: &str) -> Result<u64, String> {
    let db = dir.join(DATABASE_FILE_NAME);
    let staging = dir.join(format!("{DATABASE_FILE_NAME}.restore-tmp"));
    let bytes = std::fs::copy(source, &staging).map_err(|error| {
        let _ = std::fs::remove_file(&staging);
        format!("复制快照失败: {error}")
    })?;
    if db.exists() {
        let saved = format!("{DATABASE_FILE_NAME}.pre-restore-{stamp}");
        if let Err(error) = std::fs::rename(&db, dir.join(&saved)) {
            let _ = std::fs::remove_file(&staging);
            return Err(format!("留存原库失败: {error}"));
        }
        move_sidecars(dir, &saved);
    } else {
        // 没有主库却有附带文件：是别的库留下的，不能让新库重放它们
        for suffix in ["-wal", "-shm", "-journal"] {
            let _ = std::fs::remove_file(dir.join(format!("{DATABASE_FILE_NAME}{suffix}")));
        }
    }
    std::fs::rename(&staging, &db).map_err(|error| format!("快照就位失败: {error}"))?;
    Ok(bytes)
}

/// SQLite 的损坏报错都带这些字样；锁冲突、权限不足等不算损坏。
pub(crate) fn is_corrupt_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("malformed")
        || lower.contains("corrupt")
        || lower.contains("not a database")
        || lower.contains("unsupported file format")
        || lower.contains("code: 11")
        || lower.contains("code: 26")
}

/// 自检：`quick_check` 返回的行全是 ok 才算健康；打不开或锁冲突按健康处理，避免误判。
/// 只读打开：判定损坏的文件不能被顺手 checkpoint 或改写。
pub(crate) async fn database_healthy_async(file: &std::path::Path) -> bool {
    if !file.is_file() {
        return true;
    }
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(file)
        .create_if_missing(false)
        .read_only(true);
    let pool = match sqlx::SqlitePool::connect_with(options).await {
        Ok(pool) => pool,
        Err(error) => return !is_corrupt_message(&error.to_string()),
    };
    let rows = sqlx::query_as::<_, (String,)>("PRAGMA quick_check")
        .fetch_all(&pool)
        .await;
    let _ = pool.close().await;
    match rows {
        Ok(rows) => rows.is_empty() || rows.iter().all(|row| row.0.trim().eq_ignore_ascii_case("ok")),
        Err(error) => !is_corrupt_message(&error.to_string()),
    }
}

/// 同步版本：只在事件循环启动之前调用。
pub(crate) fn database_healthy(file: &std::path::Path) -> bool {
    tauri::async_runtime::block_on(database_healthy_async(file))
}

/// 损坏文件改名留存：主库搬走后再搬 -wal / -shm / -journal。
/// Windows 上句柄释放有延迟，改名重试约 2 秒；仍失败则退化为复制后删除。
pub(crate) fn move_corrupt_aside(dir: &std::path::Path, stamp: &str) -> Result<String, String> {
    let db = dir.join(DATABASE_FILE_NAME);
    let saved = format!("{DATABASE_FILE_NAME}.corrupt-{stamp}");
    let target = dir.join(&saved);
    let mut last = String::new();
    for attempt in 0..10 {
        match std::fs::rename(&db, &target) {
            Ok(()) => {
                move_sidecars(dir, &saved);
                return Ok(saved);
            }
            Err(error) => {
                last = error.to_string();
                if attempt < 9 {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
            }
        }
    }
    if std::fs::copy(&db, &target).is_ok() && std::fs::remove_file(&db).is_ok() {
        move_sidecars(dir, &saved);
        return Ok(saved);
    }
    Err(last)
}

/// 把附带文件搬到与主库同一个留存名下。
pub(crate) fn move_sidecars(dir: &std::path::Path, saved: &str) {
    for suffix in ["-wal", "-shm", "-journal"] {
        let side = dir.join(format!("{DATABASE_FILE_NAME}{suffix}"));
        if side.is_file() {
            let _ = std::fs::rename(&side, dir.join(format!("{saved}{suffix}")));
        }
    }
}

/// 最近一份通过自检的快照；空文件不参与（列表已过滤）。
pub(crate) fn newest_healthy_snapshot(dir: &std::path::Path) -> Option<(String, PathBuf)> {
    for entry in list_backup_entries_in(dir).ok()? {
        let path = dir.join(&entry.name);
        if database_healthy(&path) {
            return Some((entry.name, path));
        }
    }
    None
}

/// 清掉 0 字节快照：VACUUM INTO 失败会留下这种残留。
pub(crate) fn cleanup_empty_backups_in(dir: &std::path::Path) -> usize {
    let Ok(items) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for item in items.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if !name.starts_with("dawn-tick-") || !name.ends_with(".db") {
            continue;
        }
        let Ok(meta) = item.metadata() else { continue };
        if meta.len() == 0 && std::fs::remove_file(item.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// 启动自检：数据库损坏时留存损坏文件，并用最近一份通过自检的快照恢复。
/// 只在打开数据库之前调用；没有可用快照时保持无库状态，由插件新建空库。
pub(crate) fn repair_database(dir: &std::path::Path) -> Option<String> {
    let db = dir.join(DATABASE_FILE_NAME);
    if !db.is_file() || database_healthy(&db) {
        return None;
    }
    let stamp = local_stamp(now_ms());
    let saved = match move_corrupt_aside(dir, &stamp) {
        Ok(saved) => saved,
        Err(error) => return Some(format!("数据库损坏，暂时无法留存原文件（{error}），重启后再试")),
    };
    match newest_healthy_snapshot(&dir.join("backups")) {
        Some((name, path)) => match std::fs::copy(&path, &db) {
            Ok(_) => Some(format!("数据库损坏，已留存 {saved}，并用快照 {name} 恢复")),
            Err(error) => Some(format!("数据库损坏，已留存 {saved}，恢复快照失败（{error}）")),
        },
        None => Some(format!("数据库损坏，已留存 {saved}，未找到可用快照")),
    }
}

/// 启动自检的结论，界面读一次（读后清空）。
pub(crate) static RECOVERY_NOTICE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub(crate) fn set_recovery_notice(text: String) {
    if let Ok(mut slot) = RECOVERY_NOTICE.lock() {
        *slot = Some(text);
    }
}

#[tauri::command]
pub fn recovery_notice() -> Option<String> {
    RECOVERY_NOTICE.lock().ok().and_then(|mut slot| slot.take())
}

/// 运行中数据库自愈：损坏主库改名留存，用最新一份通过自检的快照顶上。
///
/// 不动运行中的 sqlx 连接（它已经不可用）；前端拿到 `recovered: true` 后重启应用，
/// 让插件在新进程里打开恢复后的库。命令本身在数据目录里完成，不依赖任何连接。
#[tauri::command]
pub async fn recover_database() -> recover::RecoverOutcome {
    let outcome = recover::recover(&data_dir(), false).await;
    append_log(&format!(
        "运行中数据库恢复: recovered={} snapshot={:?} reason={:?}",
        outcome.recovered, outcome.snapshot, outcome.reason
    ));
    outcome
}
