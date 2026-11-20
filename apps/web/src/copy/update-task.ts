/** 更新下载、校验与安装链路：状态、进度与错误（lib/update-*.ts、update.ts）。 */
import { fail } from './common.ts';

export const updateTaskCopy = {
  // 检查更新（update.ts）
  feedEmpty: '该渠道还没有发布记录',
  rateLimited: (source: string) => `${source} 接口限流，请稍后再试`,
  httpStatus: (status: number) => `更新源返回 ${status}`,
  manifestTimeout: '读取更新清单超时',
  releaseTimeout: '查询更新发布超时',
  manifestInvalid: '更新清单格式不正确',
  manifestInvalidDetail: (detail: string) => `更新清单格式不正确（${detail}）`,
  channelMismatch: (manifestChannel: string, feed: string) =>
    `清单渠道 ${manifestChannel} 与查询渠道 ${feed} 不一致，已忽略`,
  queryFailed: '查询失败',
  bothSourcesFailed: (first: string, firstError: string, second: string, secondError: string) =>
    `${first}：${firstError}；${second}：${secondError}`,
  offline: '当前环境无法联网检查更新',

  // 安装包选择（update-download-plan.ts）
  noAndroidPackage: '这次发布没有提供 Android 安装包',
  androidNotApk: '发布里的 Android 产物不是 APK',
  noWindowsPortable: '这次发布没有提供 Windows 便携包',
  noWindowsInstaller: '这次发布没有提供 Windows 安装包',
  portableNotZip: '发布里的 Windows 便携包不是 zip，请到发布页下载',
  installerNotFound: '发布里的 Windows 产物不是安装包，请到发布页下载便携版',
  noSha256: '当前环境不支持 SHA-256 校验',

  // 阶段状态（update-download-state.ts / update-task.ts）
  checking: '正在检查更新…',
  downloading: '正在下载安装包…',
  verifying: '正在校验安装包…',
  writing: '正在写入安装包…',
  cancelled: '已取消下载',

  // 下载与安装（update-download.ts / update-task.ts）
  refreshToApply: '新版本已发布，刷新页面后生效',
  refreshPending: '刷新页面后生效',
  noChecksum: '这次发布没有提供校验文件，已停止安装',
  checksumMismatch: (expected: string, actual: string) => `安装包校验失败（应为 ${expected}，实际 ${actual}）`,
  portableReady: '便携包已下载并通过校验',
  installerReady: '安装包已下载并通过校验',
  portableUnsupported: '当前平台不支持便携版自动替换，请到发布页手动下载',
  portableApplying: '更新已就绪。应用将退出、替换并重新启动',
  portableExitFailed: (reason: string) => fail('自动退出', reason, '请手动退出应用以完成替换'),
  needsInstallPermission: '已跳转系统设置，请允许安装未知应用后重试',
  installerLaunched: '安装程序已启动。请按提示完成安装',
  downloadFailed: '下载更新失败',
  launchFailed: '启动安装程序失败',
  noAutoInstallPackage: '当前环境没有可自动安装的安装包，请到发布页下载',
  stagedPathLost: '安装包路径丢失，请重新下载',

  // 进度
  byteProgress: (received: string, total: string | null, percent: number | null) =>
    `已下载 ${received}${total === null ? '' : ` / ${total}`}${percent === null ? '' : `（${percent}%）`}`,
  downloadDetail: (speed: string | null, eta: string | null) =>
    [speed === null ? null : `速度 ${speed}/s`, eta === null ? null : `剩余 ${eta}`]
      .filter((part) => part !== null)
      .join(' · '),
  etaUnderSecond: '不足 1 秒',
  etaSeconds: (seconds: number) => `${seconds} 秒`,
  etaMinutes: (minutes: number, seconds: number) => `${minutes} 分 ${seconds} 秒`,
  etaHours: (hours: number, minutes: number) => `${hours} 小时 ${minutes} 分`,

  // 安装方式（update-install.ts / update-task.ts）
  installKindDetecting: '检测中',
  installKindPortable: '便携版',
  installKindInstaller: '安装版',
  installerWindowsPortable: 'Windows 便携包（退出后替换）',
  installerWindows: 'Windows 安装程序',
  installerAndroid: 'Android 安装器',
  installerWeb: '刷新页面',
  checksumOffline: '当前环境无法联网读取校验文件',
  checksumHttp: (status: number) => `读取校验文件失败：更新源返回 ${status}`,
  writeUnsupported: '当前平台不支持写入安装包',
  stagedOutside: '安装包不在更新暂存目录，请重新下载',
  launchUnsupported: '当前平台不支持启动安装程序',
  writtenPathMissing: '安装包写入后找不到路径',
  autoInstallUnsupported: '当前平台不支持自动安装，请到发布页手动下载',
  installerNotOpened: '系统安装器没有启动',
  verifyAndroid: '安装前系统会校验 APK 签名（apksigner verify --print-certs）',
  verifyWindows: '更新包随附签名，安装前会校验（gh attestation verify <文件> --repo muyangplus/dawn-tick）',
  verifyWeb: (channel: string) => `网页版随渠道 ${channel} 自动获取最新构建`,
} as const;
