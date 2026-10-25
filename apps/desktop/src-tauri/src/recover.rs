//! 运行中数据库自愈：把损坏的主库留存，用 `backups/` 里最新且通过自检的快照顶上。
//!
//! 只碰文件，不碰运行中的 sqlx 连接——调用方（前端）在拿到 `recovered: true` 后负责
//! 重启应用，让插件在新进程里打开恢复后的库。启动期的同类恢复仍在 `lib.rs` 的
//! `repair_database`：那时数据库还没被打开，可以同步做完全部动作。

use std::path::{Path, PathBuf};

use crate::{
    append_log, database_healthy_async, local_stamp, move_corrupt_aside, now_ms,
    DATABASE_FILE_NAME,
};

/// `recover_database` 的返回：前端据此决定重启还是展示原因。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverOutcome {
    /// 是否已用快照覆盖主库（true 时调用方应重启应用）。
    pub recovered: bool,
    /// 恢复用的快照文件名；没找到时为 None。
    pub snapshot: Option<String>,
    /// 失败原因或无需恢复的说明，可直接展示。
    pub reason: Option<String>,
}

impl RecoverOutcome {
    fn recovered(snapshot: String) -> Self {
        Self {
            recovered: true,
            snapshot: Some(snapshot),
            reason: None,
        }
    }

    fn failed(reason: impl Into<String>) -> Self {
        Self {
            recovered: false,
            snapshot: None,
            reason: Some(reason.into()),
        }
    }
}

/// 快照候选：只认 `backups/dawn-tick-*.db`，0 字节残留跳过；文件名里的时间戳决定顺序。
pub fn snapshot_names(backups: &Path) -> Vec<String> {
    let Ok(items) = std::fs::read_dir(backups) else {
        return Vec::new();
    };
    let mut names: Vec<String> = items
        .flatten()
        .filter_map(|item| {
            let name = item.file_name().to_string_lossy().to_string();
            if !name.starts_with("dawn-tick-") || !name.ends_with(".db") {
                return None;
            }
            let meta = item.metadata().ok()?;
            if meta.len() == 0 {
                return None;
            }
            Some(name)
        })
        .collect();
    // 名字是 dawn-tick-<yyyyMMdd-HHmmss>.db：倒序即“最新优先”。
    names.sort_by(|left, right| right.cmp(left));
    names
}

/// 最新且 `quick_check` 通过的快照；损坏快照会被跳过并记日志。
pub async fn newest_healthy_snapshot(backups: &Path) -> Option<(String, PathBuf)> {
    for name in snapshot_names(backups) {
        let path = backups.join(&name);
        if database_healthy_async(&path).await {
            return Some((name, path));
        }
        append_log(&format!("快照未通过自检，已跳过: {name}"));
    }
    None
}

