//! 数据目录级实例锁。
//!
//! 便携版把数据目录放在程序旁边，更新前后、普通实例与提权实例、双击与开机自启
//! 多种启动方式都可能同时指向同一个 `dawn-tick.db`。互斥体（`CreateMutexW`）只能
//! 覆盖同一用户会话、且创建失败时无从判断“是否还有别人在写”；这里改用数据目录
//! 下的 `instance.lock` 做跨进程咨询锁：
//!
//! - 拿到锁：本进程是唯一写入者，可以接着打开数据库；
//! - 拿不到锁：**绝不打开数据库**，调用方只能唤回已有窗口或退出；
//! - 锁文件建不出来（数据目录不可写）：同样不按独占继续写库，交给启动流程提权或提示。
//!
//! Windows 上 `std::fs::File::try_lock` 走 `LockFileEx`，锁随进程退出/句柄关闭释放，
//! 因此“老实例退出并释放锁之后，提权实例才允许打开数据库”只需要轮询这把锁。

use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// 锁文件名：放在数据目录里，随数据目录一起搬走。
pub const LOCK_FILE_NAME: &str = "instance.lock";

/// 轮询间隔：提权实例等旧实例退出时用。
pub const WAIT_STEP: Duration = Duration::from_millis(150);

/// 实例锁的获取结果。
pub enum Gate {
    /// 已取得锁；句柄必须活到进程退出（`Drop` 时释放）。
    Owner(InstanceLock),
    /// 锁被另一个进程持有。
    Busy { lock: PathBuf, reason: String },
    /// 锁文件无法创建/加锁（多为数据目录不可写），不能按独占继续。
    Unavailable { lock: PathBuf, reason: String },
}

/// 进程生命周期内持有的实例锁；丢弃即释放（文件句柄关闭时系统也会清掉锁）。
pub struct InstanceLock {
    path: PathBuf,
    file: File,
}

