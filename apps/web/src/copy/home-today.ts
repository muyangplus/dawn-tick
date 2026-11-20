import { COUNT } from './common.ts';

/** 日视图（今天）。 */
export const todayCopy = {
  regionLabel: '日视图',
  summaryInSemester: (week: number, lessons: number) => `第 ${week} 周 · ${COUNT('lesson', lessons)}课`,
  summary: (lessons: number) => `${COUNT('lesson', lessons)}课`,
  currentLabel: '正在上课',
  nextLabel: '下一节课',
  remaining: (text: string) => `剩余 ${text}`,
  emptyToday: '今天没有课',
  emptyDay: '这一天没有课',
  openWeekButton: '查看周视图',
  openLesson: (name: string) => `查看课程详情：${name}`,
} as const;
