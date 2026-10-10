import {
  activeSemester,
  addDays,
  dayOfWeek,
  expand,
  formatDate,
  listSemesters,
  listTimeSlots,
  loadExpandInput,
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
}

export interface AppData {
  timeZone: string;
  today: string;
  todayOfWeek: number;
  week: number;
  viewWeek: number;
  weekStartDate: string;
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
  for (let day = 1; day <= 7; day += 1) {
    for (const row of await weekView(storage, semester.id, day, viewWeek)) {
      const course = courseById.get(row.course_id);
      const startSlot = slotByPeriod.get(row.period_start);
      const endSlot = slotByPeriod.get(row.period_end);
      const key = `${day}:${row.period_start}`;
      const list = grid.get(key) ?? [];
      list.push({
        scheduleId: row.schedule_id,
        courseId: row.course_id,
        name: course?.short_name ?? row.name,
        teacher: course?.teacher ?? null,
        room: row.room ?? course?.location ?? null,
        color: row.color,
        dayOfWeek: day,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        startTime: startSlot?.start_time ?? '',
        endTime: endSlot?.end_time ?? '',
      });
      grid.set(key, list);
    }
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
