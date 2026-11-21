//! 内嵌教务窗口：打开、关闭、注入脚本与交回内容校验。

use super::*;

/// 内嵌教务窗口的标签。
pub(crate) const IMPORT_WINDOW: &str = "import";

/// 注入到教务页面的脚本：右下角按钮，点击后把页面（含同源 iframe）带回应用页面。
pub(crate) const IMPORT_INJECTION: &str = include_str!("import-injection.js");

/// 本次教务窗口的随机值：注入脚本带着它跳到交回页，交回时核对。
/// 教务窗口里加载的任何页面都能跳到交回页，没有它就能伪造导入内容。
pub(crate) static IMPORT_NONCE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub(crate) fn fresh_import_nonce() -> String {
    use std::hash::{BuildHasher, Hasher};
    // RandomState 的种子取自系统随机源；两段 64 位拼成 128 位
    let mut out = String::new();
    for salt in 0..2u64 {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u64(salt);
        hasher.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or(0),
        );
        out.push_str(&format!("{:016x}", hasher.finish()));
    }
    out
}

pub(crate) fn import_injection_with(nonce: &str) -> String {
    IMPORT_INJECTION.replace("__DT_IMPORT_NONCE__", nonce)
}

pub(crate) fn import_nonce_matches(expected: Option<&str>, given: &str) -> bool {
    matches!(expected, Some(value) if !value.is_empty() && value == given)
}

/// 教务页面把内容带到应用自身页面后，由该页面交回主窗口。
/// 全程不经过任何本机端口，避免与其他监听程序相互影响。
#[tauri::command]
pub async fn submit_page_import(app: tauri::AppHandle, payload: String, nonce: String) -> Result<(), String> {
    use tauri::Emitter;
    let expected = IMPORT_NONCE.lock().map(|guard| guard.clone()).unwrap_or(None);
    if !import_nonce_matches(expected.as_deref(), &nonce) {
        log_warn("import", "教务页面回传的校验值不符，已拒绝");
        return Err(copy::import::NONCE_MISMATCH.into());
    }
    if !payload.contains("<<<DAWNTICK>>>") {
        log_warn("import", "教务页面回传内容缺少标记，已拒绝");
        return Err(copy::import::MARKER_MISSING.into());
    }
    log_info("import", format!("教务页面已回传内容 bytes={}", payload.len()));
    app.emit("import-payload", payload)
        .map_err(copy::import::forward_failed)
}

/// 打开内嵌教务窗口，由用户自行登录并打开课表页。
/// 必须用 async：同步命令在主线程上执行，而创建窗口要等待主线程，会自锁。
#[tauri::command]
pub async fn open_import_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri::Manager;
    let parsed: tauri::Url = url.parse().map_err(copy::import::invalid_url)?;
    log_debug("import", format!("开始创建教务窗口 url={}", redact_url(parsed.as_str())));
    if let Some(existing) = app.get_webview_window(IMPORT_WINDOW) {
        let _ = existing.close();
    }
    let nonce = fresh_import_nonce();
    if let Ok(mut guard) = IMPORT_NONCE.lock() {
        *guard = Some(nonce.clone());
    }
    let injection = import_injection_with(&nonce);
    let new_window_target = app.clone();
    tauri::WebviewWindowBuilder::new(&app, IMPORT_WINDOW, tauri::WebviewUrl::External(parsed))
        .title(copy::window::IMPORT_TITLE)
        .inner_size(1100.0, 780.0)
        .initialization_script(&injection)
        // 记录每次页面导航，便于判断「点了没反应」是没触发跳转还是被拦下。
        .on_navigation(|target| {
            log_debug("import", format!("教务窗口导航 url={}", redact_url(target.as_str())));
            true
        })
        // 教务菜单多用 window.open 打开子页面，默认会被拒绝且没有任何提示。
        // 改为在本窗口内跳转：登录会话与「导入到晓刻」按钮都保留。
        .on_new_window(move |target, _features| {
            log_debug("import", format!("教务页面请求新窗口，改在本窗口打开 url={}", redact_url(target.as_str())));
            let handle = new_window_target.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(30));
                if let Some(window) = handle.get_webview_window(IMPORT_WINDOW) {
                    if let Err(error) = window.navigate(target) {
                        log_error("import", format!("教务窗口内跳转失败 error={error}"));
                    }
                }
            });
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
        .map_err(copy::import::open_failed)?;
    log_info("import", "教务窗口已打开");
    Ok(())
}

/// 关闭内嵌教务窗口。同样用 async，避免在窗口销毁上等待主线程。
#[tauri::command]
pub async fn close_import_window(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(IMPORT_WINDOW) {
        let _ = window.close();
    }
}