impl InstanceLock {
    /// 锁文件路径，供日志展示。
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for InstanceLock {
    fn drop(&mut self) {
        // 释放失败不影响正确性：句柄随进程退出关闭，锁也会被系统回收。
        let _ = self.file.unlock();
    }
}

/// 锁文件位置：数据目录（不是程序目录，也不是 `%LOCALAPPDATA%`）。
pub fn lock_path(dir: &Path) -> PathBuf {
    dir.join(LOCK_FILE_NAME)
}

fn open_lock_file(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .create(true)
        .read(true)
        // Windows 的 `LockFileEx` 要求句柄有写权限；只读句柄在部分系统上无法加独占锁。
        .write(true)
        // 不加 truncate：同名锁文件是常驻的，内容无意义但不要每次启动改写。
        .truncate(false)
        .open(path)
}

/// 单次尝试获取实例锁，不等待。
pub fn acquire(dir: &Path) -> Gate {
    let lock = lock_path(dir);
    if let Err(error) = std::fs::create_dir_all(dir) {
        return Gate::Unavailable {
            lock,
            reason: format!("创建数据目录失败（{error}）"),
        };
    }
    let file = match open_lock_file(&lock) {
        Ok(file) => file,
        Err(error) => {
            return Gate::Unavailable {
                lock,
                reason: format!("打开锁文件失败（{error}）"),
            }
        }
    };
    match file.try_lock() {
        Ok(()) => Gate::Owner(InstanceLock { path: lock, file }),
        Err(std::fs::TryLockError::WouldBlock) => Gate::Busy {
            lock,
            reason: "数据目录已被另一个实例占用".to_string(),
        },
        Err(std::fs::TryLockError::Error(error)) => Gate::Unavailable {
            lock,
            reason: format!("加锁失败（{error}）"),
        },
    }
}

/// 在 `timeout` 内反复尝试获取实例锁。
///
/// 使用场景：
/// - 提权实例启动后，等旧实例退出并释放锁（旧实例已停止写库，只是还没退干净）；
/// - 新版本请求旧版本退出后，等旧版本把锁交出来。
pub fn acquire_waiting(dir: &Path, timeout: Duration) -> Gate {
    let start = Instant::now();
    let last = Gate::Busy {
        lock: lock_path(dir),
        reason: "数据目录已被另一个实例占用".to_string(),
    };
    loop {
        match acquire(dir) {
            Gate::Busy { .. } => {
                if start.elapsed() >= timeout {
                    return last;
                }
                std::thread::sleep(WAIT_STEP);
            }
            other => return other,
        }
    }
}

/// 轮询一个条件直到成立或超时；返回最后一次检查结果。
///
/// 提权实例在拿到锁之后还要确认数据库文件真的能写（旧实例可能还没把文件句柄放掉）。
pub fn wait_until<F: FnMut() -> bool>(timeout: Duration, mut predicate: F) -> bool {
    let start = Instant::now();
    loop {
        if predicate() {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(WAIT_STEP);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试目录放在 target 下：CI/沙箱对系统临时目录的写权限不稳定。
    fn scratch_dir(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-tmp")
            .join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("应能建测试目录");
        dir
    }

    /// 单实例冲突：第二个持有者拿到 Busy，且在这一步之前没有任何数据库文件被创建。
    #[test]
    fn second_instance_is_refused_without_touching_database() {
        let dir = scratch_dir("instance-lock-conflict");
        let database = dir.join("dawn-tick.db");

        let first = acquire(&dir);
        let lock = match first {
            Gate::Owner(lock) => lock,
            Gate::Busy { .. } => panic!("第一个实例应能拿到锁"),
            Gate::Unavailable { reason, .. } => panic!("测试目录应可加锁: {reason}"),
        };
        assert_eq!(lock.path(), dir.join(LOCK_FILE_NAME).as_path());
        assert!(!database.exists(), "拿到锁之前不应创建数据库");

        // 同进程第二个句柄同样会被 Windows 的字节范围锁拒绝：这正是“拒绝打开数据库”的入口。
        match acquire(&dir) {
            Gate::Busy { lock, .. } => assert_eq!(lock, dir.join(LOCK_FILE_NAME)),
            Gate::Owner(_) => panic!("第二个实例不应拿到锁"),
            Gate::Unavailable { reason, .. } => panic!("应判为占用而不是不可用: {reason}"),
        }
        assert!(!database.exists(), "拿不到锁时不应创建数据库");

        drop(lock);
        assert!(matches!(acquire(&dir), Gate::Owner(_)), "锁释放后应能重新取得");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 提权交接：旧实例释放锁后，等待中的新实例取得锁。
    #[test]
    fn waiting_acquire_wins_after_release() {
        let dir = scratch_dir("instance-lock-wait");
        let lock = match acquire(&dir) {
            Gate::Owner(lock) => lock,
            _ => panic!("应能拿到锁"),
        };
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(lock);
        });
        match acquire_waiting(&dir, Duration::from_secs(5)) {
            Gate::Owner(_) => {}
            Gate::Busy { .. } => panic!("旧实例释放后应拿到锁"),
            Gate::Unavailable { reason, .. } => panic!("不应不可用: {reason}"),
        }
        releaser.join().expect("释放线程应正常结束");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 超时仍是 Busy，给调用方可读原因。
    #[test]
    fn waiting_acquire_times_out_as_busy() {
        let dir = scratch_dir("instance-lock-timeout");
        let _lock = match acquire(&dir) {
            Gate::Owner(lock) => lock,
            _ => panic!("应能拿到锁"),
        };
        match acquire_waiting(&dir, Duration::from_millis(50)) {
            Gate::Busy { lock, reason } => {
                assert_eq!(lock, dir.join(LOCK_FILE_NAME));
                assert!(!reason.is_empty());
            }
            Gate::Owner(_) => panic!("不应在占用期间拿到锁"),
            Gate::Unavailable { reason, .. } => panic!("应判为占用: {reason}"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 数据目录建不出来（父路径是文件）时给 Unavailable，而不是被当成独占。
    #[test]
    fn unusable_data_dir_is_unavailable() {
        let dir = scratch_dir("instance-lock-unavailable");
        let blocker = dir.join("blocked");
        std::fs::write(&blocker, b"file").expect("写占位文件");
        match acquire(&blocker.join("nested")) {
            Gate::Unavailable { reason, .. } => assert!(!reason.is_empty()),
            Gate::Owner(_) => panic!("不可写目录不应拿到锁"),
            Gate::Busy { .. } => panic!("不可写目录应报不可用"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn wait_until_stops_at_timeout_and_returns_last_result() {
        assert!(wait_until(Duration::ZERO, || true));
        assert!(!wait_until(Duration::from_millis(20), || false));
        let mut attempts = 0;
        assert!(wait_until(Duration::from_secs(2), || {
            attempts += 1;
            attempts >= 3
        }));
    }
}
