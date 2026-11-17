//! 开机自启与启动时隐藏。

use super::*;

#[tauri::command]
pub fn save_startup_prefs(hidden: bool) {
    save_startup_prefs_inner(hidden);
}

pub(crate) fn save_startup_prefs_inner(hidden: bool) {
    if let Some(dir) = app_dir() {
        write_json(&dir.join("startup.json"), &StartupPrefs { hidden });
    }
}

/// 开机自启：直接写注册表，用户级失败时可提权写机器级。
#[cfg(windows)]
pub(crate) mod autostart_reg {
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
pub(crate) struct AutostartStatus {
    pub(crate) user: bool,
    pub(crate) machine: bool,
}

#[cfg(windows)]
pub(crate) fn autostart_status_inner() -> AutostartStatus {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    AutostartStatus {
        user: autostart_reg::read(HKEY_CURRENT_USER).is_some(),
        machine: autostart_reg::read(HKEY_LOCAL_MACHINE).is_some(),
    }
}

#[cfg(not(windows))]
pub(crate) fn autostart_status_inner() -> AutostartStatus {
    AutostartStatus {
        user: false,
        machine: false,
    }
}

#[tauri::command]
pub fn autostart_status() -> AutostartStatus {
    autostart_status_inner()
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<AutostartStatus, String> {
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
