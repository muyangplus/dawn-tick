/** 设置 · 提醒 · 勿扰时段。 */
export const quietHoursCopy = {
  label: '勿扰时段',
  description: '时段内不弹提醒',
  modeLabel: '时段内的提醒',
  modeHelp: '结束早于开始表示跨到次日。顺延后课已开始的提醒不再弹出。',
  mode: { defer: '顺延到结束', skip: '跳过' },
  weekdaysAria: '星期',
  startAria: '开始时间',
  endAria: '结束时间',
  rangeSeparator: '至',
  deleteRuleAria: (rule: string) => `删除勿扰时段 ${rule}`,
  addRule: '添加时段',
  everyDay: '每天',
  workdays: '工作日',
  weekend: '周末',
  daysJoin: (labels: readonly string[]) => labels.join('、'),
  rule: (days: string, start: string, end: string, crossesMidnight: boolean) =>
    `${days} ${start}–${crossesMidnight ? '次日 ' : ''}${end}`,
} as const;
