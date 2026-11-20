/** 设置页框架：分组标题、分组摘要、顶部提示与导入入口。 */
import { COUNT } from './common.ts';

export const settingsPageCopy = {
  pageTitle: '设置',
  groupsAriaLabel: '设置分组',
  backButton: '返回',
  backToListAria: (pageTitle: string) => `返回${pageTitle}列表`,
  groups: {
    semesters: '学期设置',
    reminders: '提醒设置',
    appearance: '外观与动效',
    timetable: '课表显示',
    slots: '作息与选校',
    widget: '悬浮窗与小组件',
    time: '时间与日程',
    ai: 'AI',
  },
  notifyBanner: '通知未授权，课前提醒不会弹出',
  importButton: '导入课表',
  importDialogTitle: '导入课表',
  importDialogDescription: '网页课表 / 教务窗口 / ICS / CSV / Excel',
} as const;

export const settingsSummaryCopy = {
  themeMode: { system: '跟随系统', light: '浅色', dark: '深色' },
  todoSort: { start: '按开始时间', type: '按类型' },
  widgetVariantShort: {
    bar: '条形',
    today: '今日课表',
    minimal: '极简数字',
    combo: '组合卡',
    exam: '考试倒计时',
  },
  widgetBackground: { light: '浅色', dark: '深色', transparent: '透明' },
  noSemester: '还没有学期',
  classReminderOn: (minutes: number) => `课前 ${COUNT('minute', minutes)}`,
  classReminderOff: '课前提醒已关闭',
  timetable: (viewDays: number, hideWeekends: boolean) =>
    `${viewDays} 天 · ${hideWeekends ? '隐藏周末' : '显示周末'}`,
  slots: (count: number) => `${COUNT('period', count)}节次`,
  pair: (left: string, right: string) => `${left} · ${right}`,
} as const;
