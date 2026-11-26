/**
 * 启动与恢复文案：启动失败页、存储回退条、数据库损坏弹窗、恢复动作的提示。
 */
/** 备份导入入口在界面上的位置；导航或分组改名时同步这里。 */
const BACKUP_PATH = '「设备与同步 → 备份与恢复」';
/** 日志入口在界面上的位置。 */
const LOGS_PATH = '「设备与同步 → 诊断与维护」';

const dataDirOpened = (dir: string): string => `已打开数据目录：${dir}。备份在 backups 子目录`;
const restartToApply = '请手动关闭并重新打开应用，恢复才会生效';

export const appRecoveryCopy = {
  stage: {
    storage: '存储初始化',
    data: '数据载入',
  },

  bootFailed: {
    corrupt: { what: '载入失败', next: '请从最近的备份恢复，或打开备份目录手动处理' },
    other: {
      what: '载入失败',
      reason: (stage: string) => `${stage}没有完成`,
      next: `请重启应用；仍失败请在${BACKUP_PATH}导入备份，并附日志反馈`,
    },
  },

  corrupt: {
    message: '数据库文件损坏，已停止写入。请从最近快照恢复并重启',
    writeBlocked: '数据库文件损坏，已停止写入',
    /** 作导出失败句的原因段，调用点再套 fail('导出', …) */
    exportBlocked: '数据库文件损坏，请从最近快照恢复后重试',
    reasonDesktop: '数据库文件损坏，重启应用会再试一次恢复',
    reasonOther: '数据库文件损坏，请从备份导入恢复',
    recoverUnsupported: '当前平台不支持自动恢复，请从备份文件导入或手动处理数据目录',
    nativeSqliteUnsupported: '当前平台不支持原生 SQLite',
  },

  fallback: {
    banner: '原生数据库不可用，已临时改用浏览器存储。本机数据未删除',
    badge: '临时回退',
    readOnly: '临时只读，修复存储后再改',
  },

  fallbackFirstRun: {
    title: '数据库没能打开',
    body: '原生数据库不可用，现在只能临时只读，建不了学期',
    next: '请先点「重试」；仍不行就重启应用，并导出日志反馈',
  },

  corruptDialog: {
    title: '数据库文件损坏',
    description: '数据目录里的备份快照仍可用',
    rawError: (message: string) => `原始错误：${message}`,
    recoverFailed: (reason: string) => `恢复失败：${reason}`,
    recoverIncomplete: '恢复没有完成，请打开数据目录手动处理',
    restored: (snapshot: string | null) => `已用快照 ${snapshot ?? '最近快照'} 恢复，正在重启…`,
    restartToApply,
    dataDirUnsupported: '当前平台不支持打开数据目录，请手动定位程序旁的 data 目录',
    dataDirOpened,
    laterButton: '稍后',
    openDataDirButton: '打开数据目录',
    recoverButton: '立即恢复并重启',
  },

  recovery: {
    retryFailed: { what: '重试失败', reason: '当前环境不能自动重启', next: '请手动关闭并重新打开应用' },
    emptyLog: '暂无日志',
    logFileFilter: '日志文件',
    logSaveFailed: {
      what: '打开日志失败',
      reason: '日志没能写出',
      next: `请稍后重试；仍失败请在${LOGS_PATH}打开日志目录`,
    },
    logReadFailed: {
      what: '打开日志失败',
      reason: '日志暂时读不出来',
      next: `请稍后重试；仍失败请在${LOGS_PATH}查看`,
    },
    logDownloaded: '已下载日志',
    logExported: '已导出日志',
    restoreFailed: {
      what: '恢复失败',
      reason: '没有读到可用备份',
      next: '请打开备份目录手动处理，或重启应用后再试',
    },
    restoreQueued: (name: string | null) => `已排队恢复 ${name ?? '最近的快照'}，正在重启…`,
    restartToApply,
    backupDirFailed: {
      what: '打开备份目录失败',
      reason: '当前平台不支持打开数据目录',
      next: `请在${BACKUP_PATH}导出或导入备份`,
    },
    dataDirOpened,
  },
} as const;
