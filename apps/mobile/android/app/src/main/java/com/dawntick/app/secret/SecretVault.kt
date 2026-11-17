package com.dawntick.app.secret

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 本机机密的加解密（WebDAV 密码）：AndroidKeyStore 里的 AES-256-GCM 密钥。
 *
 * 边界：
 * - 密钥由系统密钥库保管，不落盘、不进应用数据；随应用卸载（或清除应用数据）一起销毁；
 * - 密文格式：`Base64(12 字节 IV + GCM 密文与认证标签)`，与 Web 侧 `enc:v1:` 信封解耦；
 * - 明文只在内存中出现，不写日志。
 *
 * 对应 Win 端实现见 `apps/desktop/src-tauri/src/secret_store.rs`（DPAPI）。
 */
internal object SecretVault {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "dawntick-secret-v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
    private const val KEY_BITS = 256

    /** 密钥库是否可用；不可用时 Web 层回退明文并显式提示。只读检查，不生成密钥。 */
    fun isAvailable(): Boolean = try {
        KeyStore.getInstance(KEYSTORE).apply { load(null) }
        true
    } catch (_: Exception) {
        false
    }

    /** 加密 UTF-8 文本，返回 Base64(IV + 密文)。 */
    fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val combined = ByteArray(iv.size + sealed.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(sealed, 0, combined, iv.size, sealed.size)
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    /** 解密 Base64(IV + 密文)；密钥丢失或内容被改动时抛异常。 */
    fun decrypt(encoded: String): String {
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        require(combined.size > IV_BYTES) { "密文长度不对" }
        val iv = combined.copyOfRange(0, IV_BYTES)
        val sealed = combined.copyOfRange(IV_BYTES, combined.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
        return String(cipher.doFinal(sealed), Charsets.UTF_8)
    }

    /** 取密钥；第一次调用时在系统密钥库里生成，之后一直复用。 */
    @Synchronized
    private fun key(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        val existing = store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_BITS)
                .build(),
        )
        return generator.generateKey()
    }
}
