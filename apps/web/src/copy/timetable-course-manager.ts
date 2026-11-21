import { COUNT } from './common.ts';

/** 课程管理：课程列表、复制、删除与导入入口。 */
export const courseManagerCopy = {
  title: '课程管理',
  badge: (count: number) => COUNT('course', count),
  empty: '当前学期没有课程，可在下方导入课表',
  noTeacherOrLocation: '未填写教师与地点',
  copyAria: (name: string) => `复制课程 ${name}`,
  editAria: (name: string) => `编辑课程 ${name}`,
  removeAria: (name: string) => `删除课程 ${name}`,

  /** 排课摘要：周一 1-2节 A101 1-16周 */
  weeksUnmarked: '未标注周次',
  weeks: (ranges: string) => `${ranges}周`,
  unscheduled: '未排课',
  scheduleSummary: (weekday: string, periods: string, room: string, weeks: string) =>
    `${weekday} ${periods}节${room} ${weeks}`,
  summarySeparator: ' ｜ ',

  importTitle: '导入课表',
  importFormats: '网页课表 / 教务窗口 / ICS / CSV / Excel',

  copyTitle: '复制课程',
  copyDescription: (name: string, count: number) => `「${name}」有排课 ${COUNT('schedule', count)}`,
  copyInfoOnly: '只复制课程信息',
  copyWithSchedules: '连排课一起复制',
  cancel: '取消',
  copying: '正在复制课程…',
  copiedWithSchedules: (name: string, count: number) => `已复制「${name}」及排课 ${COUNT('schedule', count)}`,
  copied: (name: string) => `已复制「${name}」`,
  copyFail: { what: '复制课程失败', next: '请重试；仍失败请重新打开课程管理' },
  copyName: (name: string) => `${name} 副本`,

  removeTitle: '删除课程',
  schedulesPart: '排课',
  remindersPart: '提醒',
  removing: '正在删除课程…',
  removed: (name: string) => `已删除课程「${name}」`,
  removeFail: { what: '删除课程失败', next: '请重试；仍失败请重开应用后再删' },
} as const;
