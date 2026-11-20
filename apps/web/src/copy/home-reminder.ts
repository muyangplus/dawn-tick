import { COUNT } from './common.ts';

/** 课程详情里的「课前提醒」分区。 */
export const courseReminderCopy = {
  sectionTitle: '课前提醒',
  useGlobalLabel: '使用全局配置',
  customDescription: '本课程单独设置',
  presetButton: (minutes: number) => COUNT('minute', minutes),
  customButton: '自定义',
  advanceLabel: '提前分钟数',
  skipHolidays: '放假当天不提醒',
  snooze: '允许贪睡 5 分钟',
  saveButton: '保存提醒',
  deleteButton: '删除提醒',
  saving: '正在保存提醒…',
  saved: (minutes: number) => `已设置课前 ${COUNT('minute', minutes)}提醒`,
  saveFailed: '保存提醒失败',
  deleting: '正在删除提醒…',
  deleted: '已删除提醒',
  deleteFailed: '删除提醒失败',
  retryNext: '请重试；仍失败请重新打开课程详情',
  deleteConfirmTitle: '删除提醒',
  deleteConfirmDescription: '将删除这节课的课前提醒，不可撤销',
  deleteConfirmButton: '确认删除',
} as const;
