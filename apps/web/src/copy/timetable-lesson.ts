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
  deleteScheduleConfirm: '确认删除',
  scheduleDeleted: '已删除排课',
  deleteCourseTitle: '删除课程',
  deleteCourseConfirm: '确认删除',
  schedulesPart: '排课',
  remindersPart: '提醒',
  courseDeleted: (name: string) => `已删除「${name}」`,

  /** 课表单击已调整的课次：说明、修改与删除 */
  adjustAria: '这一次课的调整',
  adjustCancelled: (date: string) => `${date} 这一次已停课`,
  adjustMovedOut: (date: string, newDate: string, period: string | null) =>
    period === null ? `${date} 这一次已调到 ${newDate}` : `${date} 这一次已调到 ${newDate} ${period}`,
  adjustMovedIn: (date: string) => `由 ${date} 的课调来`,
  editAdjustButton: '修改调整',
  deleteAdjustButton: '删除调整',
  deleteAdjustTitle: '删除调整',
  deleteAdjustDescription: '删除后这一次课恢复原样。',
  deleteAdjustConfirm: '确认删除',
  adjustDeleted: '已删除调整',
  adjustDeleteWhat: '删除调整',
  adjustSourceMissing: '找不到原来的排课，只能删除这条调整',
} as const;
