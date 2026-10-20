/** 周视图空态的三态：真空课表 / 只有非本周 / 学期外；none 表示有可见课程。 */
export type WeekEmptyKind = 'none' | 'vacuum' | 'other-weeks' | 'outside-semester';

export interface WeekEmptyInput {
  /** 窗口内真正画出来的课次（含按设置显示的虚线课） */
  visibleLessons: number;
  /** 窗口完全落在学期之外（每列都在第 1 周之前或总周数之后） */
  outsideSemester: boolean;
  /** 窗口里存在非本周课程（可能被「显示非本周」开关隐藏） */
  hasOtherWeekLessons: boolean;
}

/**
 * 空态判据：窗口内没有任何可见课程（含 ghost / 非本周虚线课）才算空。
 * 三态优先级：学期外 → 只有非本周 → 真空课表，保证每种空态只对应一种说法与一个主行动。
 */
export function weekEmptyKind(input: WeekEmptyInput): WeekEmptyKind {
  if (input.visibleLessons > 0) return 'none';
  if (input.outsideSemester) return 'outside-semester';
  if (input.hasOtherWeekLessons) return 'other-weeks';
  return 'vacuum';
}
