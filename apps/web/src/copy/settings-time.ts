/** 设置 · 时间与日程。 */
export const timeCopy = {
  timeZoneLabel: '时区',
  timeZoneHelp: '默认上海。首次启动按系统时区对齐一次。',
  timeZoneInvalid: '时区名无效',
  timeZoneOffset: (offset: string) => `(${offset})`,
  timeZoneEmpty: '没有匹配的时区。请输入城市或地区名',
  autoTimeZone: '时区跟随设备',
  todoSortLabel: '待办排序',
  todoSort: { start: '按开始时间', type: '按类型' },
  todoSortTypeOption: '按类型（作业 → 考试 → 实验 → 日程）',
} as const;
