import {
  activeSemester,
  addDays,
  builtinHolidayName,
  builtinHolidays,
  builtinWorkdayName,
  builtinWorkdays,
  DEFAULT_COURSE_COLOR,
  dayOfWeek,
  EXAM_COLOR,
  expand,
  currentOccurrence,
  formatDate,
  formatTime,
  hasWeek,
  isWeekend,
  LAB_COLOR,
  listManagedCourses,
  listSemesters,
  listTimeSlots,
  loadExpandInput,
  maskToWeeks,
  nextOccurrence,
  nextWorkday,
  periodAtClock,
  plusMinutesText,
  resolveTimeZone,
  weekOfDate,
  weekStart,
  type AppSettings,
  type CourseRow,
  type CourseScheduleRow,
  type EventRow,
  type ManagedCourse,
  type Occurrence,
  type ReminderRow,
  type SemesterRow,
  type Storage,
  type TimeSlotRow,
  type TodoSort,
} from '@dawn-tick/core';
import { clampWindowStart, dayRangeOf } from './lib/day-nav.ts';
import { dayStampUtc } from './lib/dates.ts';

/** 课表里条目的角标文案。 */
const EVENT_LABEL: Record<string, string> = {
  lab: '实验',
  homework: '作业',
  exam: '考试',
  todo: '日程',
  temp: '日程',
};

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

const LOOKAHEAD_DAYS = 14;
/** 课次日期范围：至少覆盖整个学期，学期外保留今天前后各一段 */
const OCCURRENCE_PAST_DAYS = 45;
const OCCURRENCE_FUTURE_DAYS = 60;
const USER_ID = 'u1';

export function weekDateOf(semester: SemesterRow, week: number, dayOfWeek: number): string {
  return addDays(weekStart(semester.start_date), (week - 1) * 7 + (dayOfWeek - 1));
}

/** 没指定窗口起点时的默认起点：今天为第一天，或本周周一；跳过周末时顺延到下一个工作日。 */
export function defaultWindowStart(today: string, settings: AppSettings): string {
  return resolveWindowStart(settings.weekStartsToday ? today : weekStart(today), settings);
}

/** 窗口起点落到周末时顺延到下一个工作日；没开「不显示周末」时原样返回。 */
export function resolveWindowStart(date: string, settings: AppSettings): string {
  return settings.hideWeekends ? nextWorkday(date) : date;
}

/** 排课落在哪些周次：没有位图时只有 fallback 那一周。 */
function weeksOf(mask: number | null, totalWeeks: number, fallback: number): number[] {
  if (mask === null || mask === undefined) return [fallback];
  return maskToWeeks(mask, totalWeeks);
}

/** 学期上下文：查看窗口覆盖哪几天、每天属于第几周。纯计算，不读 storage。 */
export interface SemesterContext {
  /** 今天所在周次（早于第 1 周时为 1） */
  currentWeek: number;
  /** 窗口第一天所在周次，夹在 1–总周数之间 */
  viewWeek: number;
  /** 窗口第一天的日期 */
  windowStart: string;
  /** 窗口里的每一天 */
  windowDates: string[];
  /** 窗口里每天所属的周次，与 `windowDates` 一一对应；早于第 1 周为 0，晚于总周数为溢出值 */
  weekOfDay: number[];
  /** 查看窗口的周一起点：用于「本周」标签与调课预填 */
  weekStartDate: string;
  windowSpansWeeks: boolean;
}

/**
 * 算查看窗口：显式起点优先，其次指定周次的周一，都没有按设置取今天或本周周一；
 * 最后夹进学期（Q6：今天落在学期外时窗口停在边界）。
 */
