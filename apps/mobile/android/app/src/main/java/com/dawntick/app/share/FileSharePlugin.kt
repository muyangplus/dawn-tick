package com.dawntick.app.share

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.webkit.MimeTypeMap
import com.dawntick.app.files.LocalFile
import com.dawntick.app.files.LocalFileException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 导出文件（I-12）的系统出口：分享给别的应用，或把用户带到文件所在目录。
 *
 * 边界：
 * - 只处理应用缓存 / 外部私有下载目录里的文件，路径校验与 content URI 换算见 `files/LocalFile.kt`；
 * - Android 没有「在资源管理器中选中文件」这种能力，`revealFile` 退化为
 *   「打开系统文件应用的所在目录」→「打开 content:// 目录」→「分享面板」三级回退。
 *
 * 契约（插件名、方法名、返回字段）见 apps/web/src/lib/plugins.ts 与 apps/mobile/docs/plugins.contract.md。
 */
@CapacitorPlugin(name = "FileShare")
class FileSharePlugin : Plugin() {

    /** 用系统分享面板发出 `path` 指向的文件；`shared: true` 表示分享面板已弹出。 */
    @PluginMethod
    fun shareFile(call: PluginCall) {
        val file = try {
            LocalFile.resolve(context, call.getString("path"))
        } catch (error: LocalFileException) {
            call.reject(error.message ?: "文件路径无效", error)
            return
        }
        val uri = try {
            file.contentUri(context)
        } catch (error: LocalFileException) {
            call.reject(error.message ?: "文件路径无效", error)
            return
        }
        val mimeType = resolveMimeType(file.file.name, call.getString("mimeType"))
        if (!startSend(uri, mimeType)) {
            call.reject("没有可分享该文件的应用")
            return
        }
        call.resolve(JSObject().put("shared", true))
    }

    /**
     * 把用户带到 `path` 所在的位置。
     *
     * 返回 `opened: true` 与 `via`：`documents`（系统文件应用的目录）、`content`（FileProvider
     * 目录，部分文件管理器认）、`share`（前两步都失败时回退到分享面板）。
     */
    @PluginMethod
    fun revealFile(call: PluginCall) {
        val file = try {
            LocalFile.resolve(context, call.getString("path"))
        } catch (error: LocalFileException) {
            call.reject(error.message ?: "文件路径无效", error)
            return
        }
        val directory = file.directoryDocumentUri()
        if (directory != null && startView(directory, DocumentsContract.Document.MIME_TYPE_DIR)) {
            call.resolve(revealed("documents"))
            return
        }
        val parent = file.parentContentUri(context)
        if (parent != null && startView(parent, FOLDER_MIME)) {
            call.resolve(revealed("content"))
            return
        }
        // 目录打不开时退回分享：至少能让用户把文件发到别处再定位。
        val uri = try {
            file.contentUri(context)
        } catch (error: LocalFileException) {
            call.reject(error.message ?: "文件路径无效", error)
            return
        }
        if (!startSend(uri, resolveMimeType(file.file.name, null))) {
            call.reject("打不开所在目录，也无法分享该文件")
            return
        }
        call.resolve(revealed("share"))
    }

    /** ACTION_VIEW 打开一个 content URI；没有应用或权限被拒时返回 false，交给下一手兜底。 */
    private fun startView(uri: Uri, mimeType: String): Boolean {
        val intent = Intent(Intent.ACTION_VIEW)
        intent.setDataAndType(uri, mimeType)
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            true
        } catch (error: ActivityNotFoundException) {
            false
        } catch (error: SecurityException) {
            false
        }
    }

    /** ACTION_SEND + FileProvider：把文件交给分享面板。 */
    private fun startSend(uri: Uri, mimeType: String): Boolean {
        val send = Intent(Intent.ACTION_SEND)
        send.type = mimeType
        send.putExtra(Intent.EXTRA_STREAM, uri)
        send.clipData = ClipData.newRawUri("export", uri)
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val chooser = Intent.createChooser(send, context.getString(android.R.string.share))
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(chooser)
            true
        } catch (error: ActivityNotFoundException) {
            false
        }
    }

    /** `mimeType` 没给时按扩展名推断，推不出来按二进制流处理。 */
    private fun resolveMimeType(name: String, provided: String?): String {
        val explicit = provided?.trim()
        if (!explicit.isNullOrEmpty()) return explicit
        val extension = name.substringAfterLast('.', "").lowercase()
        if (extension.isNotEmpty()) {
            MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)?.let { return it }
        }
        return DEFAULT_MIME
    }

    private fun revealed(via: String): JSObject = JSObject().put("opened", true).put("via", via)

    companion object {
        /** 目录的通用 MIME：部分文件管理器用它识别 content:// 目录。 */
        private const val FOLDER_MIME = "resource/folder"
        private const val DEFAULT_MIME = "application/octet-stream"
    }
}
