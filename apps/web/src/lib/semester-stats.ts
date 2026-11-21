import {
  dayOfWeek,
  diffDays,
  formatDate,
  weekOfDate,
  type EventRow,
  type ManagedCourse,
  type SemesterRow,
} from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { dayRangeOf } from './day-nav.ts';
import { exportReportCopy } from '../copy/export-report.ts';

/** 学期所处阶段：开学前 / 学期中 / 最后一周之后。 */
export type SemesterPhase = 'before' | 'during' | 'after';

/** 学期基本信息：第几周、共几周、起止日期。 */
export interface SemesterInfoStats {
  /** 今天所在周次，夹在 1–总周数之间 */
  currentWeek: number;
  totalWeeks: number;
  /** 学期开始日期（用户设置的开学日） */
  startDate: string;
  /** 最后一周的周日 */
  endDate: string;
  phase: SemesterPhase;
}

/** 课时统计：按当前日期切成「已上 / 待上」。停课的课次一律算已上，不论日期。 */
export interface LessonStats {
  past: number;
  upcoming: number;
  /** 已上 + 待上：判断空态用 */
  total: number;
}

/** 一门课的课时进度：已上（含停课）/ 本学期总课时。 */
export interface CourseProgress {
  courseId: string;
  name: string;
  color: string;
  done: number;
  total: number;
}

/** 一周的课时：已上 / 待上。 */
export interface WeekLessons {
  week: number;
  past: number;
  upcoming: number;
}

/** 考试时间线的一项。 */
export interface ExamTimelineItem {
  id: string;
  title: string;
  /** 没有日期的考试为 null，排在最后 */
  date: string | null;
  taken: boolean;
}

/** 考试分布：本学期考试条目数、已考 / 待考、最近一场与按日期排的时间线。 */
export interface ExamStats {
  total: number;
  taken: number;
  upcoming: number;
  next: { title: string; date: string; daysUntil: number } | null;
  timeline: ExamTimelineItem[];
}

/** 学期统计要的全部数字。纯计算，不读 storage、不写库。 */
export interface SemesterStats {
  semester: SemesterInfoStats | null;
  lessons: LessonStats;
  /** 各课程课时进度，按总课时降序 */
  courses: CourseProgress[];
  /** 第 1 周到最后一周，每周一项 */
  weeks: WeekLessons[];
  exams: ExamStats;
  /** 无课时也无考试：卡片显示空态 */
  empty: boolean;
}

/** 学期起止：与日模式共用「第一周周一 … 最后一周周日」的口径。 */
export function semesterInfoOf(semester: SemesterRow, today: string): SemesterInfoStats {
  const range = dayRangeOf(semester);
  const week = Math.min(Math.max(1, weekOfDate(today, semester.start_date)), semester.total_weeks);
  const phase: SemesterPhase = today < range.first ? 'before' : today > range.last ? 'after' : 'during';
  return {
    currentWeek: week,
    totalWeeks: semester.total_weeks,
    startDate: semester.start_date,
    endDate: range.last,
    phase,
  };
}

/** 统计用的一节课：日期、课程，以及是否算已上。 */
interface CountedLesson {
  date: string;
  courseId: string;
  courseName: string;
  color: string;
  done: boolean;
}

/**
 * 构建学期统计。
 *
 * 口径：
 * - 课时来自 `data.lessonsByDate`（core 的 expand 结果，已扣除节假日与停课、已处理调课落点），
 *   日期早于今天算已上，今天及以后算待上；
 * - 停课来自 `data.reschedules` 的取消记录，只认「当天本来有课」的那几条，一律算已上（不论日期）；
 * - 考试用 `data.exams` 与 `data.todos` 里的考试条目，按考试日期与开考时间判定已考 / 待考。
 */
export function buildSemesterStats(data: Readonly<AppData>, now: number): SemesterStats {
  const semester = data.semester === null ? null : semesterInfoOf(data.semester, data.today);
  const counted = countedLessons(data);
  let past = 0;
  for (const item of counted) if (item.done) past += 1;
  const lessons = { past, upcoming: counted.length - past, total: counted.length };
  const exams = tallyExams(data, now);
  return {
    semester,
    lessons,
    courses: courseProgress(counted),
    weeks: data.semester === null ? [] : weeklyLessons(counted, data.semester),
    exams,
    empty: semester === null || (lessons.total === 0 && exams.total === 0),
  };
}