export function loadSemesterContext(input: {
  semester: SemesterRow;
  today: string;
  settings: AppSettings;
  options?: { viewWeek?: number; windowStart?: string | null };
}): SemesterContext {
  const { semester, today, settings } = input;
  const options = input.options ?? {};
  const currentWeek = Math.max(1, weekOfDate(today, semester.start_date));
  const windowStart = clampWindowStart(
    resolveWindowStart(
      options.windowStart ??
        (options.viewWeek === undefined ? defaultWindowStart(today, settings) : weekDateOf(semester, options.viewWeek, 1)),
      settings,
    ),
    dayRangeOf(semester),
  );
  const viewDays = Math.max(1, settings.viewDays);
  const windowDates: string[] = [];
  for (let offset = 0; windowDates.length < viewDays && offset < viewDays * 3 + 7; offset += 1) {
    const date = addDays(windowStart, offset);
    if (settings.hideWeekends && isWeekend(date)) continue;
    windowDates.push(date);
  }
  const weekOfDay = windowDates.map((date) => weekOfDate(date, semester.start_date));
  const viewWeek = Math.min(Math.max(1, weekOfDay[0] ?? currentWeek), semester.total_weeks);
  return {
    currentWeek,
    viewWeek,
    windowStart,
    windowDates,
    weekOfDay,
    weekStartDate: weekDateOf(semester, viewWeek, 1),
    windowSpansWeeks: new Set(weekOfDay).size > 1,
  };
}

/** 放假与调休：内置节假日表 + 手工「设为假日 / 非假日」，纯计算。 */
export interface HolidayContext {
  /** 放假日 → 名称 */
  holidayLabels: Map<string, string>;
  /** 放假日集合（判定灰色课次用） */
  holidayDates: Set<string>;
  /** 调休上班日，升序 */
  workdays: string[];
}

export function loadHolidays(events: readonly EventRow[]): HolidayContext {
  const holidayLabels = new Map<string, string>();
  for (const date of builtinHolidays()) holidayLabels.set(date, builtinHolidayName(date) ?? '放假');
  const workdays = new Set(builtinWorkdays().filter((date) => builtinWorkdayName(date) !== null));
  for (const row of events) {
    const date = row.on_date;
    if (typeof date !== 'string') continue;
    if (row.type === 'holiday') holidayLabels.set(date, row.title);
    if (row.type === 'workday') {
      holidayLabels.delete(date);
      workdays.add(date);
    }
  }
  return { holidayLabels, holidayDates: new Set(holidayLabels.keys()), workdays: [...workdays].sort() };
}

/** 一条调课的落点 */
interface MoveIn {
  scheduleId: string;
  newDate: string;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  room: string | null;
}

/** 网格输入：都是已读出的行，函数本身不读 storage。 */
export interface GridInput {
  semester: SemesterRow;
  slots: readonly TimeSlotRow[];
  courses: readonly CourseRow[];
  schedules: readonly CourseScheduleRow[];
  events: readonly EventRow[];
  windowDates: readonly string[];
  weekOfDay: readonly number[];
  holidays: HolidayContext;
  timeZone: string;
}

export interface GridResult {
  /** 按「日期:节次」建键的课表格 */
  grid: Map<string, LessonCell[]>;
  /** 实验条目（type = 'lab'）：进课表网格与时间线 */
  labs: EventRow[];
}

/**
 * 铺课表网格：主课次按列日期所属周次判定，调课落点画到目标格，
 * 实验按周次位图铺，窗口外的周次按设置虚线显示。
 */
