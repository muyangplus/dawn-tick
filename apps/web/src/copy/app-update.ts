/**
 * 更新下载文案：分片下载、下载源探测与 version.json 校验的错误和状态行。
 * `probe.timeout` 与 `probe.httpStatus` 的格式被 lib/download-probe.ts 的正则识别，改动时同步。
 */
export const appUpdateCopy = {
  download: {
    cancelled: '已取消下载',
    rangeUnsupported: '服务器不支持 Range 请求',
    chunkTimeout: '下载分片超时',
    bodyTimeout: '下载数据超时',
    requestTimeout: '下载请求超时',
    httpStatus: (status: number) => `更新源返回 ${status}`,
    chunkMissing: '下载分片缺失，已停止写入',
    sizeMismatch: (expected: number, actual: number) =>
      `更新包大小不一致（应为 ${expected} 字节，实际 ${actual} 字节），已停止写入`,
    offline: '当前环境无法联网下载更新',
  },

  probe: {
    timeout: '探测超时',
    httpStatus: (status: number) => `返回 ${status}`,
    noData: '没有读到数据',
    unreachable: (reason: string) => `无法连接（${reason}）`,
    failed: '探测失败',
    noProbeFile: 'version.json 没有可探测的产物',
    assetFailed: '资产探测失败',
  },

  source: {
    unavailable: (label: string) => `${label}（不可用）`,
    probed: (label: string, latencyMs: number, size: string, degraded: boolean) =>
      `${label}（${latencyMs}ms${size}${degraded ? '，镜像未同步' : ''}）`,
    probing: '正在探测下载源…',
    manual: (label: string) => `手动：${label}`,
    manualProbed: (label: string, probes: string) => `手动：${label}（探测：${probes}）`,
    auto: (probes: string, degraded: boolean) =>
      `自动：${probes}${degraded ? '。该源镜像未同步，下载时自动回退另一个源' : ''}`,
  },

  manifest: {
    emptyFileName: 'assets 文件名为空',
    fileNotObject: (key: string) => `${key} 不是对象`,
    fileMissingName: (key: string) => `缺少文件 ${key} 的 name`,
    fileBadSize: (key: string) => `${key} 的 size 不是有效字节数`,
    fileBadSha256: (key: string) => `${key} 的 sha256 不是 64 位十六进制`,
    notObject: 'version.json 不是对象',
    badSchema: (schema: number) => `schema 不是 ${schema}`,
    badChannel: '渠道不是 dev / beta / release',
    missingVersion: '缺少版本号',
    badReleasedAt: 'releasedAt 不是毫秒时间戳',
    badCommit: 'commit 不是字符串',
    badNotes: 'notes 不是字符串',
    badTag: 'tag 不是非空字符串',
    badChecksums: 'checksums 不是文件名',
    missingFiles: '缺少 files',
    noPlatformFile: (keys: string) => `缺少文件（${keys} 至少一个）`,
  },

  abiTimeout: '读取设备 ABI 超时',
} as const;
