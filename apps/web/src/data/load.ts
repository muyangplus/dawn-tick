// 从存储装载整页数据（带学期快照复用）。
import {
  addDays,
  dayOfWeek,
  expand,
  formatDate,
  expandInputOf,
  listSemesters,
  loadSemesterSnapshot,
  managedCoursesOf,
  resolveTimeZone,
  writeGeneration,
  type AppSettings,
  type CourseRow,
  type CourseScheduleRow,
  type EventRow,
  type ReminderRow,
  type SemesterRow,
  type SemesterSnapshot,
  type Storage,
} from '@dawn-tick/core';
import { dayRangeOf } from '../lib/day-nav.ts';
import { loadHolidays, loadSemesterContext } from './context.ts';
import { buildGrid } from './grid.ts';
import { buildTimelineData } from './timeline.ts';
import { type AppData, type CourseDetail } from './types.ts';

/** 课次日期范围：至少覆盖整个学期，学期外保留今天前后各一段 */
const OCCURRENCE_PAST_DAYS = 45;
const OCCURRENCE_FUTURE_DAYS = 60;
const USER_ID = 'u1';

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
    showCancelled: false,
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

/** 上次读出的学期快照：只在翻页这类「数据没变」的重载里复用，且库的写入代数必须没变。 */
let snapshotCache: { storage: Storage; semesterId: string; generation: number; snapshot: SemesterSnapshot } | null = null;

async function semesterSnapshot(storage: Storage, semesterId: string, reuse: boolean): Promise<SemesterSnapshot | undefined> {
  const generation = writeGeneration(storage);
  if (
    reuse &&
    generation !== null &&
    snapshotCache !== null &&
    snapshotCache.storage === storage &&
    snapshotCache.semesterId === semesterId &&
    snapshotCache.generation === generation
  ) {
    return snapshotCache.snapshot;
  }
  const snapshot = await loadSemesterSnapshot(storage, semesterId);
  snapshotCache =
    snapshot === undefined || generation === null ? null : { storage, semesterId, generation, snapshot };
  return snapshot;
}

export async function loadAppData(
  storage: Storage,
  settings: AppSettings,
  options: {
    viewWeek?: number;
    windowStart?: string | null;
    /** 只换查看窗口（翻页）：库没写过就复用上次读出的学期数据，不再整表读 */
    reuseSnapshot?: boolean;
  } = {},
): Promise<AppData> {
  const timeZone = resolveTimeZone(settings.timeZone, settings.autoTimeZone);
  const today = formatDate(Date.now(), timeZone);
  const semesters = await listSemesters(storage, USER_ID);
  const active = semesters.find((row) => row.is_active === 1);
  if (active === undefined) return emptyAppData({ timeZone, today });
  const snapshot = await semesterSnapshot(storage, active.id, options.reuseSnapshot === true);
  if (snapshot === undefined) return emptyAppData({ timeZone, today });

  const { semester, slots, courses, schedules, events: semesterEvents } = snapshot;
  const context = loadSemesterContext({ semester, today, settings, options });
  const holidays = loadHolidays(semesterEvents);
  const { grid, labs } = buildGrid({
    semester,
    slots,
    courses,
    schedules,
    events: semesterEvents,
    windowDates: context.windowDates,
    weekOfDay: context.weekOfDay,
    holidays,
    timeZone,
  });

  const now = Date.now();
  const range = occurrenceRange(semester, today);
  const occurrences = expand(expandInputOf(snapshot, range.from, range.to));
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
    courses: managedCoursesOf(courses, schedules),
    holidayLabels: holidays.holidayLabels,
    workdayDates: holidays.workdays,
    lessonsByDate: timeline.lessonsByDate,
    todayLessons: timeline.todayLessons,
    todoSort: settings.todoSort,
    showCancelled: settings.showCancelled,
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

function scheduleKey(row: EventRow): number {
  if (row.due_at !== null && row.due_at !== undefined) return row.due_at;
  if (row.on_date !== null && row.on_date !== undefined) return Date.parse(`${row.on_date}T00:00:00Z`);
  return Number.MAX_SAFE_INTEGER;
}
