/**
 * 通用格式文案：节次范围、倒计时、天数，以及课表里日程条目的角标。
 */
export const formatCopy = {
  periodSingle: (period: number) => `第 ${period} 节`,
  periodRange: (from: number, to: number) => `第 ${from}–${to} 节`,
  startingSoon: '即将开始',
  minutes: (minutes: number) => `${minutes} 分钟`,
  hours: (hours: number) => `${hours} 小时`,
  hoursMinutes: (hours: number, minutes: number) => `${hours} 小时 ${minutes} 分`,
  today: '今天',
  days: (days: number) => `${days} 天`,

  /** 课表格子里日程条目的角标，按 events.type 取 */
  eventBadge: {
    lab: '实验',
    homework: '作业',
    exam: '考试',
    todo: '日程',
    temp: '日程',
  } as Record<string, string>,
  eventBadgeFallback: '日程',
  holidayFallback: '放假',
} as const;
