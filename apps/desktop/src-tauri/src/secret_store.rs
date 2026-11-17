//! 本机机密的平台密钥加解密（WebDAV 密码）。
//!
//! Windows 用 DPAPI（`CryptProtectData` / `CryptUnprotectData`，当前用户作用域）：
//! 密文只能在同一台机器的同一个 Windows 用户下解开，换机 / 换账户 / 重装系统后
//! 必须重新输入密码；DPAPI 不依赖应用自己保管密钥。
//!
//! 命令只收发 Base64 密文，`enc:v1:` 信封由 Web 侧维护；明文只在内存中出现，
//! 不落盘、不进日志。Android 对应实现见 `SecretStorePlugin.kt`（AndroidKeyStore AES-GCM）。

/// 绑定到应用的附加熵：同一用户下的其它程序即使调用 DPAPI 也解不开这里的密文。
const ENTROPY: &[u8] = b"DawnTick.WebDAV.v1";

const BASE64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// 标准 Base64 编码（带 padding），与 Web 侧 `toBase64Bytes` 逐字一致。
pub fn encode_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        out.push(BASE64_TABLE[(b0 >> 2) as usize] as char);
        out.push(BASE64_TABLE[(((b0 & 0b11) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            BASE64_TABLE[(((b1 & 0b1111) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_TABLE[(b2 & 0b111111) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// 取走 DPAPI 输出缓冲区并释放：`CryptProtectData` 用 `LocalAlloc` 分配结果。
#[cfg(windows)]
unsafe fn take_output(blob: &windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB) -> Vec<u8> {
    use windows_sys::Win32::Foundation::LocalFree;

    if blob.pbData.is_null() || blob.cbData == 0 {
        return Vec::new();
    }
    let bytes = std::slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec();
    LocalFree(blob.pbData as _);
    bytes
}

/// 用当前 Windows 用户的 DPAPI 主密钥加密，返回不透明字节。
#[cfg(windows)]
fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: ENTROPY.len() as u32,
        pbData: ENTROPY.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            &entropy,
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!("DPAPI 加密失败（错误码 {}）", unsafe { GetLastError() }));
    }
    Ok(unsafe { take_output(&output) })
}

/// 用当前用户的 DPAPI 主密钥解密；换用户或换机器后必然失败。
#[cfg(windows)]
fn unprotect(sealed: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: sealed.len() as u32,
        pbData: sealed.as_ptr() as *mut u8,
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: ENTROPY.len() as u32,
        pbData: ENTROPY.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            &entropy,
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!(
            "DPAPI 解密失败（错误码 {}）：密码可能来自别的 Windows 账户或设备",
            unsafe { GetLastError() }
        ));
    }
    Ok(unsafe { take_output(&output) })
}

#[cfg(not(windows))]
fn protect(_plain: &[u8]) -> Result<Vec<u8>, String> {
    Err("当前平台不支持系统密钥加密".to_string())
}

#[cfg(not(windows))]
fn unprotect(_sealed: &[u8]) -> Result<Vec<u8>, String> {
    Err("当前平台不支持系统密钥解密".to_string())
}

/// 加密明文并返回 Base64 密文；空明文由调用方拒绝。
pub fn encrypt_to_base64(plaintext: &str) -> Result<String, String> {
    let sealed = protect(plaintext.as_bytes())?;
    Ok(encode_base64(&sealed))
}

/// 解密 Base64 密文并还原为 UTF-8 文本。
pub fn decrypt_from_base64(ciphertext: &str) -> Result<String, String> {
    let sealed = crate::decode_base64(ciphertext).ok_or_else(|| "密文不是合法的 Base64".to_string())?;
    let plain = unprotect(&sealed)?;
    String::from_utf8(plain).map_err(|_| "解密结果不是合法的 UTF-8".to_string())
}

/// 加密 WebDAV 密码：返回 Base64 密文，Web 侧再封成 `enc:v1:` 信封。
#[tauri::command]
pub fn secret_encrypt(plaintext: String) -> Result<String, String> {
    if plaintext.is_empty() {
        return Err("没有需要加密的内容".to_string());
    }
    encrypt_to_base64(&plaintext)
}

/// 解密 Web 侧传来的 Base64 密文，返回明文。
#[tauri::command]
pub fn secret_decrypt(ciphertext: String) -> Result<String, String> {
    if ciphertext.is_empty() {
        return Err("缺少密文".to_string());
    }
    decrypt_from_base64(&ciphertext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_standard_padding() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        assert_eq!(encode_base64("中文".as_bytes()), "5Lit5paH");
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip() {
        let sealed = encrypt_to_base64("p@ss 中文").expect("DPAPI 加密");
        assert!(sealed.len() > 8, "密文应当是不透明字节");
        assert_eq!(decrypt_from_base64(&sealed).expect("DPAPI 解密"), "p@ss 中文");
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_rejects_tampered_ciphertext() {
        let sealed = encrypt_to_base64("secret").expect("DPAPI 加密");
        let mut broken = crate::decode_base64(&sealed).expect("Base64 解码");
        broken[0] ^= 0xff;
        assert!(unprotect(&broken).is_err(), "改动密文后必须解密失败");
    }

    #[test]
    fn decrypt_rejects_non_base64() {
        assert!(decrypt_from_base64("不是 base64！").is_err());
    }

    #[test]
    fn commands_reject_empty_input() {
        assert!(secret_encrypt(String::new()).is_err());
        assert!(secret_decrypt(String::new()).is_err());
    }
}
