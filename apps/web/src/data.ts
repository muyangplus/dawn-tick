import {
  activeSemester,
  addDays,
  dayOfWeek,
  expand,
  formatDate,
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
  type Occurrence,
  type ReminderRow,
  type SemesterRow,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';

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
  semester: SemesterRow | null;
  semesters: SemesterRow[];
  slots: TimeSlotRow[];
  grid: Map<string, LessonCell[]>;
  todayLessons: Occurrence[];
  nextLesson: Occurrence | undefined;
  exams: EventRow[];
  todos: EventRow[];
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
      todayLessons: [],
      nextLesson: undefined,
      exams: [],
      todos: [],
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
    inWeek: boolean;
  }): LessonCell => {
    const course = courseById.get(input.courseId);
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
    };
  };

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
          inWeek: true,
        }),
      );
      grid.set(key, list);
    }
  }

  // 非本周课程：仍在课表中，但这一周不上，按设置虚线显示
  const activeIds = new Set(activeCourses.map((row) => row.id));
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
        inWeek: false,
      }),
    );
    grid.set(key, list);
  }

  const input = await loadExpandInput(storage, semester.id, today, addDays(today, LOOKAHEAD_DAYS));
  const occurrences = input === undefined ? [] : expand(input);
  const todayLessons = occurrences.filter((item) => item.date === today && !item.cancelled);

  const semesterEvents = events.filter((row) => row.deleted_at === null && row.semester_id === semester.id);
  const exams = semesterEvents
    .filter((row) => row.type === 'exam' && row.start_at !== null)
    .sort((left, right) => (left.start_at ?? 0) - (right.start_at ?? 0));
  const todos = semesterEvents
    .filter((row) => row.type === 'temp' || (row.type === 'exam' && row.start_at === null))
    .sort((left, right) => scheduleKey(left) - scheduleKey(right));
  const reschedules = semesterEvents.filter((row) => row.type === 'reschedule');

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
    todayLessons,
    nextLesson: nextOccurrence(occurrences, Date.now()),
    exams,
    todos,
    reschedules,
  };
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