export function buildGrid(input: GridInput): GridResult {
  const { semester, slots, schedules, events, windowDates, weekOfDay, holidays } = input;
  const slotByPeriod = new Map(slots.map((slot) => [slot.period_no, slot]));
  const activeCourses = input.courses.filter((row) => row.deleted_at === null && row.semester_id === semester.id);
  const courseById = new Map(activeCourses.map((row) => [row.id, row]));
  const semesterEvents = events.filter((row) => row.deleted_at === null && row.semester_id === semester.id);
  const holidayDates = holidays.holidayDates;
  // 停课与调课都按「排课 + 那天」记录：停课的格子灰显，调课的格子标出原位置与落点
  const cancelledKeys = new Set<string>();
  const movedOutKeys = new Set<string>();
  const movedIn: MoveIn[] = [];
  for (const row of semesterEvents) {
    if (row.type !== 'reschedule' || row.ref_schedule_id === null) continue;
    const date = row.on_date;
    if (typeof date !== 'string') continue;
    if (row.action === 'cancel') {
      cancelledKeys.add(`${row.ref_schedule_id}|${date}`);
      continue;
    }
    if (row.action !== 'move' || row.new_date === null) continue;
    movedOutKeys.add(`${row.ref_schedule_id}|${date}`);
    movedIn.push({
      scheduleId: row.ref_schedule_id,
      newDate: row.new_date,
      dayOfWeek: row.as_day_of_week ?? dayOfWeek(row.new_date),
      periodStart: row.new_period_start ?? 1,
      periodEnd: row.new_period_end ?? row.new_period_start ?? 1,
      room: row.new_room,
    });
  }
  const grid = new Map<string, LessonCell[]>();
  const cellOf = (cell: {
    scheduleId: string;
    courseId: string;
    fallbackName: string;
    color: string;
    room: string | null;
    periodStart: number;
    periodEnd: number;
    day: number;
    date: string;
    inWeek: boolean;
    movedIn?: boolean;
    customStart?: string | null;
    customEnd?: string | null;
  }): LessonCell => {
    const course = courseById.get(cell.courseId);
    const date = cell.date;
    return {
      scheduleId: cell.scheduleId,
      courseId: cell.courseId,
      name: course?.short_name ?? cell.fallbackName,
      teacher: course?.teacher ?? null,
      room: cell.room ?? course?.location ?? null,
      color: cell.color,
      dayOfWeek: cell.day,
      date,
      periodStart: cell.periodStart,
      periodEnd: cell.periodEnd,
      startTime: slotByPeriod.get(cell.periodStart)?.start_time ?? '',
      endTime: slotByPeriod.get(cell.periodEnd)?.end_time ?? '',
      inWeek: cell.inWeek,
      holiday: holidayDates.has(date),
      cancelled: cell.inWeek && cancelledKeys.has(`${cell.scheduleId}|${date}`),
      movedOut: cell.inWeek && movedOutKeys.has(`${cell.scheduleId}|${date}`),
      movedIn: cell.movedIn === true,
      lab: false,
      customStart: cell.customStart ?? null,
      customEnd: cell.customEnd ?? null,
    };
  };

  /** 各排课的自定义时间：按 schedule_id 查，用于按真实时间定位 */
  const scheduleCustomById = new Map(
    schedules
      .filter((row) => row.start_time !== null && row.end_time !== null)
      .map((row) => [row.id, { start: row.start_time as string, end: row.end_time as string }]),
  );
  const customOf = (scheduleId: string): { start: string | null; end: string | null } => {
    const custom = scheduleCustomById.get(scheduleId);
    return { start: custom?.start ?? null, end: custom?.end ?? null };
  };

  // 主课次：逐列按该列日期所属的周次判定，窗口跨两周时两周的课都进网格
  const activeIds = new Set(activeCourses.map((row) => row.id));
  const scheduleById = new Map(schedules.map((row) => [row.id, row]));
  for (let index = 0; index < windowDates.length; index += 1) {
    const date = windowDates[index] as string;
    const week = weekOfDay[index] as number;
    const day = dayOfWeek(date);
    for (const schedule of schedules) {
      if (schedule.deleted_at !== null || !activeIds.has(schedule.course_id)) continue;
      if (schedule.day_of_week !== day || !hasWeek(schedule.weeks_mask, week)) continue;
      const course = courseById.get(schedule.course_id);
      if (course === undefined) continue;
      const custom = customOf(schedule.id);
      const key = `${date}:${schedule.period_start}`;
      const list = grid.get(key) ?? [];
      list.push(
        cellOf({
          scheduleId: schedule.id,
          courseId: schedule.course_id,
          fallbackName: course.name,
          color: course.color,
          room: schedule.room,
          periodStart: schedule.period_start,
          periodEnd: schedule.period_end,
          day,
          date,
          inWeek: true,
          customStart: custom.start,
          customEnd: custom.end,
        }),
      );
      grid.set(key, list);
    }
  }

  // 调课的落点：目标日期落在窗口里时，把课次画到落点格上并标「调课」
  for (const move of movedIn) {
    if (!windowDates.includes(move.newDate)) continue;
    const schedule = scheduleById.get(move.scheduleId);
    if (schedule === undefined || schedule.deleted_at !== null || !activeIds.has(schedule.course_id)) continue;
    const course = courseById.get(schedule.course_id);
    if (course === undefined) continue;
    const key = `${move.newDate}:${move.periodStart}`;
    const list = grid.get(key) ?? [];
    if (list.some((cell) => cell.scheduleId === move.scheduleId && cell.movedIn)) continue;
    list.push(
      cellOf({
        scheduleId: move.scheduleId,
        courseId: schedule.course_id,
        fallbackName: course.name,
        color: course.color,
        room: move.room ?? schedule.room,
        periodStart: move.periodStart,
        periodEnd: move.periodEnd,
        day: move.dayOfWeek,
        date: move.newDate,
        inWeek: true,
        movedIn: true,
      }),
    );
    grid.set(key, list);
  }

  // 实验按周次位图铺网格，无位图只落 on_date 那周。
  // 实验默认显示，日程/作业/考试看「显示在课表上」开关。
  const labs = semesterEvents
    .filter((row) => row.show_in_timetable === 1 && row.on_date !== null)
    .sort((left, right) => (left.on_date ?? '').localeCompare(right.on_date ?? ''));
  for (const entry of labs) {
    const entryDate = entry.on_date;
    if (entryDate === null) continue;
    // 节次：实验直接存了节次；日程/作业/考试按开始时间落到重叠的节次上
    const clockStart =
      entry.start_time ?? (entry.start_at === null ? null : formatTime(entry.start_at, input.timeZone));
    const clockEnd =
      entry.end_time ??
      (entry.end_at !== null && entry.end_at !== undefined
        ? formatTime(entry.end_at, input.timeZone)
        : clockStart === null
          ? null
          : plusMinutesText(clockStart, 45));
    const periodStart = entry.period_start ?? periodAtClock(slots, clockStart);
    if (periodStart === null) continue;
    const periodEnd = Math.max(periodStart, entry.period_end ?? periodAtClock(slots, clockEnd) ?? periodStart);
    const weekday = entry.as_day_of_week ?? dayOfWeek(entryDate);
    // 条目所在周次；有位图时按位图在各周的同一天再铺一次
    const entryWeeks = weeksOf(entry.weeks_mask, semester.total_weeks, weekOfDate(entryDate, semester.start_date));
    for (let index = 0; index < windowDates.length; index += 1) {
      const date = windowDates[index] as string;
      if (dayOfWeek(date) !== weekday) continue;
      if (!entryWeeks.includes(weekOfDay[index] as number)) continue;
      const key = `${date}:${periodStart}`;
      const list = grid.get(key) ?? [];
      if (list.some((cell) => cell.eventId === entry.id)) continue;
      list.push({
        scheduleId: entry.id,
        courseId: entry.subject ?? '',
        name: entry.title,
        teacher: null,
        room: entry.location,
        color: entry.type === 'lab' ? (entry.nature === 'course' ? DEFAULT_COURSE_COLOR : LAB_COLOR) : EXAM_COLOR,
        dayOfWeek: weekday,
        date,
        periodStart,
        periodEnd,
        startTime: slotByPeriod.get(periodStart)?.start_time ?? '',
        endTime: slotByPeriod.get(periodEnd)?.end_time ?? '',
        inWeek: true,
        holiday: holidayDates.has(date),
        cancelled: false,
        movedOut: false,
        movedIn: false,
        lab: true,
        eventLabel: EVENT_LABEL[entry.type] ?? '日程',
        courseLabel: entry.subject === null ? null : courseById.get(entry.subject)?.name ?? null,
        eventId: entry.id,
        customStart: clockStart,
        customEnd: clockEnd,
      });
      grid.set(key, list);
    }
  }

  // 窗口外的周次：课程仍在课表里，但那一周不上，按设置虚线显示
  for (const schedule of schedules) {
    if (schedule.deleted_at !== null || !activeIds.has(schedule.course_id)) continue;
    const course = courseById.get(schedule.course_id);
    if (course === undefined) continue;
    for (let index = 0; index < windowDates.length; index += 1) {
      const date = windowDates[index] as string;
      if (dayOfWeek(date) !== schedule.day_of_week) continue;
      if (hasWeek(schedule.weeks_mask, weekOfDay[index] as number)) continue;
      const key = `${date}:${schedule.period_start}`;
      const list = grid.get(key) ?? [];
      if (list.some((cell) => cell.scheduleId === schedule.id)) continue;
      list.push(
        cellOf({
          scheduleId: schedule.id,
          courseId: schedule.course_id,
          fallbackName: course.name,
          color: course.color,
          room: schedule.room,
          periodStart: schedule.period_start,
          periodEnd: schedule.period_end,
          day: schedule.day_of_week,
          date,
          inWeek: false,
        }),
      );
      grid.set(key, list);
    }
  }

  return { grid, labs };
}

