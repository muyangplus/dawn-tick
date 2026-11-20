import { DELETE, OVERWRITE } from './common.ts';

/** 设置 → 备份与恢复：自动快照、快照列表、恢复与删除；以及错误页的「从备份恢复」。 */
export const snapshotsCopy = {
  autoSnapshot: '自动快照',
  snapshotOnStart: '启动时快照一次',
  snapshotOnStartLabel: '启动时快照',
  snapshotDaily: '每天快照一次',
  snapshotDailyLabel: '每天快照',
  keepLabel: '保留份数',
  keepHint: '1–100 份，超出后删除最旧的',
  createButton: '新建快照',
  kindFile: '整库文件快照，保存在数据目录',
  kindJson: '库内 JSON 快照',
  notEncrypted: '快照不加密。口令加密只用于导出的文件',
  empty: '暂无快照',
  restoreLabel: (id: string) => `恢复快照 ${id}`,
  restoreButton: '恢复',
  deleteLabel: (id: string) => `删除快照 ${id}`,
  deleteButton: '删除',
  transferElsewhere: '导出/导入备份与课表文件在「本地存储」分组',

  creating: '正在创建快照…',
  createWhat: '快照',
  checkLogNext: '请查看「应用诊断日志」后重试',
  backedUp: '已备份',
  created: (time: string, removed: number) =>
    `已生成快照 ${time}${removed > 0 ? `，清理了 ${removed} 份旧快照` : ''}`,
  deleting: '正在删除快照…',
  deleted: '已删除该快照',
  deleteWhat: '删除快照',
  restoreTitle: '恢复快照',
  restoreDescription: OVERWRITE('该快照', '，需重启后生效'),
  restoreConfirm: '恢复此快照',
  deleteTitle: '删除快照',
  deleteDescription: DELETE('该快照'),
  deleteConfirm: '删除此快照',
  restoring: '正在恢复快照…',
  restoreWhat: '恢复快照',
  restoreQueued: '已排好快照恢复，重启后生效',
  restored: '已恢复快照',
  restoredWithCounts: (imported: number, removed: number, snapshotTaken: boolean) =>
    `已恢复快照：写入 ${imported} 条，清空 ${removed} 条${snapshotTaken ? '。恢复前已创建快照' : ''}`,

  // backup.ts / lib/recovery.ts
  databaseNotOpen: '数据库尚未打开',
  fileSnapshotUnsupported: '当前平台不支持文件快照',
  snapshotMissing: '快照内容不存在',
  recoveryNoStorage: '恢复备份不使用本地存储',
  recoveryListFailed: '当前平台无法读取备份目录',
  recoveryNoSnapshot: '备份目录里没有可用快照',
  recoveryFailed: '恢复快照失败',
} as const;
