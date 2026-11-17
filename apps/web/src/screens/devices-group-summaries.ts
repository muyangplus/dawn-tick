/**
 * 设备与同步页分组清单的摘要行：纯函数，页面只把当前状态传进来。
 *
 * 分组导航里每行只有标题与一行摘要的空间，摘要要回答「现在是什么状态」，
 * 而不是重复标题；因此全部由状态拼出，便于单测，也让页面层不掺文案逻辑。
 */

/** 原生数据目录：默认位置 / 自定义位置；null 表示当前端读不到（浏览器、安卓）。 */
export type StorageLocationKind = 'default' | 'custom' | null;

export interface DeviceGroupSummaryInput {
  /** 存储类型的可读文案，如 SQLite / 浏览器 IndexedDB */
  storageKind: string;
  /** 原生数据目录类型；null 表示当前端不提供 */
  storageLocation: StorageLocationKind;
  /** 浏览器持久化权限：已授权 / 未授权 / null 未申请或不支持 */
  persistent: boolean | null;
  /** 本机快照份数 */
  snapshotCount: number;
  version: string;
  /** 渠道文案：正式版 / 测试版 / 开发版 */
  channelLabel: string;
  /** WebDAV 地址是否已配置（与 davConfigured 同口径） */
  webdavConfigured: boolean;
  logLevel: string;
  logEnabled: boolean;
}

/** 七个分组各自的清单摘要，键与分组 id 一致。 */
export interface DeviceGroupSummaries {
  storage: string;
  backup: string;
  update: string;
  webdav: string;
  lan: string;
  maintenance: string;
  about: string;
}

/**
 * 存储摘要：原生端优先说数据目录（默认 / 自定义），浏览器端说持久化授权，
 * 两者都拿不到时只留存储类型，避免编造状态。
 */
function storageSummary(input: DeviceGroupSummaryInput): string {
  if (input.storageLocation !== null) {
    return `${input.storageKind} · ${input.storageLocation === 'custom' ? '自定义位置' : '默认位置'}`;
  }
  if (input.persistent !== null) {
    return `${input.storageKind} · ${input.persistent ? '已持久化' : '未持久化'}`;
  }
  return input.storageKind;
}

/**
 * 局域网配对的令牌只留在组件会话里（离开页面即失效），页面层拿不到「已配对」，
 * 所以这一行给稳定的能力说明，不假装状态。
 */
const LAN_SUMMARY = '同局域网直传';

export function deviceGroupSummaries(input: DeviceGroupSummaryInput): DeviceGroupSummaries {
  return {
    storage: storageSummary(input),
    backup:
      input.snapshotCount === 0 ? '暂无快照' : `最近 ${input.snapshotCount} 份快照`,
    update: `${input.version} · ${input.channelLabel}`,
    webdav: input.webdavConfigured ? '已配置' : '未配置',
    lan: LAN_SUMMARY,
    maintenance: `日志级别 ${input.logLevel}${input.logEnabled ? '' : ' · 已关闭'}`,
    about: `v${input.version}`,
  };
}
