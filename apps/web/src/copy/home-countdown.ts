/** 日程页侧列「倒计时」卡片。 */
export const countdownCopy = {
  cardTitle: '倒计时',
  untilSemester: (days: number) => `距开学还有 ${days} 天`,
  untilHoliday: (name: string, days: number) => `距${name}还有 ${days} 天`,
  emptyTitle: '还没有倒计时',
  emptyDescription: '在待办里打开「开启倒计时」',
  addExamButton: '加考试',
  editEvent: (title: string) => `编辑日程：${title}`,
  markDone: (title: string) => `标记完成：${title}`,
  seat: (seat: string) => `座位 ${seat}`,
  /** 条目类型角标 */
  type: {
    homework: '作业',
    exam: '考试',
    lab: '实验',
    todo: '日程',
    temp: '日程',
  } as Record<string, string>,
  typeFallback: '日程',
} as const;
