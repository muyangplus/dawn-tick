package com.dawntick.app.files

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException

/**
 * Web 层交过来的本地文件路径：只接受应用私有目录内的绝对路径或 `file://` URI。
 *
 * 边界：
 * - 允许的根目录只有缓存目录与外部私有下载目录，其余一律拒绝（挡目录穿越与外部存储直读）；
 * - 对外只给 FileProvider 的 `content://` URI，不把 `file://` 交给别的应用（Android 7+ 会抛
 *   FileUriExposedException）；
 * - 不做业务判断：扩展名、能否安装等由各插件自己检查。
 *
 * 与 `res/xml/file_paths.xml` 的路径一一对应：改这里必须同步改那份配置，否则
 * FileProvider 会抛 `IllegalArgumentException`。
 */
internal class LocalFile private constructor(val file: File) {

    /** 文件的 FileProvider content URI。 */
    fun contentUri(context: Context): Uri {
        return try {
            FileProvider.getUriForFile(context, authority(context), file)
        } catch (error: IllegalArgumentException) {
            throw LocalFileException("文件不在可分享的目录内", error)
        }
    }

    /** 父目录的 content URI：给「打开所在文件夹」的第二手兜底（部分文件管理器认 content:// 目录）。 */
    fun parentContentUri(context: Context): Uri? {
        val parent = file.parentFile ?: return null
        return try {
            FileProvider.getUriForFile(context, authority(context), parent)
        } catch (error: IllegalArgumentException) {
            null
        }
    }

    /**
     * 目录在系统「文件」应用里的 document URI（externalstorage 文档提供方）。
     *
     * 只映射主共享存储下的路径（应用外部私有目录就在那里）；映射不出来时返回 null，
     * 由调用方回退到 content:// 目录或分享面板。
     */
    fun directoryDocumentUri(): Uri? {
        val directory = file.parentFile ?: return null
        val sharedRoot = sharedStorageRoot() ?: return null
        val directoryPath = directory.absolutePath
        val rootPath = sharedRoot.absolutePath
        if (directoryPath != rootPath && !directoryPath.startsWith(rootPath + File.separator)) {
            return null
        }
        val relative = directoryPath.removePrefix(rootPath).trimStart(File.separatorChar)
        if (relative.isEmpty()) return null
        val documentId = "$PRIMARY_VOLUME:$relative"
        return DocumentsContract.buildDocumentUri(EXTERNAL_STORAGE_AUTHORITY, documentId)
    }

    companion object {
        /** 与 AndroidManifest.xml 里 provider 的 `${applicationId}.fileprovider` 对应。 */
        private const val AUTHORITY_SUFFIX = ".fileprovider"

        /** 系统「文件」应用（DocumentsUI）读取共享存储用的文档提供方。 */
        private const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

        /** 主共享存储的卷名，externalstorage 的 documentId 前缀。 */
        private const val PRIMARY_VOLUME = "primary"

        private const val FILE_SCHEME = "file"

        fun authority(context: Context): String = context.packageName + AUTHORITY_SUFFIX

        /**
         * 解析并校验路径。
         *
         * 抛 [LocalFileException] 的情况：没给、不是绝对路径、带 `content://` 等别的 scheme、
         * 目录穿越到根目录之外、文件不存在、不是普通文件。
         */
        fun resolve(context: Context, raw: String?): LocalFile {
            val candidate = File(normalize(raw))
            if (!candidate.isAbsolute) throw LocalFileException("只接受绝对路径")
            val canonical = try {
                candidate.canonicalFile
            } catch (error: IOException) {
                throw LocalFileException("无法解析文件路径", error)
            }
            if (!canonical.exists()) throw LocalFileException("文件不存在")
            if (!canonical.isFile) throw LocalFileException("不是文件")
            if (!canonical.canRead()) throw LocalFileException("文件不可读")
            if (!isInsideAllowedRoot(context, canonical)) {
                throw LocalFileException("只允许应用缓存或下载目录内的文件")
            }
            return LocalFile(canonical)
        }

        /** 把 `file://` URI 或纯路径归一成路径文本；别的 scheme 一律拒绝。 */
        fun normalize(raw: String?): String {
            if (raw.isNullOrBlank()) throw LocalFileException("缺少文件路径")
            val text = raw.trim()
            if (text.startsWith("$FILE_SCHEME:", ignoreCase = true)) {
                val uri = Uri.parse(text)
                if (!FILE_SCHEME.equals(uri.scheme, ignoreCase = true)) {
                    throw LocalFileException("只接受应用目录内的文件路径")
                }
                val path = uri.path
                if (path.isNullOrBlank()) throw LocalFileException("文件路径为空")
                return path
            }
            if (text.contains("://")) throw LocalFileException("只接受应用目录内的文件路径")
            return text
        }

        /** 允许的根：缓存目录（下载的安装包、导出的文件）与外部私有下载目录。 */
        fun allowedRoots(context: Context): List<File> {
            val roots = mutableListOf<File>()
            canonicalOrNull(context.cacheDir)?.let { roots.add(it) }
            context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.let { downloads ->
                canonicalOrNull(downloads)?.let { roots.add(it) }
            }
            return roots
        }

        private fun isInsideAllowedRoot(context: Context, file: File): Boolean {
            for (root in allowedRoots(context)) {
                val rootPath = root.path
                if (file.path == rootPath || file.path.startsWith(rootPath + File.separator)) return true
            }
            return false
        }

        private fun canonicalOrNull(file: File): File? = try {
            file.canonicalFile
        } catch (error: IOException) {
            null
        }

        @Suppress("DEPRECATION")
        private fun sharedStorageRoot(): File? {
            // 应用外部私有目录挂在主共享存储下；getExternalStorageDirectory 已被标弃用但没有等价替代。
            return try {
                Environment.getExternalStorageDirectory()
            } catch (error: SecurityException) {
                null
            }
        }
    }
}

/** 路径校验失败：message 可直接作为 `call.reject` 的原因展示。 */
internal class LocalFileException(message: String, cause: Throwable? = null) : Exception(message, cause)
