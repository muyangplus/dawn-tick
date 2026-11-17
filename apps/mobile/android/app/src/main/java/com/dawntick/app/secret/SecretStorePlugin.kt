package com.dawntick.app.secret

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
        call.resolve(JSObject().put("available", SecretVault.isAvailable()))
    }

    /** 加密：参数 `value`，返回 Base64 密文 `ciphertext`。 */
    @PluginMethod
    fun encrypt(call: PluginCall) {
        val value = call.getString("value")
        if (value == null) {
            call.reject("缺少 value")
            return
        }
        try {
            call.resolve(JSObject().put("ciphertext", SecretVault.encrypt(value)))
        } catch (error: Exception) {
            call.reject("加密失败：${error.message ?: error.javaClass.simpleName}")
        }
    }

    /** 解密：参数 `ciphertext`（Base64），返回明文 `value`。 */
    @PluginMethod
    fun decrypt(call: PluginCall) {
        val ciphertext = call.getString("ciphertext")
        if (ciphertext == null) {
            call.reject("缺少 ciphertext")
            return
        }
        try {
            call.resolve(JSObject().put("value", SecretVault.decrypt(ciphertext)))
        } catch (error: Exception) {
            call.reject("解密失败：${error.message ?: error.javaClass.simpleName}")
        }
    }
}
