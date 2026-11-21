import { COUNT } from './common.ts';

/** 日程页侧列「学期概览」卡片。 */
export const statsCopy = {
  cardTitle: '学期概览',
  emptyTitle: '还没有课时与考试',
  emptyDescription: '添加课程后显示统计',
  addCourseButton: '添加课程',
  semesterFallback: '学期',
  csvFilterName: 'CSV 文件',
  exportButton: '导出报表',
  exported: '已导出学期报表',
  noSemester: '还没有学期数据',
  lessonsSection: '课时',
  weeksSection: '每周课时',
  coursesSection: '课程进度',
  examsSection: '考试',
  past: '已上',
  upcoming: '待上',
  cancelledNote: '停课的课次计入已上',
  weekBar: (week: number, past: number, upcoming: number) =>
    `第 ${week} 周：已上 ${COUNT('lesson', past)}，待上 ${COUNT('lesson', upcoming)}`,
  weekLabel: (week: number) => `第 ${week} 周`,
  noExams: '本学期还没有考试安排',
  examTotal: '共',
  examTaken: '已考',
  examUpcoming: '待考',
  nextExam: (title: string, daysUntil: number, date: string) =>
    `最近一场「${title}」${daysUntil === 0 ? '就在今天' : `还有 ${daysUntil} 天`}（${date}）`,
  dateTbd: '日期待定',
} as const;
