package com.dawntick.app.secret

import com.dawntick.app.R
import com.dawntick.app.diag.NativeLog
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 本机密钥库插件：给 Web 层加密 WebDAV 密码（`enc:v1:` 信封由 TS 侧维护）。
 *
 * 契约（插件名、方法名、返回字段）见 apps/web/src/lib/plugins.ts 与 apps/mobile/docs/plugins.contract.md。
 * 加解密实现在 [SecretVault]；密钥随应用卸载销毁，换机后需要重新输入密码。
 */
@CapacitorPlugin(name = "SecretStore")
class SecretStorePlugin : Plugin() {
    /** 密钥库是否可用：不可用时 Web 层回退明文并在界面显式提示。 */
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val cause = SecretVault.unavailableCause()
        if (cause != null) {
            NativeLog.warn(context, SCOPE, "SecretStorePlugin.isAvailable 密钥库不可用 cause=${cause.javaClass.simpleName}")
        }
        NativeLog.debug(context, SCOPE, "SecretStorePlugin.isAvailable available=${cause == null}")
        call.resolve(JSObject().put("available", cause == null))
    }

    /** 加密：参数 `value`，返回 Base64 密文 `ciphertext`。 */
    @PluginMethod
    fun encrypt(call: PluginCall) {
        val value = call.getString("value")
        if (value == null) {
            NativeLog.warn(context, SCOPE, "SecretStorePlugin.encrypt 缺少参数 value")
            call.reject(context.getString(R.string.secret_missing_value))
            return
        }
        try {
            call.resolve(JSObject().put("ciphertext", SecretVault.encrypt(value)))
        } catch (error: Exception) {
            NativeLog.warn(context, SCOPE, "SecretStorePlugin.encrypt 加密失败 cause=${error.javaClass.simpleName}")
            call.reject(context.getString(R.string.secret_encrypt_failed, error.message ?: error.javaClass.simpleName))
        }
    }

    /** 解密：参数 `ciphertext`（Base64），返回明文 `value`。 */
    @PluginMethod
    fun decrypt(call: PluginCall) {
        val ciphertext = call.getString("ciphertext")
        if (ciphertext == null) {
            NativeLog.warn(context, SCOPE, "SecretStorePlugin.decrypt 缺少参数 ciphertext")
            call.reject(context.getString(R.string.secret_missing_ciphertext))
            return
        }
        try {
            call.resolve(JSObject().put("value", SecretVault.decrypt(ciphertext)))
        } catch (error: Exception) {
            NativeLog.warn(context, SCOPE, "SecretStorePlugin.decrypt 解密失败 cause=${error.javaClass.simpleName}")
            call.reject(context.getString(R.string.secret_decrypt_failed, error.message ?: error.javaClass.simpleName))
        }
    }

    private companion object {
        /** 只记异常类名：密文/明文与异常 message 都不进日志。 */
        const val SCOPE = "credentials"
    }
}