/** 时间线数据：按日期归档的课次与「正在上 / 下一节」。纯计算，不读 storage。 */
export interface TimelineData {
  lessonsByDate: Map<string, Occurrence[]>;
  todayLessons: Occurrence[];
  tomorrowLessons: Occurrence[];
  currentLesson: Occurrence | undefined;
  nextLesson: Occurrence | undefined;
}

export function buildTimelineData(input: {
  occurrences: readonly Occurrence[];
  today: string;
  now: number;
}): TimelineData {
  const lessonsByDate = new Map<string, Occurrence[]>();
  for (const item of input.occurrences) {
    if (item.cancelled) continue;
    const list = lessonsByDate.get(item.date) ?? [];
    list.push(item);
    lessonsByDate.set(item.date, list);
  }
  return {
    lessonsByDate,
    todayLessons: lessonsByDate.get(input.today) ?? [],
    tomorrowLessons: lessonsByDate.get(addDays(input.today, 1)) ?? [],
    currentLesson: currentOccurrence(input.occurrences, input.now),
    nextLesson: nextOccurrence(input.occurrences, input.now),
  };
}

/** 没有任何学期时的空数据：各屏照常渲染，只是没有课表。 */
function emptyAppData(input: { timeZone: string; today: string }): AppData {
  const { timeZone, today } = input;
  return {
    timeZone,
    today,
    todayOfWeek: dayOfWeek(today),
    week: 0,
    viewWeek: 0,
    weekStartDate: today,
    windowStart: today,
    windowDates: [today],
    windowSpansWeeks: false,
    semester: null,
    semesters: [],
    slots: [],
    grid: new Map(),
    hasLessons: false,
    courses: [],
    holidayLabels: new Map(),
    workdayDates: [],
    lessonsByDate: new Map(),
    todayLessons: [],
    todoSort: 'start',
    tomorrowLessons: [],
    currentLesson: undefined,
    nextLesson: undefined,
    exams: [],
    todos: [],
    labs: [],
    countdowns: [],
    reschedules: [],
  };
}

