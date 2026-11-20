/**
 * 悬浮窗文案（mini.html）：标题栏、各样式的空态与倒计时。
 */
import { appShellCopy } from './app-shell.ts';

export const miniCopy = {
  rootMissing: '#mini-root 缺失',
  defaultLabel: appShellCopy.appName,
  openAria: '打开主窗口',
  openButton: '打开',
  hideAria: '隐藏悬浮窗',
  resizeAria: '调整悬浮窗大小',

  loadFailed: { what: '课表读取失败', reason: '数据暂时读不出来', next: '请稍后重试；仍失败请重启应用' },
  initFailed: {
    what: '悬浮窗读取失败',
    reason: '无法打开本机数据',
    next: '请关闭后重新打开悬浮窗；仍失败请重启应用',
  },
  errorHint: '点右上「打开」进入主窗口修复数据',

  inClass: '正在上课',
  nextLesson: '下一节课',
  tomorrowPreview: '明日课程预告',
  weekdayPreview: (weekday: string) => `${weekday}课程预告`,
  dayAfterTomorrow: '后天',
  tomorrowCourse: (name: string) => `明日 ${name}`,
  noMoreLessons: '暂无后续课程',
  noSemester: '尚未创建学期',
  remaining: (time: string) => `剩余 ${time}`,
  examTitle: '考试倒计时',
  tasksLabel: '待办与作业',
  noTasks: '暂无待办',
  noLessonsToday: '今天没有课',
  noLessonsTomorrow: '明天也没有课',

  exam: {
    empty: '暂无考试',
    today: '就是今天',
    countdown: (days: string) => `还有 ${days}`,
    total: (count: number) => ` · 共 ${count} 场`,
  },
} as const;