/** 本学期全部课次（含停课），每节标出是否算已上。 */
function countedLessons(data: Readonly<AppData>): CountedLesson[] {
  const out: CountedLesson[] = [];
  for (const list of data.lessonsByDate.values()) {
    for (const item of list) {
      if (item.cancelled) continue;
      out.push({
        date: item.date,
        courseId: item.courseId,
        courseName: item.courseName,
        color: item.color,
        done: item.date < data.today,
      });
    }
  }
  const scheduleOf = scheduleIndex(data.courses);
  const seen = new Set<string>();
  for (const row of data.reschedules) {
    if (row.type !== 'reschedule' || row.action !== 'cancel') continue;
    const date = row.on_date;
    const schedule = scheduleOf.get(row.ref_schedule_id ?? '');
    if (typeof date !== 'string' || schedule === undefined) continue;
    if (!wouldHaveLesson(data, schedule, date)) continue;
    const key = `${row.ref_schedule_id}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, courseId: schedule.course.id, courseName: schedule.course.name, color: schedule.course.color, done: true });
  }
  return out;
}

interface IndexedSchedule {
  dayOfWeek: number;
  weeks: readonly number[];
  course: ManagedCourse;
}

/** scheduleId → 排课（含星期、周次与所属课程），用于校验停课记录确实是当天的课。 */
function scheduleIndex(courses: readonly ManagedCourse[]): Map<string, IndexedSchedule> {
  const index = new Map<string, IndexedSchedule>();
  for (const course of courses) {
    for (const schedule of course.schedules) {
      index.set(schedule.id, { dayOfWeek: schedule.dayOfWeek, weeks: schedule.weeks, course });
    }
  }
  return index;
}

/** 该日期是否本来就排了这节课：星期对得上、周次里有这一周、当天不放假。 */
function wouldHaveLesson(data: Readonly<AppData>, schedule: IndexedSchedule, date: string): boolean {
  if (data.semester === null) return false;
  if (dayOfWeek(date) !== schedule.dayOfWeek) return false;
  const week = weekOfDate(date, data.semester.start_date);
  if (week < 1 || week > data.semester.total_weeks) return false;
  if (!schedule.weeks.includes(week)) return false;
  return !data.holidayLabels.has(date);
}

/** 各课程课时进度：按总课时降序，同数按名称。 */
function courseProgress(counted: readonly CountedLesson[]): CourseProgress[] {
  const byCourse = new Map<string, CourseProgress>();
  for (const item of counted) {
    const row = byCourse.get(item.courseId) ?? {
      courseId: item.courseId,
      name: item.courseName,
      color: item.color,
      done: 0,
      total: 0,
    };
    row.total += 1;
    if (item.done) row.done += 1;
    byCourse.set(item.courseId, row);
  }
  return [...byCourse.values()].sort(
    (left, right) => right.total - left.total || left.name.localeCompare(right.name, 'zh'),
  );
}

/** 每周课时：落在学期周次外的课次（调课到学期外）不计入周分布。 */
function weeklyLessons(counted: readonly CountedLesson[], semester: SemesterRow): WeekLessons[] {
  const weeks = Array.from({ length: semester.total_weeks }, (_, index) => ({ week: index + 1, past: 0, upcoming: 0 }));
  for (const item of counted) {
    const bucket = weeks[weekOfDate(item.date, semester.start_date) - 1];
    if (bucket === undefined) continue;
    if (item.done) bucket.past += 1;
    else bucket.upcoming += 1;
  }
  return weeks;
}

/** 本学期全部考试条目：带开考时间的在 exams 里，没有开考时间的在 todos 里（按 id 去重）。 */
function examRowsOf(data: Readonly<AppData>): EventRow[] {
  const rows: EventRow[] = [];
  const seen = new Set<string>();
  for (const row of [...data.exams, ...data.todos]) {
    if (row.type !== 'exam' || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

/** 考试所属日期：优先 `on_date`，否则用开考 / 截止时间在显示时区里的日期。 */
function examDateOf(row: EventRow, timeZone: string): string | null {
  if (row.on_date !== null) return row.on_date;
  const at = row.start_at ?? row.due_at;
  return at === null || at === undefined ? null : formatDate(at, timeZone);
}

/** 已考 / 待考与最近一场倒计时：日期早于今天或今天已开考都算已考。 */
function tallyExams(data: Readonly<AppData>, now: number): ExamStats {
  const rows = examRowsOf(data);
  let taken = 0;
  let next: ExamStats['next'] = null;
  const timeline: ExamTimelineItem[] = [];
  for (const row of rows) {
    const date = examDateOf(row, data.timeZone);
    const started = row.start_at !== null && row.start_at !== undefined && row.start_at <= now;
    const done = started || (date !== null && date < data.today);
    timeline.push({ id: row.id, title: row.title, date, taken: done });
    if (done) {
      taken += 1;
      continue;
    }
    if (date === null) continue;
    const candidate = { title: row.title, date, daysUntil: Math.max(0, diffDays(date, data.today)) };
    if (next === null || candidate.date < next.date) next = candidate;
  }
  timeline.sort((left, right) => {
    if (left.date === right.date) return left.title.localeCompare(right.title, 'zh');
    if (left.date === null) return 1;
    if (right.date === null) return -1;
    return left.date < right.date ? -1 : 1;
  });
  return { total: rows.length, taken, upcoming: rows.length - taken, next, timeline };
}

/** 供卡片显示周次：今天在学期外时给出阶段文案，学期中给「第 N 周 / 共 M 周」。 */
export function semesterWeekText(info: SemesterInfoStats | null): string {
  if (info === null) return '';
  if (info.phase === 'before') return exportReportCopy.weekText.before(info.totalWeeks);
  if (info.phase === 'after') return exportReportCopy.weekText.after(info.totalWeeks);
  return exportReportCopy.weekText.during(info.currentWeek, info.totalWeeks);
}