/** 课次日期范围：至少覆盖整个学期，学期外保留今天前后各一段。 */
function occurrenceRange(semester: SemesterRow, today: string): { from: string; to: string } {
  const range = dayRangeOf(semester);
  return {
    from: addDays(today, -OCCURRENCE_PAST_DAYS) < range.first ? addDays(today, -OCCURRENCE_PAST_DAYS) : range.first,
    to: addDays(today, OCCURRENCE_FUTURE_DAYS) > range.last ? addDays(today, OCCURRENCE_FUTURE_DAYS) : range.last,
  };
}

/** 课程页与倒计时用的条目分组：考试、待办、倒计时、调课记录。 */
function pickEvents(events: readonly EventRow[]): {
  exams: EventRow[];
  todos: EventRow[];
  countdowns: EventRow[];
  reschedules: EventRow[];
} {
  const exams = events
    .filter((row) => row.type === 'exam' && row.start_at !== null)
    .sort((left, right) => (left.start_at ?? 0) - (right.start_at ?? 0));
  const todos = events
    .filter(
      (row) =>
        row.type === 'temp' ||
        row.type === 'todo' ||
        row.type === 'homework' ||
        (row.type === 'exam' && row.start_at === null),
    )
    .sort((left, right) => scheduleKey(left) - scheduleKey(right));
  /** 倒计时卡片：逐条开关为 1 的条目，按时间排序 */
  const countdowns = events.filter((row) => row.countdown === 1).sort((left, right) => countdownKey(left) - countdownKey(right));
  const reschedules = events.filter(
    (row) => row.type === 'reschedule' || row.type === 'makeup' || row.type === 'holiday',
  );
  return { exams, todos, countdowns, reschedules };
}

