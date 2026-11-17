//! 写文件与更新包暂存的安全边界。
//!
//! - 导出：由 Rust 自己弹「另存为」并写入，前端只交内容，不能指定任意路径；
//! - 更新：前端下载完把字节交给 `stage_update`，写进应用私有的 updates 目录并算 SHA-256；
//!   `run_installer` / `prepare_portable_update` 只接受该目录里的文件，启动前再按期望值复核一次。
//!
//! 威胁模型：应用自身页面出现 XSS 时，不能借这些命令把文件写到启动目录或拉起任意程序。

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// 应用私有的更新暂存目录：%LOCALAPPDATA%\com.dawntick.app\updates（不随用户可改的数据目录走）。
pub fn updates_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(|base| PathBuf::from(base).join("com.dawntick.app").join("updates"))
        .unwrap_or_else(|_| std::env::temp_dir().join("com.dawntick.app").join("updates"))
}

/// 小写十六进制 SHA-256。
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("读取文件失败: {error}"))?;
    Ok(sha256_hex(&bytes))
}

/// 期望值规范化：去掉 `sha256:` 前缀与空白，转小写；不是 64 位十六进制时拒绝。
pub fn normalize_sha256(text: &str) -> Result<String, String> {
    let value = text.trim().trim_start_matches("sha256:").to_ascii_lowercase();
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(value)
    } else {
        Err("缺少有效的 SHA-256 校验值".to_string())
    }
}

/// 暂存文件名只取最后一段并限制字符：不允许借文件名跳出暂存目录。
pub fn safe_update_name(name: &str) -> Result<String, String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let ok = !base.is_empty()
        && base != "."
        && base != ".."
        && base
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'));
    if ok {
        Ok(base.to_string())
    } else {
        Err(format!("更新包文件名不合法: {name}"))
    }
}

/// 解析暂存目录里的文件并复核哈希：文件名不合法、不在暂存目录、扩展名不对或哈希不符都拒绝。
pub fn resolve_staged(
    dir: &Path,
    name: &str,
    expected_sha256: &str,
    extensions: &[&str],
) -> Result<PathBuf, String> {
    let safe = safe_update_name(name)?;
    let expected = normalize_sha256(expected_sha256)?;
    let path = dir.join(&safe);
    let canonical = std::fs::canonicalize(&path).map_err(|_| format!("更新包不存在: {safe}"))?;
    let root = std::fs::canonicalize(dir).map_err(|_| "更新暂存目录不存在".to_string())?;
    if !crate::paths::path_inside(&canonical, &root) || !canonical.is_file() {
        return Err("更新包必须位于应用的更新暂存目录".to_string());
    }
    let extension_ok = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| extensions.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
        .unwrap_or(false);
    if !extension_ok {
        return Err(format!("更新包类型不对，只接受 {}", extensions.join(" / ")));
    }
    let actual = sha256_file(&canonical)?;
    if actual != expected {
        return Err("更新包校验失败：文件在下载后被改动，请重新下载".to_string());
    }
    Ok(canonical)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedUpdate {
    /// 暂存后的文件名（传回 run_installer / prepare_portable_update）
    pub name: String,
    pub sha256: String,
    pub bytes: u64,
}

/// 把下载好的更新包写进暂存目录，返回文件名与 SHA-256。
#[tauri::command]
pub async fn stage_update(name: String, base64: String) -> Result<StagedUpdate, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let safe = safe_update_name(&name)?;
        let bytes = crate::decode_base64(&base64).ok_or_else(|| "内容不是合法的 Base64".to_string())?;
        let dir = updates_dir();
        std::fs::create_dir_all(&dir).map_err(|error| format!("创建更新暂存目录失败: {error}"))?;
        let target = dir.join(&safe);
        let staging = dir.join(format!("{safe}.part"));
        std::fs::write(&staging, &bytes).map_err(|error| format!("写入更新包失败: {error}"))?;
        std::fs::rename(&staging, &target).map_err(|error| format!("写入更新包失败: {error}"))?;
        crate::append_log(&format!("已暂存更新包: {safe}（{} 字节）", bytes.len()));
        Ok(StagedUpdate {
            name: safe,
            sha256: sha256_hex(&bytes),
            bytes: bytes.len() as u64,
        })
    })
    .await
    .map_err(|error| format!("后台任务失败: {error}"))?
}

/// 导出文件：Rust 弹「另存为」后写入。用户取消返回 `None`。
/// 文本走 `text`，二进制走 `base64`，二者给一个。
#[tauri::command]
pub async fn save_file(
    app: AppHandle,
    default_name: String,
    filter_name: String,
    extension: String,
    text: Option<String>,
    base64: Option<String>,
) -> Result<Option<String>, String> {
    let bytes = match (text, base64) {
        (Some(text), None) => text.into_bytes(),
        (None, Some(encoded)) => crate::decode_base64(&encoded).ok_or_else(|| "内容不是合法的 Base64".to_string())?,
        _ => return Err("要写入的内容缺失".to_string()),
    };
    // 对话框的阻塞版本不能在主线程或 async 工作线程里等：放到阻塞线程池
    tauri::async_runtime::spawn_blocking(move || {
        let extension = extension.trim_start_matches('.').to_string();
        let chosen = app
            .dialog()
            .file()
            .set_file_name(&default_name)
            .add_filter(filter_name, &[extension.as_str()])
            .blocking_save_file();
        let Some(chosen) = chosen else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(|error| format!("保存位置不可用: {error}"))?;
        std::fs::write(&path, &bytes).map_err(|error| format!("写入失败: {error}"))?;
        let shown = path.to_string_lossy().to_string();
        crate::append_log(&format!("已写入文件: {shown}（{} 字节）", bytes.len()));
        Ok(Some(shown))
    })
    .await
    .map_err(|error| format!("后台任务失败: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-tmp")
            .join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("建测试目录");
        dir
    }

    #[test]
    fn sha256_of_known_text() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(normalize_sha256("sha256:BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD").is_ok());
        assert!(normalize_sha256("abc").is_err());
    }

    #[test]
    fn update_names_cannot_escape_staging_dir() {
        assert_eq!(safe_update_name("DawnTick-0.7.0-release-windows-x64-setup.exe").unwrap(), "DawnTick-0.7.0-release-windows-x64-setup.exe");
        assert_eq!(safe_update_name(r"C:\Users\me\AppData\Roaming\Startup\evil.exe").unwrap(), "evil.exe");
        assert!(safe_update_name("..").is_err());
        assert!(safe_update_name("a b.exe").is_err());
        assert!(safe_update_name("").is_err());
    }

    #[test]
    fn staged_file_must_match_expected_hash_and_extension() {
        let dir = scratch("dt-staged");
        std::fs::write(dir.join("setup.exe"), b"abc").unwrap();
        let good = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert!(resolve_staged(&dir, "setup.exe", good, &["exe", "msi"]).is_ok());
        let tampered = resolve_staged(&dir, "setup.exe", &"0".repeat(64), &["exe", "msi"]).unwrap_err();
        assert!(tampered.contains("校验失败"), "{tampered}");
        assert!(resolve_staged(&dir, "setup.exe", good, &["zip"]).is_err(), "扩展名不在白名单");
        assert!(resolve_staged(&dir, "missing.exe", good, &["exe"]).is_err());
    }
}
