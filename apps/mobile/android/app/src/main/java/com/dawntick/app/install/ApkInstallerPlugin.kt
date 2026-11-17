package com.dawntick.app.install

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.dawntick.app.files.LocalFile
import com.dawntick.app.files.LocalFileException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 自动更新（I-03）收尾：把已下载的 APK 交给系统安装器。
 *
 * 边界：只负责「唤起安装器」与「未授权时跳本应用安装未知应用设置页」；
 * 下载、`sha256` / 签名校验、版本比对都在 Web 层，本插件不碰网络。
 *
 * 契约（插件名、方法名、返回字段）见 apps/web/src/lib/plugins.ts 与 apps/mobile/docs/plugins.contract.md。
 */
@CapacitorPlugin(name = "ApkInstaller")
class ApkInstallerPlugin : Plugin() {

    /**
     * 安装 `path` 指向的 APK。
     *
     * 返回 `opened: true` 表示已把安装界面交给系统；`opened: false` 且
     * `needsPermission: true` 表示已跳「安装未知应用」设置页，用户授权后需要重试一次。
     */
    @PluginMethod
    fun installApk(call: PluginCall) {
        val file = try {
            LocalFile.resolve(context, call.getString("path"))
        } catch (error: LocalFileException) {
            call.reject(error.message ?: "文件路径无效", error)
            return
        }
        if (!file.file.name.endsWith(APK_SUFFIX, ignoreCase = true)) {
            call.reject("只能安装 .apk 文件")
            return
        }
        if (!canInstallPackages()) {
            if (openUnknownSourcesSettings()) {
                call.resolve(JSObject().put("opened", false).put("needsPermission", true))
            } else {
                call.reject("请到系统设置允许本应用安装未知应用后重试")
            }
            return
        }
        val uri = try {
            file.contentUri(context)
        } catch (error: LocalFileException) {
            call.reject(error.message ?: "文件路径无效", error)
            return
        }
        val intent = Intent(Intent.ACTION_VIEW)
        intent.setDataAndType(uri, APK_MIME)
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // 部分安装器只从 clipData 取授权：只挂在 data 上的读权限在 Android 7+ 容易被忽略。
        intent.clipData = ClipData.newRawUri("apk", uri)
        try {
            context.startActivity(intent)
            call.resolve(JSObject().put("opened", true))
        } catch (error: ActivityNotFoundException) {
            call.reject("没有可处理安装包的应用", error)
        }
    }

    /** Android 8.0+ 按应用授权「安装未知应用」；更早版本是全局开关，直接放行。 */
    private fun canInstallPackages(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return context.packageManager.canRequestPackageInstalls()
    }

    /** 跳本应用的「安装未知应用」开关页；个别 ROM 没有这个页面时退到应用详情页。 */
    private fun openUnknownSourcesSettings(): Boolean {
        val packageUri = Uri.parse("package:" + context.packageName)
        val candidates = listOf(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, packageUri),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri),
        )
        for (intent in candidates) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                return true
            } catch (error: ActivityNotFoundException) {
                // 换下一个候选页
            } catch (error: SecurityException) {
                // 个别 ROM 把设置页也锁了，继续试
            }
        }
        return false
    }

    companion object {
        private const val APK_SUFFIX = ".apk"
        private const val APK_MIME = "application/vnd.android.package-archive"
    }
}
