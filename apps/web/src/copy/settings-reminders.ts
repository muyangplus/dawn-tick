/** 设置 · 提醒：通知权限、安卓系统权限、课前提醒默认值。 */
import { COUNT, fail } from './common.ts';

export const remindersCopy = {
  requestNotify: '申请通知权限',
  openSystemSettings: '去系统设置',
  notifyStatus: (label: string) => `通知权限：${label}`,
  notifyOffHint: '关闭后不再提醒',
  openNotifySettingsFailed: fail('打开系统设置', null, '请手动到系统设置里开启通知'),
  exactAlarmAria: '开启精确闹钟',
  exactAlarmButton: '去开启',
  exactAlarmGranted: '已开启精确闹钟',
  exactAlarmStillDenied: '精确闹钟未开启。请到系统设置里允许',
  exactAlarmStatus: { granted: '已开启', denied: '未开启', unsupported: '不适用' },
  exactAlarmLine: (state: string) => `精确闹钟：${state}`,
  batteryAria: '申请加入电池优化白名单',
  batteryButton: '去设置',
  batteryGranted: '已加入电池优化白名单',
  batteryStillLimited: '未加入电池优化白名单。提醒可能延后',
  batteryStatus: {
    loading: '读取中…',
    free: '已加入电池优化白名单',
    limited: '受电池优化限制，提醒可能延后',
  },
  batteryLine: (state: string) => `后台运行：${state}`,
  classReminderLabel: '课前提醒',
  classReminderDescription: '所有课程默认提醒',
  leadLabel: '默认提前',
  leadAria: (minutes: number) => `提前 ${COUNT('minute', minutes)}`,
  leadOption: (minutes: number) => COUNT('minute', minutes),
  leadCustomAria: '自定义提前分钟',
  upcoming: (count: number, next?: { time: string; title: string }) =>
    next === undefined
      ? `接下来 7 天待提醒 ${COUNT('reminder', count)}`
      : `接下来 7 天待提醒 ${COUNT('reminder', count)} · 最近 ${next.time} ${next.title}`,
} as const;
