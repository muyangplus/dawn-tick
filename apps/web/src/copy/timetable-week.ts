/** 周视图：表头、课卡、空格新建、拖动改期与空状态。 */

export const weekCopy = {
  viewAria: '周视图',
  periodColumn: '节次',
  todayMark: '今天',
  holidayMark: '放假',

  /** 课卡 */
  weekAria: (week: number) => `第 ${week} 周`,
  eventBadgeFallback: '日程',
  movedInBadge: '调课',
  holidayFallback: '放假',

  /** 重叠提示：与「高等数学」第 1–2 节重叠 */
  clash: (name: string, range: string) => `与「${name}」${range}重叠`,
  clashShort: (name: string) => `与「${name}」重叠`,
  clashCanContinue: (clash: string) => `${clash}，仍可新建`,
  rangeAdjusted: (range: string) => `已调整为 ${range}`,

  /** 空格新建 */
  createHereAria: '在此新建课程',
  prevPeriodAria: '上一节',
  nextPeriodAria: '下一节',
  periodRangeAria: '节次范围',
  periodWheelTitle: '拖动、滚轮或 ↑/↓ 调整节次；Enter 新建，Esc 取消',

  /** 空状态 */
  outsideTitle: '学期外没有课程',
  outsideDescription: '当前日期不在学期内',
  outsideAction: '回到学期内',
  otherWeeksTitle: '这段时间只有非本周课程',
  otherWeeksDescription: '打开「显示非本周课程」可看到虚线课卡',
  otherWeeksAction: '添加课程',
  vacuumTitle: '这段时间没有课程',
  vacuumDescriptionCompact: '点右下角「＋」添加，或在设置里导入课表',
  vacuumDescription: '点右上角「＋」添加，或在设置里导入课表',
  importAction: '导入课表',
} as const;
