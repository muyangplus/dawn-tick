/** 设置 · 课表显示。 */
export const timetableSettingsCopy = {
  viewDaysLabel: '周视图天数',
  viewDaysHint: '1–7 天',
  viewDaysHelp: '列宽按屏宽等分，不横向滚动',
  days: (count: number) => `${count} 天`,
  weekStartsTodayLabel: '今天为第一天',
  weekStartsTodayDescription: '关闭后从本周一开始',
  hideWeekendsLabel: '始终不显示周末',
  hideWeekendsDescription: '跳过周六日',
  showOtherWeeksLabel: '周视图显示非本周课程',
  showOtherWeeksDescription: '这一周不上的课用虚线框标出',
} as const;
