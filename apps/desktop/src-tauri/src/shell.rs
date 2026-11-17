//! 交给系统打开：外部链接、日志目录。

use super::*;
use std::fs::create_dir_all;

/// 允许交给外部程序的链接：只有 http 与 https，且不含换行与引号。
pub(crate) fn external_url_is_allowed(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return false;
    }
    !url.chars().any(|item| item == '\r' || item == '\n' || item == '"')
}

/// 交给 shell 打开一个目标（链接或目录）。
#[cfg(windows)]
pub(crate) fn shell_open(target: &str, what: &str) -> Result<(), String> {
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
pub fn open_external_url(url: String) -> Result<(), String> {
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

/// 标准 Base64 解码；长度或字符不合法时返回 None。
pub(crate) fn decode_base64(text: &str) -> Option<Vec<u8>> {
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

/// 在资源管理器里打开日志目录，返回目录路径。
#[tauri::command]
pub fn open_log_dir() -> Result<String, String> {
    let dir = log_file_dir().ok_or_else(|| "无法定位日志目录".to_string())?;
    create_dir_all(&dir).map_err(|error| format!("创建日志目录失败: {error}"))?;
    #[cfg(windows)]
    {
        shell_open(&dir.to_string_lossy(), "打开日志目录")?;
        append_log(&format!("已打开日志目录: {}", dir.display()));
    }
    Ok(dir.to_string_lossy().to_string())
}
