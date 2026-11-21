/** 设备与同步页：分组标题与各分组的一行摘要。 */
export const devicesCopy = {
  pageTitle: '设备与同步',
  groupsLabel: '设备与同步分组',
  groupStorage: '本地存储',
  groupBackup: '备份与恢复',
  groupUpdate: '更新',
  groupWebdav: 'WebDAV 同步',
  groupLan: '局域网同步',
  groupMaintenance: '诊断与维护',
  groupAbout: '关于',

  locationCustom: '自定义位置',
  locationDefault: '默认位置',
  persisted: '已持久化',
  notPersisted: '未持久化',
  joined: (...parts: string[]) => parts.join(' · '),
  lanSummary: '同局域网直传',
  noSnapshots: '暂无快照',
  recentSnapshots: (count: number) => `最近 ${count} 份快照`,
  webdavConfigured: '已配置',
  webdavNotConfigured: '未配置',
  logLevel: (level: string, enabled: boolean) => `日志级别 ${level}${enabled ? '' : ' · 已关闭'}`,
} as const;
