package com.dawntick.app.share

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.webkit.MimeTypeMap
import com.dawntick.app.R
import com.dawntick.app.diag.NativeLog
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
            NativeLog.warn(context, SCOPE, "FileSharePlugin.shareFile 文件路径无效", error)
            call.reject(error.message ?: context.getString(R.string.file_path_invalid), error)
            return
        }
        val name = file.file.name
        val uri = try {
            file.contentUri(context)
        } catch (error: LocalFileException) {
            NativeLog.warn(context, SCOPE, "FileSharePlugin.shareFile 文件无法换成 content URI name=$name", error)
            call.reject(error.message ?: context.getString(R.string.file_path_invalid), error)
            return
        }
        val mimeType = resolveMimeType(name, call.getString("mimeType"))
        if (!startSend(uri, mimeType)) {
            call.reject(context.getString(R.string.share_no_app))
            return
        }
        NativeLog.info(context, SCOPE, "FileSharePlugin.shareFile 已弹出分享面板 name=$name")
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
            NativeLog.warn(context, SCOPE, "FileSharePlugin.revealFile 文件路径无效", error)
            call.reject(error.message ?: context.getString(R.string.file_path_invalid), error)
            return
        }
        val name = file.file.name
        val directory = file.directoryDocumentUri()
        if (directory == null) {
            NativeLog.debug(context, SCOPE, "FileSharePlugin.revealFile 所在目录不在共享存储下，跳过文件应用 name=$name")
        } else if (startView(directory, DocumentsContract.Document.MIME_TYPE_DIR)) {
            call.resolve(revealed(name, "documents"))
            return
        }
        val parent = file.parentContentUri(context)
        if (parent == null) {
            NativeLog.debug(context, SCOPE, "FileSharePlugin.revealFile 所在目录没有 content URI name=$name")
        } else if (startView(parent, FOLDER_MIME)) {
            call.resolve(revealed(name, "content"))
            return
        }
        // 目录打不开时退回分享：至少能让用户把文件发到别处再定位。
        val uri = try {
            file.contentUri(context)
        } catch (error: LocalFileException) {
            NativeLog.warn(context, SCOPE, "FileSharePlugin.revealFile 文件无法换成 content URI name=$name", error)
            call.reject(error.message ?: context.getString(R.string.file_path_invalid), error)
            return
        }
        if (!startSend(uri, resolveMimeType(name, null))) {
            call.reject(context.getString(R.string.share_reveal_failed))
            return
        }
        call.resolve(revealed(name, "share"))
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
            NativeLog.warn(context, SCOPE, "FileSharePlugin.startView 没有能打开该目录的应用 mime=$mimeType", error)
            false
        } catch (error: SecurityException) {
            NativeLog.warn(context, SCOPE, "FileSharePlugin.startView 打开目录被拒 mime=$mimeType", error)
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
        val chooser = Intent.createChooser(send, context.getString(R.string.share_chooser_title))
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(chooser)
            true
        } catch (error: ActivityNotFoundException) {
            NativeLog.warn(context, SCOPE, "FileSharePlugin.startSend 没有可分享该文件的应用 mime=$mimeType", error)
            false
        }
    }

    /** `mimeType` 没给时按扩展名推断，推不出来按二进制流处理。 */
    private fun resolveMimeType(name: String, provided: String?): String {
        val explicit = provided?.trim()
        val (mimeType, source) = if (!explicit.isNullOrEmpty()) {
            explicit to "provided"
        } else {
            val extension = name.substringAfterLast('.', "").lowercase()
            val guessed = if (extension.isEmpty()) null else MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
            if (guessed != null) guessed to "extension" else DEFAULT_MIME to "default"
        }
        NativeLog.debug(context, SCOPE, "FileSharePlugin.resolveMimeType MIME 类型已确定 name=$name mime=$mimeType source=$source")
        return mimeType
    }

    private fun revealed(name: String, via: String): JSObject {
        NativeLog.info(context, SCOPE, "FileSharePlugin.revealFile 已打开所在位置 name=$name via=$via")
        return JSObject().put("opened", true).put("via", via)
    }

    companion object {
        private const val SCOPE = "backup"

        /** 目录的通用 MIME：部分文件管理器用它识别 content:// 目录。 */
        private const val FOLDER_MIME = "resource/folder"
        private const val DEFAULT_MIME = "application/octet-stream"
    }
}
