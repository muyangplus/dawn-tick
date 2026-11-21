/**
 * 学期报表（CSV）与学期周次文案。
 */
export const exportReportCopy = {
  semester: '学期',
  range: '起止',
  rangeValue: (start: string, end: string) => `${start} 至 ${end}`,
  totalWeeks: '总周数',
  pastLessons: '已上课时',
  upcomingLessons: '待上课时',
  note: '说明',
  noteValue: '停课的课次计入已上课时',
  course: '课程',
  totalLessons: '总课时',
  remainingLessons: '剩余课时',
  week: '周次',
  weekValue: (week: number) => `第 ${week} 周`,
  exam: '考试',
  date: '日期',
  status: '状态',
  dateUnknown: '日期待定',
  examTaken: '已考',
  examPending: '待考',

  weekText: {
    before: (total: number) => `未开学 · 共 ${total} 周`,
    after: (total: number) => `学期已结束 · 共 ${total} 周`,
    during: (current: number, total: number) => `第 ${current} 周 / 共 ${total} 周`,
  },
} as const;
