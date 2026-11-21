// 课表页面数据的形状。
import {
  dayOfWeek,
  type CourseRow,
  type CourseScheduleRow,
  type EventRow,
  type ManagedCourse,
  type Occurrence,
  type ReminderRow,
  type SemesterRow,
  type TimeSlotRow,
  type TodoSort,
} from '@dawn-tick/core';

export interface LessonCell {
  scheduleId: string;
  courseId: string;
  name: string;
  teacher: string | null;
  room: string | null;
  color: string;
  dayOfWeek: number;
  /** 该格所在日期（YYYY-MM-DD）：网格按「日期:节次」建键，一列就是窗口里的一天 */
  date: string;
  periodStart: number;
  periodEnd: number;
  startTime: string;
  endTime: string;
  /** 该课次所在日期是否落在查看窗口内；false 表示窗口外的周次，按设置虚线显示 */
  inWeek: boolean;
  /** 该课所在日期是否放假，放假则灰显 */
  holiday: boolean;
  /** 该课所在日期被「停课」：课表里灰显并标注，不参与拖动 */
  cancelled: boolean;
  /** 该课次被调到别处（本格当天不上）：灰显标「已调课」 */
  movedOut: boolean;
  /** 该格是调课后的落点：正常显示并标「调课」 */
  movedIn: boolean;
  /** 停课 / 调走 / 调入这一格的调课记录 id；课程详情据此显示调整内容并提供修改、删除 */
  adjustId?: string;
  /** 该格是实验条目（type = 'lab'）：标「实验」且不参与拖动 */
  lab: boolean;
  /** 条目标签（实验 / 作业 / 考试 / 日程）；课程格为空 */
  eventLabel?: string;
  /** 课表条目所属课程名（未关联课程时为空） */
  courseLabel?: string | null;
  /** 实验条目对应的行 id（课程格为空） */
  eventId?: string;
  /** 自定义时间（HH:MM）：非空时该格按真实时间定位，不按节次 */
  customStart?: string | null;
  customEnd?: string | null;
}

export interface AppData {
  timeZone: string;
  today: string;
  todayOfWeek: number;
  week: number;
  viewWeek: number;
  weekStartDate: string;
  /** 查看窗口的起始日期（YYYY-MM-DD，默认今天） */
  windowStart: string;
  /** 查看窗口里的每一天，长度 = 设置的周视图天数，连续日期 */
  windowDates: string[];
  /** 查看窗口覆盖到多个周次时为 true，供日志与自检 */
  windowSpansWeeks: boolean;
  /** 当前查看窗口内是否有任何课次，含只在别周上的虚线课（inWeek = false）：判空态时还要叠加「显示非本周」开关 */
  hasLessons: boolean;
  /** 当前学期的课程（含各条排课），供调课与临时加课选择 */
  courses: ManagedCourse[];
  /** 按日期查课次，供日程页切换日期查看过去与未来 */
  lessonsByDate: Map<string, Occurrence[]>;
  /** 放假日及其名称（内置节假日表 + 手工假日，扣除手工非假日） */
  holidayLabels: Map<string, string>;
  /** 调休上班日（内置 + 手工） */
  workdayDates: string[];
  semester: SemesterRow | null;
  semesters: SemesterRow[];
  slots: TimeSlotRow[];
  grid: Map<string, LessonCell[]>;
  todayLessons: Occurrence[];
  /** 待办排序方式：按开始时间 / 按类型 */
  todoSort: TodoSort;
  /** 明天的课：悬浮窗的「明日课程预告」用 */
  tomorrowLessons: Occurrence[];
  /** 现在正在上的那一节课（无课或停课时为 undefined） */
  currentLesson: Occurrence | undefined;
  nextLesson: Occurrence | undefined;
  exams: EventRow[];
  todos: EventRow[];
  /** 实验条目（type = 'lab'）：进课表网格与时间线 */
  labs: EventRow[];
  /** 开启倒计时的条目：倒计时卡片按时间排序展示 */
  countdowns: EventRow[];
  reschedules: EventRow[];
}

export interface CourseDetail {
  course: CourseRow | undefined;
  schedules: CourseScheduleRow[];
  reminder: ReminderRow | undefined;
}
