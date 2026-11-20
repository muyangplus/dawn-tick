/**
 * 提醒文案：通知动作按钮、动作结果提示与通知权限状态。
 */
export const reminderCopy = {
  defaultTitle: '提醒',
  action: {
    snooze: (minutes: number) => `贪睡 ${minutes} 分钟`,
    done: '完成',
    mute: (minutes: number) => `勿扰 ${minutes} 分钟`,
  },
  snoozed: (minutes: number) => `已贪睡 ${minutes} 分钟`,
  muted: (minutes: number) => `已勿扰 ${minutes} 分钟`,
  doneMissingTarget: '标记完成失败：找不到该条目',
  doneFailed: '标记完成失败，请到条目里重试',
  doneToast: '已标记完成',
  actionFailed: '处理提醒动作失败，请重试',
  permissionDenied: '通知权限未授予，提醒不会弹出。请在系统设置开启通知',

  notifyState: {
    loading: '读取中…',
    unsupported: '当前环境不支持通知',
    unreadable: '通知状态不可读',
    'not-applied': '未申请',
    granted: '已允许',
    denied: '已拒绝',
    'permanently-denied': '已拒绝且不再询问',
    'app-disabled': '通知已关闭',
    'channel-muted': '通知渠道已静音',
  },
  openSystemSettings: '去系统设置开启',
  requestAgain: '重新申请通知权限',
} as const;
