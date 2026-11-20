import { COUNT, DELETE } from './common.ts';

/** 日程页时间线：条目性质、日期分组与行内文案。 */
export const timelineCopy = {
  cardTitle: '日程时间线',
  /** 条目性质角标；值同时写进 data-nature */
  nature: {
    lesson: '课程',
    adjust: '调整',
    todo: '日程',
    homework: '作业',
    exam: '考试',
    lab: '实验',
  },
  undated: '未排期',
  dateLabel: (month: number, day: number, weekday: string) => `${month} 月 ${day} 日 ${weekday}`,
  makeup: '调休',
  cancelled: '停课',
  /** 停课条目副标题：原来的节次与时间 */
  cancelledFrom: (period: string, time: string | null) => (time === null ? period : `${period} ${time}`),
  rescheduled: '调课',
  movedTo: (date: string, period: string | null) => (period === null ? `改至 ${date}` : `改至 ${date} ${period}`),
  overdue: '已过期',
  emptyTitle: '这一天没有待办',
  addTodoButton: '添加待办',
  completedGroup: (count: number) => `已完成 ${COUNT('plan', count)}`,
  completedToggle: (count: number, open: boolean) => `已完成 ${count}：${open ? '收起' : '展开'}`,
  allDone: '这一天的待办都已完成',
  tomorrowPreview: (count: number) => `明日预告：还有 ${COUNT('plan', count)}安排`,
  tomorrowButton: '看明天',
  autoDone: (title: string) => `已到时间自动完成：${title}`,
  markDone: (title: string) => `标记完成：${title}`,
  dueLabel: '截止',
  running: '进行中',
  editEvent: (title: string) => `编辑日程：${title}`,
  openLesson: (title: string) => `查看课程详情：${title}`,
  deleteAdjustLabel: (title: string) => `删除调整：${title}`,
  deleteButton: '删除',
  deleteAdjustTitle: '删除调课记录',
  deleteAdjustDescription: DELETE('这次调课记录'),
  deleteEventTitle: '删除待办',
  deleteEventDescription: (title: string) => DELETE(title, ['关联提醒']),
  deleteConfirmButton: '确认删除',
} as const;