export async function loadAppData(
  storage: Storage,
  settings: AppSettings,
  options: { viewWeek?: number; windowStart?: string | null } = {},
): Promise<AppData> {
  const timeZone = resolveTimeZone(settings.timeZone, settings.autoTimeZone);
  const today = formatDate(Date.now(), timeZone);
  const semesters = await listSemesters(storage, USER_ID);
  const semester = (await activeSemester(storage, USER_ID)) ?? null;
  if (semester === null) return emptyAppData({ timeZone, today });

  const slots = await listTimeSlots(storage, semester.id);
  const context = loadSemesterContext({ semester, today, settings, options });
  const [courses, schedules, events] = await Promise.all([
    storage.collection<CourseRow>('courses').getAll(),
    storage.collection<CourseScheduleRow>('course_schedules').getAll(),
    storage.collection<EventRow>('events').getAll(),
  ]);
  const semesterEvents = events.filter((row) => row.deleted_at === null && row.semester_id === semester.id);
  const holidays = loadHolidays(semesterEvents);
  const { grid, labs } = buildGrid({
    semester,
    slots,
    courses,
    schedules,
    events,
    windowDates: context.windowDates,
    weekOfDay: context.weekOfDay,
    holidays,
    timeZone,
  });

  const now = Date.now();
  const range = occurrenceRange(semester, today);
  const expandInput = await loadExpandInput(storage, semester.id, range.from, range.to);
  const occurrences = expandInput === undefined ? [] : expand(expandInput);
  const timeline = buildTimelineData({ occurrences, today, now });
  const picked = pickEvents(semesterEvents);

  return {
    timeZone,
    today,
    todayOfWeek: dayOfWeek(today),
    week: context.currentWeek,
    viewWeek: context.viewWeek,
    weekStartDate: context.weekStartDate,
    windowStart: context.windowStart,
    windowDates: context.windowDates,
    windowSpansWeeks: context.windowSpansWeeks,
    semester,
    semesters: semesters.filter((row) => row.is_active === 0 || row.id === semester.id),
    slots,
    grid,
    hasLessons: [...grid.values()].some((list) => list.length > 0),
    courses: await listManagedCourses(storage, semester.id),
    holidayLabels: holidays.holidayLabels,
    workdayDates: holidays.workdays,
    lessonsByDate: timeline.lessonsByDate,
    todayLessons: timeline.todayLessons,
    todoSort: settings.todoSort,
    tomorrowLessons: timeline.tomorrowLessons,
    currentLesson: timeline.currentLesson,
    nextLesson: timeline.nextLesson,
    exams: picked.exams,
    todos: picked.todos,
    labs,
    countdowns: picked.countdowns,
    reschedules: picked.reschedules,
  };
}

/** 倒计时条目的时间戳：开考时间优先，其次截止时间，再退到日期。 */
function countdownKey(row: EventRow): number {
  if (row.start_at !== null && row.start_at !== undefined) return row.start_at;
  if (row.due_at !== null && row.due_at !== undefined) return row.due_at;
  if (row.on_date !== null && row.on_date !== undefined) return Date.parse(`${row.on_date}T00:00:00Z`);
  return Number.MAX_SAFE_INTEGER;
}

export async function loadCourseDetail(storage: Storage, courseId: string): Promise<CourseDetail> {
  const [course, schedules, reminders] = await Promise.all([
    storage.collection<CourseRow>('courses').get(courseId),
    storage.collection<CourseScheduleRow>('course_schedules').getAll(),
    storage.collection<ReminderRow>('reminders').getAll(),
  ]);
  return {
    course,
    schedules: schedules.filter((row) => row.course_id === courseId && row.deleted_at === null),
    reminder: reminders.find(
      (row) => row.deleted_at === null && row.target_type === 'course' && row.target_id === courseId,
    ),
  };
}

export function slotTimeOf(slots: readonly TimeSlotRow[], period: number): string {
  return slots.find((slot) => slot.period_no === period)?.start_time ?? '';
}

function scheduleKey(row: EventRow): number {
  if (row.due_at !== null && row.due_at !== undefined) return row.due_at;
  if (row.on_date !== null && row.on_date !== undefined) return Date.parse(`${row.on_date}T00:00:00Z`);
  return Number.MAX_SAFE_INTEGER;
}

export function todoDateLabel(row: EventRow): string {
  if (row.due_at !== null && row.due_at !== undefined) return dayStampUtc(row.due_at);
  return row.on_date ?? '未排期';
}
