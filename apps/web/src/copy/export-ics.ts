/**
 * ICS 日历导出文案：日历名、事件类型前缀与导出说明。
 */
export const exportIcsCopy = {
  calendarName: (semester: string) => `${semester} 课表`,
  fileNameFallback: '课表',
  eventType: {
    exam: '考试',
    todo: '日程',
    temp: '临时',
    homework: '作业',
    lab: '实验',
  } as Record<string, string>,
  eventTypeFallback: '日程',
  notes: {
    missingClock: (count: number) => `${count} 条排课缺少作息时间，未写入 ICS`,
    unsupportedAdjust: (count: number) => `${count} 条调课记录无法写入 ICS`,
    skippedEvents: (count: number) => `${count} 条日程没有可用的日期或时间，未写入 ICS`,
    signMarkers: '节假日与调休标记不写入 ICS',
  },
} as const;
