/**
 * 备份文件文案：导出导入结果、加密信封、ZIP 解包与 WebDAV 密码保存。
 */
export const appBackupCopy = {
  export: {
    noModule: '请至少勾选一个模块',
    zipFilter: 'ZIP 整包',
    encryptedTextFilter: '加密备份文本',
    jsonFilter: 'JSON 备份',
  },

  import: {
    empty: '内容为空',
    passwordRequired: '备份已加密，请输入口令后再导入',
    mode: {
      skip: '保留现有数据',
      overwrite: '覆盖为备份内容',
      clear: '先清空所选模块再导入',
      merge: '按修改时间合并',
    },
    result: (
      head: string,
      counts: { imported: number; skipped: number; removed: number },
      flags: { presets: boolean; logsSkipped: boolean },
    ) =>
      `${head}：写入 ${counts.imported} 条，跳过 ${counts.skipped} 条` +
      `${counts.removed > 0 ? `，清空 ${counts.removed} 条` : ''}` +
      `${flags.presets ? '，已恢复预设' : ''}` +
      `${flags.logsSkipped ? '，日志未覆盖' : ''}`,
  },

  crypto: {
    unavailable: '当前环境不支持 WebCrypto，无法加密或解密备份',
    weakPassword: (min: number) => `口令至少 ${min} 位`,
    notEnvelope: '这不是加密信封：缺少 DAWNTICK-ENC 标记',
    incomplete: '加密信封格式不完整',
    unsupportedVersion: (version: string | undefined) => `不支持的信封版本 ${version ?? '(缺失)'}，请升级晓刻后再试`,
    missingBody: '加密信封缺少内容',
    bodyNotBase64: '加密信封内容损坏（不是有效的 Base64 JSON）',
    bodyBadShape: '加密信封内容损坏（结构不对）',
    missingFields: '加密信封缺少盐、IV 或密文',
    weakIterations: (min: number) => `加密信封的迭代次数不合理（应不少于 ${min}）`,
    fieldsNotBase64: '加密信封的盐、IV 或密文不是有效 Base64',
    badSaltLength: '加密信封的盐长度不对',
    badIvLength: '加密信封的 IV 长度不对',
    emptyCiphertext: '加密信封没有密文',
    wrongPassword: '口令错误，请重新输入。多次失败请检查文件是否被改动',
    notUtf8: '解密成功但内容不是合法 UTF-8，文件可能已损坏',
  },

  zip: {
    notZip: '不是 ZIP 文件（找不到结尾记录）',
    centralDirectoryCorrupt: 'ZIP 中央目录损坏',
    zip64Unsupported: '暂不支持 ZIP64 格式',
    deflateUnsupported: '当前环境不支持解压 deflate 条目',
    localHeaderCorrupt: (name: string) => `条目 ${name} 的本地头损坏`,
    methodUnsupported: (name: string, method: number) => `条目 ${name} 用了不支持的压缩方式（${method}）`,
    crcMismatch: (name: string) => `条目 ${name} 校验和不一致`,
  },

  credentials: {
    encryptionUnavailable: '本平台不支持加密。密码以明文保存在本机',
    emptyCiphertext: '加密结果为空，拒绝写入',
    desktopNoCiphertext: '桌面端没有返回密文',
    desktopNoPlaintext: '桌面端没有返回明文',
    androidPluginMissing: '安卓密钥库插件不可用',
    androidNoCiphertext: '安卓端没有返回密文',
    androidNoPlaintext: '安卓端没有返回明文',
    revealFailed: (reason: string) => `已保存的密码无法解密：${reason}。请重新输入`,
    readFailed: (reason: string) => `读取已保存的密码失败：${reason}`,
    stillPlaintext: (reason: string) => `加密失败：${reason}。密码仍以明文保存在本机`,
    decryptUnsupported: '当前平台不支持解密已保存的密码，请重新输入',
    decryptFailed: '已保存的密码无法解密（可能更换了系统账户或设备），请重新输入 WebDAV 密码',
    writeFailed: (reason: string) => `写入失败：${reason}`,
    encryptFailed: (reason: string) => `加密失败：${reason}`,
  },
} as const;
