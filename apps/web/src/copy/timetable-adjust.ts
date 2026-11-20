/** 调课弹窗：五种调课操作、各自的字段，以及计划校验的提示。 */

const RETRY_NEXT = '请重试；仍失败请重新打开调课弹窗';

export const adjustCopy = {
  title: '调课',
  modesAria: '调课操作',
  modes: {
    move: '改期',
    cancel: '停课',
    swap: '调休',
    extra: '临时加课',
    exam: '改为考试',
  },
  /** 主按钮按模式写具体动作 */
  submit: {
    move: '改期',
    cancel: '停课',
    swap: '调休',
    extra: '加课',
    exam: '改为考试',
  },
  cancelButton: '取消',

  descriptionMove: (course: string, from: string, to: string) => `把「${course}」${from}改到 ${to}`,
  descriptionCancel: (course: string, date: string) => `停掉「${course}」${date} 这一次课，其他周不变`,
  descriptionSwap: '把原日期的课表整体搬到目标上课日',
  descriptionExam: (course: string, date: string, examDate: string) =>
    `把「${course}」${date} 这一次课改成 ${examDate} 的考试，原课次从课表移除`,
  descriptionExtra: '只加这一次，可在课程管理里删除',
  fallbackCourseName: '课程',

  overlapToast: (name: string, range: string) => `与「${name}」${range}重叠，两门课都已保留`,

  weeklyBusy: '正在改为每周…',
  weeklyDone: (weekday: string, range: string) => `已改为每周 ${weekday} ${range}`,
  weeklyFail: { what: '改为每周失败', next: RETRY_NEXT },
  moveBusy: '正在调课…',
  moveDone: (date: string, range: string) => `已把这一次课调到 ${date} ${range}`,
  moveFail: { what: '调课失败', next: RETRY_NEXT },
  cancelBusy: '正在停课…',
  cancelDone: '已记录停课',
  cancelFail: { what: '停课失败', next: RETRY_NEXT },
  examBusy: '正在改为考试…',
  examDone: (date: string, range: string) => `已改为考试：${date} ${range}`,
  examFail: { what: '改为考试失败', next: RETRY_NEXT },
  swapBusy: '正在调休…',
  swapDone: '已记录调休',
  swapFail: { what: '调休失败', next: RETRY_NEXT },
  extraBusy: '正在临时加课…',
  extraDone: (week: number, weekday: string) => `已加课：第 ${week} 周 ${weekday}`,
  extraFail: { what: '临时加课失败', next: RETRY_NEXT },

  /** 来源字段：哪门课、哪个课次、哪一天 */
  courseLabel: '课程',
  coursePlaceholder: '选择课程',
  noSchedules: '这门课没有排课，请在课程管理中添加',
  scheduleLabel: '课次',
  schedulePlaceholder: '选择课次',
  sourceDateLabel: '原日期',
  sourceDateHintExam: '这一天的这节课会被移除',
  sourceDateHintMove: '这一天的这节课会被调整',

  /** 改期 */
  scopesAria: '生效范围',
  scopes: {
    this: { label: '这一次', hint: '只改原日期所在周的这一次课' },
    weekly: { label: '每周', hint: '改课表本身，之后每周都在新时间' },
    week: { label: '指定周', hint: '调到指定周次' },
    date: { label: '指定日期', hint: '调到任意一天，可跨周、换星期' },
  },
  targetWeekLabel: '目标周',
  targetWeekHint: (total: number) => `1–${total} 周`,
  newDateLabel: '调整后日期',
  newDateHint: {
    weekly: '取它的星期几作为每周上课日',
    week: '取它的星期几落在「目标周」',
    this: '与原日期同一周内',
    date: '可跨周、换星期',
  },
  periodStartLabel: '起始节',
  periodEndLabel: '结束节',
  roomLabel: '教室（可选）',

  /** 改为考试 */
  examDateLabel: '考试日期',
  examDateHint: '默认取「调整后日期」，可跨周',
  examStartAria: '考试起始节',
  examEndAria: '考试结束节',
  examNoteLabel: '备注（可选）',
  examNoteAria: '考试备注',
  examNotePlaceholder: '如 开卷、带计算器',
  examFootnote: '考试写入日程并倒计时。原课次按停课处理。',

  /** 调休 */
  swapFromLabel: '原日期课表',
  swapToLabel: '目标上课日',
  swapToHelp: '调休后，目标日按原日期的课表上课',

  /** 临时加课 */
  extraCourseLabel: '已有课程',
  extraNameLabel: '或自定义课程名称',
  extraNameHint: '填写后按此名称新建课程',
  extraNamePlaceholder: '如 形势与政策（补课）',
  extraDateLabel: '加课日期',
  extraFootnote: '只加这一次，可在课程管理里删除',

  /** 计划校验 */
  noSemester: '没有学期，请先在设置里新建学期',
  pickDate: (label: string) => `请先选择${label}`,
  dateOutOfSemester: (label: string, first: string, last: string) =>
    `${label}不在学期内，请选 ${first} 至 ${last} 之间的日期`,
  pickMoveSource: '请先选课程与要调整的课次',
  pickCancelSource: '请先选课程与要停的课次',
  pickExamSource: '请先选课程与要改成考试的课次',
  invalidPeriods: '节次无效，请从第 1 节起填写，结束节不小于起始节',
  sameAsBefore: '目标与原时间相同，请改日期或节次',
  targetWeekRange: (total: number) => `目标周超出范围，请填 1–${total}`,
  targetWeekOutOfSemester: (first: string, last: string) =>
    `目标周超出学期范围（${first} 至 ${last}），请换一周`,
  thisScopeCrossWeek: '「这一次」只改本周；跨周请改用「指定日期」',
  noSlotForPeriods: (start: number, end: number) => `第 ${start}–${end} 节没有作息时间，请先在节次设置中补上`,
  pickExtraCourse: '请选择课程或填写课程名称',

  /** 写进数据的标题：调课记录、停课记录、考试与调休日程 */
  moveRecordTitle: (course: string) => `调课：${course}`,
  cancelRecordTitle: (course: string) => `停课：${course}`,
  examFallbackTitle: '考试',
  examRecordTitle: (title: string) => `改为考试：${title}`,
  swapEventTitle: (from: string, to: string) => `${from} 的课表调到 ${to}`,
} as const;
