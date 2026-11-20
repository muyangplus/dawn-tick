/**
 * 日志范围清单：Web、Rust（`logging.rs` 的 `LOG_SCOPES`）、Android（`NativeLog.SCOPES`）三端共用同一组名字。
 * 新增范围须三处同步，`tools/verify` 的检查会比对。
 */
export const LOG_SCOPES = {
  app: '启动、运行时、窗口与托盘',
  storage: '数据库、本地存储与恢复',
  backup: '备份、导出与快照',
  sync: '局域网同步与 WebDAV',
  reminder: '提醒调度与通知',
  permission: '系统权限',
  widget: '小组件与悬浮窗',
  update: '应用更新',
  preset: '预设下载与校验',
  import: '课表导入与教务窗口',
  timetable: '课表、学期与调课',
  todo: '待办',
  settings: '设置与开机自启',
  credentials: '凭据保存',
  link: '外部链接',
  log: '日志本身',
} as const;

export type LogScope = keyof typeof LOG_SCOPES;

export const LOG_SCOPE_NAMES = Object.keys(LOG_SCOPES) as LogScope[];
