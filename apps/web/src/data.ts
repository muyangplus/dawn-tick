import {
  activeSemester,
  addDays,
  builtinHolidayName,
  builtinHolidays,
  builtinWorkdayName,
  builtinWorkdays,
  dayOfWeek,
  expand,
  currentOccurrence,
  formatDate,
  formatTime,
  listManagedCourses,
  listSemesters,
  listTimeSlots,
  loadExpandInput,
  maskToWeeks,
  nextOccurrence,
  resolveTimeZone,
  weekOfDate,
  weekStart,
  weekView,
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

/** 课表里条目的角标文案。 */
const EVENT_LABEL: Record<string, string> = {
  lab: '实验',
  homework: '作业',
  exam: '考试',
  todo: '日程',
  temp: '日程',
};

/** 墙钟时间落到重叠的节次上；没有重叠时贴最近的一节。 */
function periodAtClock(
  clock: string | null,
  slots: ReadonlyArray<{ period_no: number; start_time: string; end_time: string }>,
): number | null {
  if (clock === null || clock === '' || slots.length === 0) return null;
  const toMinutes = (value: string): number => {
    const [hour, minute] = value.split(':').map(Number);
    return (hour ?? 0) * 60 + (minute ?? 0);
  };
  const target = toMinutes(clock);
  const inside = slots.find((slot) => toMinutes(slot.start_time) <= target && toMinutes(slot.end_time) > target);
  if (inside !== undefined) return inside.period_no;
  const nearest = slots.reduce((best, slot) =>
    Math.abs(toMinutes(slot.start_time) - target) < Math.abs(toMinutes(best.start_time) - target) ? slot : best,
  );
  return nearest.period_no;
}

/** HH:MM 加分钟，用于缺结束时间时按一节时长估计。 */
function plusMinutesText(clock: string, minutes: number): string {
  const [hour, minute] = clock.split(':').map(Number);
  const total = ((hour ?? 0) * 60 + (minute ?? 0) + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export interface LessonCell {
  scheduleId: string;
  courseId: string;
  name: string;
  teacher: string | null;
  room: string | null;
  color: string;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  startTime: string;
  endTime: string;
  /** 该排课是否落在当前查看的周次；false 表示非本周课程，按设置虚线显示 */
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
  /** 当前查看周内是否有课，含只在别周上的课程（inWeek = false） */
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
const USER_ID = 'u1';

export function weekDateOf(semester: SemesterRow, week: number, dayOfWeek: number): string {
  return addDays(weekStart(semester.start_date), (week - 1) * 7 + (dayOfWeek - 1));
}

export async function loadAppData(
  storage: Storage,
  settings: AppSettings,
  options: { viewWeek?: number } = {},
): Promise<AppData> {
  const timeZone = resolveTimeZone(settings.timeZone, settings.autoTimeZone);
  const today = formatDate(Date.now(), timeZone);
  const semesters = await listSemesters(storage, USER_ID);
  const semester = (await activeSemester(storage, USER_ID)) ?? null;

  if (semester === null) {
    return {
      timeZone,
      today,
      todayOfWeek: dayOfWeek(today),
      week: 0,
      viewWeek: 0,
      weekStartDate: today,
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

  const slots = await listTimeSlots(storage, semester.id);
  const slotByPeriod = new Map(slots.map((slot) => [slot.period_no, slot]));
  const currentWeek = Math.max(1, weekOfDate(today, semester.start_date));
  const viewWeek = Math.min(Math.max(1, options.viewWeek ?? currentWeek), semester.total_weeks);

  const [courses, schedules, events] = await Promise.all([
    storage.collection<CourseRow>('courses').getAll(),
    storage.collection<CourseScheduleRow>('course_schedules').getAll(),
    storage.collection<EventRow>('events').getAll(),
  ]);
  const activeCourses = courses.filter((row) => row.deleted_at === null && row.semester_id === semester.id);
  const courseById = new Map(activeCourses.map((row) => [row.id, row]));
  const semesterEvents = events.filter((row) => row.deleted_at === null && row.semester_id === semester.id);
  // 放假：内置节假日表 + 手工「设为假日」，再扣掉手工「设为非假日」
  const holidayLabels = new Map<string, string>();
  for (const date of builtinHolidays()) holidayLabels.set(date, builtinHolidayName(date) ?? '放假');
  const workdays = new Set(builtinWorkdays().filter((date) => builtinWorkdayName(date) !== null));
  for (const row of semesterEvents) {
    const date = row.on_date;
    if (typeof date !== 'string') continue;
    if (row.type === 'holiday') holidayLabels.set(date, row.title);
    if (row.type === 'workday') {
      holidayLabels.delete(date);
      workdays.add(date);
    }
  }
  const holidayDates = new Set(holidayLabels.keys());
  // 停课与调课都按「排课 + 那天」记录：停课的格子灰显，调课的格子标出原位置与落点
  const cancelledKeys = new Set<string>();
  const movedOutKeys = new Set<string>();
  interface MoveIn {
    scheduleId: string;
    newDate: string;
    dayOfWeek: number;
    periodStart: number;
    periodEnd: number;
    room: string | null;
  }
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
  const viewWeekStart = weekDateOf(semester, viewWeek, 1);
  const viewWeekEnd = addDays(viewWeekStart, 6);
  const dateOfDay = (day: number): string => addDays(viewWeekStart, day - 1);

  const grid = new Map<string, LessonCell[]>();
  const cellOf = (input: {
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
    const course = courseById.get(input.courseId);
    const date = input.date;
    return {
      scheduleId: input.scheduleId,
      courseId: input.courseId,
      name: course?.short_name ?? input.fallbackName,
      teacher: course?.teacher ?? null,
      room: input.room ?? course?.location ?? null,
      color: input.color,
      dayOfWeek: input.day,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      startTime: slotByPeriod.get(input.periodStart)?.start_time ?? '',
      endTime: slotByPeriod.get(input.periodEnd)?.end_time ?? '',
      inWeek: input.inWeek,
      holiday: holidayDates.has(date),
      cancelled: input.inWeek && cancelledKeys.has(`${input.scheduleId}|${date}`),
      movedOut: input.inWeek && movedOutKeys.has(`${input.scheduleId}|${date}`),
      movedIn: input.movedIn === true,
      lab: false,
      customStart: input.customStart ?? null,
      customEnd: input.customEnd ?? null,
    };
  };

  /** 各排课的自定义时间：按 schedule_id 查，用于按真实时间定位 */
  const scheduleCustomById = new Map(
    schedules
      .filter((row) => row.start_time !== null && row.end_time !== null)
      .map((row) => [row.id, { start: row.start_time as string, end: row.end_time as string }]),
  );

  for (let day = 1; day <= 7; day += 1) {
    for (const row of await weekView(storage, semester.id, day, viewWeek)) {
      const key = `${day}:${row.period_start}`;
      const list = grid.get(key) ?? [];
      list.push(
        cellOf({
          scheduleId: row.schedule_id,
          courseId: row.course_id,
          fallbackName: row.name,
          color: row.color,
          room: row.room,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          day,
          date: dateOfDay(day),
          inWeek: true,
          customStart: scheduleCustomById.get(row.schedule_id)?.start ?? null,
          customEnd: scheduleCustomById.get(row.schedule_id)?.end ?? null,
        }),
      );
      grid.set(key, list);
    }
  }

  // 调课的落点：目标日期落在这一周时，把课次画到落点格上并标「调课」
  const activeIds = new Set(activeCourses.map((row) => row.id));
  const scheduleById = new Map(schedules.map((row) => [row.id, row]));
  for (const move of movedIn) {
    if (move.newDate < viewWeekStart || move.newDate > viewWeekEnd) continue;
    const schedule = scheduleById.get(move.scheduleId);
    if (schedule === undefined || schedule.deleted_at !== null || !activeIds.has(schedule.course_id)) continue;
    const course = courseById.get(schedule.course_id);
    if (course === undefined) continue;
    const key = `${move.dayOfWeek}:${move.periodStart}`;
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

  // 实验条目：按周次位图（没有位图时只落 on_date 那一周）铺进课表网格
  // 课表条目：实验默认显示，日程/作业/考试按「显示在课表上」开关决定
  const labs = semesterEvents
    .filter((row) => row.show_in_timetable === 1 && row.on_date !== null)
    .sort((left, right) => (left.on_date ?? '').localeCompare(right.on_date ?? ''));
  for (const entry of labs) {
    const date = entry.on_date;
    if (date === null) continue;
    // 节次：实验直接存了节次；日程/作业/考试按开始时间落到重叠的节次上
    const clockStart = entry.start_time ?? (entry.start_at === null ? null : formatTime(entry.start_at, timeZone));
    const clockEnd =
      entry.end_time ??
      (entry.end_at !== null && entry.end_at !== undefined
        ? formatTime(entry.end_at, timeZone)
        : clockStart === null
          ? null
          : plusMinutesText(clockStart, 45));
    const periodStart = entry.period_start ?? periodAtClock(clockStart, slots);
    if (periodStart === null) continue;
    const periodEnd = Math.max(periodStart, entry.period_end ?? periodAtClock(clockEnd, slots) ?? periodStart);
    const weekday = entry.as_day_of_week ?? dayOfWeek(date);
    const weeks =
      entry.weeks_mask === null || entry.weeks_mask === undefined
        ? [weekOfDate(date, semester.start_date)]
        : maskToWeeks(entry.weeks_mask, semester.total_weeks);
    if (!weeks.includes(viewWeek)) continue;
    const key = `${weekday}:${periodStart}`;
    const list = grid.get(key) ?? [];
    if (list.some((cell) => cell.eventId === entry.id)) continue;
    list.push({
      scheduleId: entry.id,
      courseId: entry.subject ?? '',
      name: entry.title,
      teacher: null,
      room: entry.location,
      color: entry.type === 'lab' ? (entry.nature === 'course' ? '#4F8DFD' : '#8E7CC3') : '#E08A3C',
      dayOfWeek: weekday,
      periodStart,
      periodEnd,
      startTime: slotByPeriod.get(periodStart)?.start_time ?? '',
      endTime: slotByPeriod.get(periodEnd)?.end_time ?? '',
      inWeek: true,
      holiday: holidayDates.has(dateOfDay(weekday)),
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

  // 非本周课程：仍在课表中，但这一周不上，按设置虚线显示
  for (const row of schedules) {
    if (row.deleted_at !== null || !activeIds.has(row.course_id)) continue;
    if (maskToWeeks(row.weeks_mask, semester.total_weeks).includes(viewWeek)) continue;
    const course = courseById.get(row.course_id);
    if (course === undefined) continue;
    const day = row.day_of_week;
    const key = `${day}:${row.period_start}`;
    const list = grid.get(key) ?? [];
    if (list.some((cell) => cell.scheduleId === row.id)) continue;
    list.push(
      cellOf({
        scheduleId: row.id,
        courseId: row.course_id,
        fallbackName: course.name,
        color: course.color,
        room: row.room,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        day,
        date: dateOfDay(day),
        inWeek: false,
      }),
    );
    grid.set(key, list);
  }

  const input = await loadExpandInput(storage, semester.id, addDays(today, -45), addDays(today, 60));
  const occurrences = input === undefined ? [] : expand(input);
  const lessonsByDate = new Map<string, Occurrence[]>();
  for (const item of occurrences) {
    if (item.cancelled) continue;
    const list = lessonsByDate.get(item.date) ?? [];
    list.push(item);
    lessonsByDate.set(item.date, list);
  }
  const todayLessons = lessonsByDate.get(today) ?? [];
  const tomorrowLessons = lessonsByDate.get(addDays(today, 1)) ?? [];
  const now = Date.now();
  const currentLesson = currentOccurrence(occurrences, now);
  const exams = semesterEvents
    .filter((row) => row.type === 'exam' && row.start_at !== null)
    .sort((left, right) => (left.start_at ?? 0) - (right.start_at ?? 0));
  const todos = semesterEvents
    .filter(
      (row) =>
        row.type === 'temp' ||
        row.type === 'todo' ||
        row.type === 'homework' ||
        (row.type === 'exam' && row.start_at === null),
    )
    .sort((left, right) => scheduleKey(left) - scheduleKey(right));
  /** 倒计时卡片：逐条开关为 1 的条目，按时间排序 */
  const countdowns = semesterEvents
    .filter((row) => row.countdown === 1)
    .sort((left, right) => countdownKey(left) - countdownKey(right));
  const reschedules = semesterEvents.filter(
    (row) => row.type === 'reschedule' || row.type === 'makeup' || row.type === 'holiday',
  );

  return {
    timeZone,
    today,
    todayOfWeek: dayOfWeek(today),
    week: currentWeek,
    viewWeek,
    weekStartDate: weekDateOf(semester, viewWeek, 1),
    semester,
    semesters: semesters.filter((row) => row.is_active === 0 || row.id === semester.id),
    slots,
    grid,
    hasLessons: [...grid.values()].some((list) => list.some((cell) => cell.inWeek)),
    courses: await listManagedCourses(storage, semester.id),
    holidayLabels,
    workdayDates: [...workdays].sort(),
    lessonsByDate,
    todayLessons,
    todoSort: settings.todoSort,
    tomorrowLessons,
    currentLesson,
    nextLesson: nextOccurrence(occurrences, now),
    exams,
    todos,
    labs,
    countdowns,
    reschedules,
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
  if (row.due_at !== null && row.due_at !== undefined) return formatDate(row.due_at, 'UTC').slice(0, 10);
  return row.on_date ?? '未排期';
}
