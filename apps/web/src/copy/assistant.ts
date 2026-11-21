/** AI 助手：执行结果与失败原因。 */
export const assistantHostCopy = {
  noSemester: '还没有学期',
  saveCancelled: '已取消保存',
  backupExported: (rows: number) => `已导出完整备份，共 ${rows} 条`,
  backupFailed: '导出备份失败',
  snapshotFailed: '快照生成失败，请查看「应用诊断日志」',
  snapshotCreated: (id: string) => `已生成快照 ${id}`,
  snapshotMissing: (id: string) => `找不到快照 ${id}`,
  restoreFailed: '恢复快照失败',
  webdavFailed: 'WebDAV 操作失败',
  webdavPasswordUnreadable: '读取 WebDAV 密码失败，请到 设备与同步 → WebDAV 重新填写',
  lanDeviceMissing: (id: string) => `找不到设备 ${id}`,
  lanOffline: (name: string, reason: string) => `${name} 不在线：${reason}`,
  lanFailed: '局域网同步失败',
  updateFailed: '检查更新失败',
} as const;

