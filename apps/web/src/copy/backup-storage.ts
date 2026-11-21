/** 设置 → 本地存储：存储类型、存储位置、数据库文件与 WAL 模式；以及 `storage-config.ts` 的错误。 */
export const storageCopy = {
  storageKind: (kind: string) => `本地存储：${kind}`,
  persistence: (state: string) => `浏览器持久化：${state}`,
  persistenceNotRequested: '未申请',
  persistenceGranted: '已授权',
  persistenceDenied: '未授权',
  location: (dir: string, edition: string) => `存储位置：${dir}${edition}`,
  locationReading: '读取中',
  editionPortable: '（便携版）',
  editionInstalled: '（安装版）',
  locationAndroid: '存储位置：应用私有目录（不可改）',
  customLabel: '自定义存储位置',
  customHint: '留空用默认位置',
  customHelp: '相对路径以程序目录为起点。重启后生效。',
  saveLabel: '保存存储位置',
  saveButton: '保存位置',
  resetLabel: '恢复默认存储位置',
  resetButton: '恢复默认',
  openDataDir: '打开数据目录',
  openDataDirNext: '请手动到程序目录查看',
  dbDetail: (file: string, sizeKb: number | null, sidecars: readonly string[]) =>
    `数据库文件：${file}（${sizeKb === null ? '尚未创建' : `${sizeKb} KB`}）` +
    (sidecars.length > 0 ? `，附带 ${sidecars.join(' / ')}` : '，无附带文件'),

  saving: '正在保存存储位置…',
  saveWhat: '保存存储位置',
  saveNext: '请检查路径后重试',
  saved: (copied: number) => (copied > 0 ? `已保存存储位置，复制了 ${copied} 个数据文件` : '已保存存储位置'),
  savedTo: (dir: string, copied: number) => `已写入 ${dir}${copied > 0 ? `，复制了 ${copied} 个数据文件` : ''}`,

  transferTitle: '导出与导入',

  walLabel: '启用 WAL 日志模式',
  walSaved: '已保存 WAL 日志模式',
  walAuto: (on: boolean) => `跟随默认：便携版关闭、安装版开启（当前${on ? '开启' : '关闭'}）`,
  walOn: '已手动开启：数据库旁有 -wal / -shm 两个文件',
  walOff: '已手动关闭：数据库为单个文件',

  // storage-config.ts
  fallbackLabel: '临时回退',
  unsupported: '当前平台不支持修改存储位置',
  noTray: '当前平台没有托盘',
} as const;