/// 运行中恢复：损坏主库改名留存，复制最新健康快照为主库。
///
/// `dry_run` 只挑选快照并报告，不改动任何文件（供诊断/单测使用）。
pub async fn recover(dir: &Path, dry_run: bool) -> RecoverOutcome {
    let db = dir.join(DATABASE_FILE_NAME);
    if !db.is_file() {
        return RecoverOutcome::failed("数据库文件不存在，无需恢复");
    }
    if database_healthy_async(&db).await {
        return RecoverOutcome::failed("数据库自检通过，无需恢复");
    }

    let Some((name, path)) = newest_healthy_snapshot(&dir.join("backups")).await else {
        return RecoverOutcome::failed("没有找到通过自检的备份快照，请打开数据目录手动处理");
    };
    if dry_run {
        return RecoverOutcome {
            recovered: false,
            snapshot: Some(name.clone()),
            reason: Some(format!("dry-run：将用快照 {name} 恢复")),
        };
    }

    let stamp = local_stamp(now_ms());
    let saved = match move_corrupt_aside(dir, &stamp) {
        Ok(saved) => saved,
        Err(error) => {
            return RecoverOutcome::failed(format!(
                "暂时无法留存损坏文件（{error}），请关闭占用数据库的程序后重试"
            ))
        }
    };
    if let Err(error) = std::fs::copy(&path, &db) {
        return RecoverOutcome {
            recovered: false,
            snapshot: Some(name),
            reason: Some(format!("损坏库已留存为 {saved}，但复制快照失败（{error}）")),
        };
    }
    append_log(&format!("运行中恢复数据库：损坏库留存为 {saved}，已用快照 {name} 覆盖主库"));
    RecoverOutcome::recovered(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-tmp")
            .join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("应能建测试目录");
        dir
    }

    async fn write_sqlite_file(path: &Path, sql: &str) {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let pool = sqlx::SqlitePool::connect_with(options).await.expect("建库");
        sqlx::query(sql).execute(&pool).await.expect("执行 SQL");
        pool.close().await;
    }

    /// 空文件、损坏文件都不参与挑选；健康快照里取名字最新的。
    #[tokio::test]
    async fn picks_newest_healthy_snapshot() {
        let dir = scratch_dir("recover-pick");
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).expect("建备份目录");

        write_sqlite_file(&backups.join("dawn-tick-20260101-000000.db"), "CREATE TABLE t (a INTEGER)").await;
        std::fs::write(backups.join("dawn-tick-20260102-000000.db"), b"not a database").expect("写损坏快照");
        std::fs::write(backups.join("dawn-tick-20260103-000000.db"), b"").expect("写空快照");
        write_sqlite_file(&backups.join("dawn-tick-20260104-000000.db"), "CREATE TABLE t (a INTEGER)").await;
        std::fs::write(backups.join("ignore.txt"), b"x").expect("写无关文件");

        let names = snapshot_names(&backups);
        assert_eq!(
            names,
            vec![
                "dawn-tick-20260104-000000.db".to_string(),
                "dawn-tick-20260102-000000.db".to_string(),
                "dawn-tick-20260101-000000.db".to_string(),
            ],
            "0 字节残留不进候选，其余按时间倒序"
        );

        let picked = newest_healthy_snapshot(&backups).await.expect("应有健康快照");
        assert_eq!(picked.0, "dawn-tick-20260104-000000.db", "最新的健康快照优先");

        // 最新的坏掉时退到次新的健康快照
        std::fs::remove_file(backups.join("dawn-tick-20260104-000000.db")).expect("删最新快照");
        let picked = newest_healthy_snapshot(&backups).await.expect("应退到次新");
        assert_eq!(picked.0, "dawn-tick-20260101-000000.db");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// dry-run：只报告，主库、快照、留存名单都不变。
    #[tokio::test]
    async fn dry_run_reports_without_touching_files() {
        let dir = scratch_dir("recover-dry-run");
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).expect("建备份目录");
        let db = dir.join(DATABASE_FILE_NAME);
        std::fs::write(&db, b"broken").expect("写损坏主库");
        let healthy = backups.join("dawn-tick-20260101-000000.db");
        write_sqlite_file(&healthy, "CREATE TABLE t (a INTEGER)").await;
        assert!(!database_healthy_async(&db).await, "损坏主库应先判为不健康");
        assert!(database_healthy_async(&healthy).await, "快照应健康");
        assert_eq!(snapshot_names(&backups).len(), 1, "快照应进入候选");
        assert!(newest_healthy_snapshot(&backups).await.is_some(), "应能挑到快照");

        let outcome = recover(&dir, true).await;
        assert!(!outcome.recovered, "dry-run 不应真的恢复");
        assert_eq!(outcome.snapshot.as_deref(), Some("dawn-tick-20260101-000000.db"));
        assert!(outcome.reason.as_deref().unwrap_or("").contains("dry-run"));
        assert_eq!(std::fs::read(&db).expect("读主库"), b"broken", "主库不应被改动");
        let leftovers: Vec<String> = std::fs::read_dir(&dir)
            .expect("列目录")
            .flatten()
            .map(|item| item.file_name().to_string_lossy().to_string())
            .filter(|name| name.contains(".corrupt-"))
            .collect();
        assert!(leftovers.is_empty(), "不应产生留存文件: {leftovers:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 真恢复：损坏主库与附带文件一起留存，快照内容成为新主库。
    #[tokio::test]
    async fn recover_moves_corrupt_aside_and_restores_snapshot() {
        let dir = scratch_dir("recover-restore");
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).expect("建备份目录");
        let db = dir.join(DATABASE_FILE_NAME);
        std::fs::write(&db, b"broken").expect("写损坏主库");
        std::fs::write(dir.join(format!("{DATABASE_FILE_NAME}-wal")), b"wal").expect("写 wal");
        std::fs::write(dir.join(format!("{DATABASE_FILE_NAME}-shm")), b"shm").expect("写 shm");
        let healthy = backups.join("dawn-tick-20260101-000000.db");
        write_sqlite_file(&healthy, "CREATE TABLE t (a INTEGER)").await;

        let outcome = recover(&dir, false).await;
        assert!(outcome.recovered, "应恢复成功: {outcome:?}");
        assert_eq!(outcome.snapshot.as_deref(), Some("dawn-tick-20260101-000000.db"));
        assert!(outcome.reason.is_none());
        assert!(database_healthy_async(&db).await, "恢复后的主库应健康");
        assert_eq!(
            std::fs::read(&db).expect("读主库"),
            std::fs::read(&healthy).expect("读快照"),
            "主库内容应等于快照"
        );
        let names: Vec<String> = std::fs::read_dir(&dir)
            .expect("列目录")
            .flatten()
            .map(|item| item.file_name().to_string_lossy().to_string())
            .collect();
        assert!(
            names.iter().any(|name| name.starts_with("dawn-tick.db.corrupt-") && !name.ends_with("-wal") && !name.ends_with("-shm")),
            "损坏主库应留存: {names:?}"
        );
        assert!(names.iter().any(|name| name.contains(".corrupt-") && name.ends_with("-wal")), "wal 应一起留存: {names:?}");
        assert!(names.iter().any(|name| name.contains(".corrupt-") && name.ends_with("-shm")), "shm 应一起留存: {names:?}");
        assert!(!dir.join(format!("{DATABASE_FILE_NAME}-wal")).exists(), "主库旁不再留 wal");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 没有健康快照：不搬走损坏库（留着给人工处理），返回可读原因。
    #[tokio::test]
    async fn recover_keeps_corrupt_database_when_no_snapshot() {
        let dir = scratch_dir("recover-no-snapshot");
        std::fs::create_dir_all(dir.join("backups")).expect("建备份目录");
        let db = dir.join(DATABASE_FILE_NAME);
        std::fs::write(&db, b"broken").expect("写损坏主库");
        std::fs::write(dir.join("backups/dawn-tick-20260101-000000.db"), b"broken").expect("写损坏快照");

        let outcome = recover(&dir, false).await;
        assert!(!outcome.recovered);
        assert!(outcome.snapshot.is_none());
        assert!(outcome.reason.as_deref().unwrap_or("").contains("没有找到"));
        assert_eq!(std::fs::read(&db).expect("读主库"), b"broken", "没有快照时不动损坏库");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 健康库不动（命令被误调时也不产生留存文件）。
    #[tokio::test]
    async fn healthy_database_is_left_alone() {
        let dir = scratch_dir("recover-healthy");
        let db = dir.join(DATABASE_FILE_NAME);
        write_sqlite_file(&db, "CREATE TABLE t (a INTEGER)").await;

        let outcome = recover(&dir, false).await;
        assert!(!outcome.recovered);
        assert!(outcome.reason.as_deref().unwrap_or("").contains("无需恢复"));
        assert_eq!(std::fs::read_dir(&dir).expect("列目录").flatten().count(), 1, "只应有数据库本身");

        // 数据库不存在：同样按“无需恢复”返回
        let missing = recover(&dir.join("missing"), false).await;
        assert!(!missing.recovered);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
