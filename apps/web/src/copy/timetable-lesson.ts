/** 课程详情：时段列表、删除与调课入口。 */
export const lessonCopy = {
  credits: (credits: number) => `${credits} 学分`,
  closeAria: '关闭课程详情',
  schedulesAria: '排课时段',
  schedulesTitle: '时段',
  weeksUnmarked: '未标注周次',
  editScheduleAria: '编辑该排课',
  deleteScheduleAria: '删除该排课',
  noteTitle: '备注',
  adjustButton: '调课',
  editButton: '编辑课程与时段',
  deleteCourseButton: '删除整门课',

  deleteScheduleTitle: '删除排课',
  deleteScheduleConfirm: '删除排课',
  scheduleDeleted: '已删除排课',
  deleteCourseTitle: '删除课程',
  deleteCourseConfirm: '删除课程',
  schedulesPart: '排课',
  remindersPart: '提醒',
  courseDeleted: (name: string) => `已删除「${name}」`,
} as const;
