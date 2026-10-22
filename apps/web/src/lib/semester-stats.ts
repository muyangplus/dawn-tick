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

/** 课时统计：按当前日期切成「已上过 / 待上」，停课单列。 */
export interface LessonStats {
  past: number;
  upcoming: number;
  /** 已过课程里被停课的节数：只进出勤估算的分母，不算上课 */
  cancelled: number;
  /** 过去 + 待上 + 停课：判断空态用 */
  total: number;
}

/** 各课程课时排行的一行。 */
export interface CourseLessonRank {
  courseId: string;
  name: string;
  count: number;
}

/** 出勤估算：已过课程中未停课的比例，不做打卡。 */
export interface AttendanceStats {
  /** 0–100 的整数百分比；没有已过课程时为 null */
  percent: number | null;
  /** 已过且未停课的节数 */
  attended: number;
  /** 已过且停课的节数 */
  cancelled: number;
  /** 估算分母：attended + cancelled */
  total: number;
}

/** 考试分布：本学期考试条目数、已考 / 待考与最近一场。 */
export interface ExamStats {
  total: number;
  taken: number;
  upcoming: number;
  next: { title: string; date: string; daysUntil: number } | null;
}

/** 学期概览卡片要的全部数字。纯计算，不读 storage、不写库。 */
export interface SemesterStats {
  semester: SemesterInfoStats | null;
  lessons: LessonStats;
  ranking: CourseLessonRank[];
  attendance: AttendanceStats;
  exams: ExamStats;
  /** 无课时也无考试：卡片显示空态 */
  empty: boolean;
}

const TOP_RANK = 5;

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

/**
 * 构建学期统计。
 *
 * 口径：
 * - 课时来自 `data.lessonsByDate`（core 的 expand 结果，已扣除节假日与停课、已处理调课落点），
 *   按 `data.today` 切成「已上过（今天之前）/ 待上（今天及以后）」；
 * - 停课节数来自 `data.reschedules` 的取消记录，且只统计「当天本来有课」的那几条；
 * - 出勤估算 = 已过未停课节数 /（已过未停课节数 + 已过停课节数），不是打卡数据；
 * - 考试用 `data.exams` 与 `data.todos` 里的考试条目，按考试日期与开考时间判定已考 / 待考。
 */
export function buildSemesterStats(data: Readonly<AppData>, now: number): SemesterStats {
  const semester = data.semester === null ? null : semesterInfoOf(data.semester, data.today);
  const lessons = tallyLessons(data);
  const attendance = tallyAttendance(data, lessons.past);
  const exams = tallyExams(data, now);
  const cancelled = attendance.cancelled;
  return {
    semester,
    lessons: { ...lessons, cancelled, total: lessons.past + lessons.upcoming + cancelled },
    ranking: rankCourses(data),
    attendance,
    exams,
    empty: semester === null || (lessons.past + lessons.upcoming + cancelled === 0 && exams.total === 0),
  };
}

/** 按日期切分课时：今天及以后都算「待上」；停课在这里不算上课。 */
function tallyLessons(data: Readonly<AppData>): { past: number; upcoming: number } {
  let past = 0;
  let upcoming = 0;
  for (const list of data.lessonsByDate.values()) {
    for (const item of list) {
      if (item.cancelled) continue;
      if (item.date < data.today) past += 1;
      else upcoming += 1;
    }
  }
  return { past, upcoming };
}

/**
 * 出勤估算：已过课程里被停课的节数来自取消记录，
 * 且必须对得上当天的排课（星期与周次都成立），避免把误录的取消算进分母。
 */
function tallyAttendance(data: Readonly<AppData>, attended: number): AttendanceStats {
  const scheduleOf = scheduleIndex(data.courses);
  let cancelled = 0;
  for (const row of data.reschedules) {
    if (row.type !== 'reschedule' || row.action !== 'cancel') continue;
    const date = row.on_date;
    if (typeof date !== 'string' || date >= data.today) continue;
    if (!wouldHaveLesson(data, scheduleOf.get(row.ref_schedule_id ?? ''), date)) continue;
    cancelled += 1;
  }
  const total = attended + cancelled;
  return { percent: total === 0 ? null : Math.round((attended / total) * 100), attended, cancelled, total };
}

/** scheduleId → 排课（含星期与周次），用于校验停课记录确实是当天的课。 */
function scheduleIndex(courses: readonly ManagedCourse[]): Map<string, { dayOfWeek: number; weeks: readonly number[] }> {
  const index = new Map<string, { dayOfWeek: number; weeks: readonly number[] }>();
  for (const course of courses) {
    for (const schedule of course.schedules) {
      index.set(schedule.id, { dayOfWeek: schedule.dayOfWeek, weeks: schedule.weeks });
    }
  }
  return index;
}

/** 该日期是否本来就排了这节课：星期对得上、周次里有这一周、当天不放假。 */
function wouldHaveLesson(
  data: Readonly<AppData>,
  schedule: { dayOfWeek: number; weeks: readonly number[] } | undefined,
  date: string,
): boolean {
  if (schedule === undefined || data.semester === null) return false;
  if (dayOfWeek(date) !== schedule.dayOfWeek) return false;
  const week = weekOfDate(date, data.semester.start_date);
  if (week < 1 || week > data.semester.total_weeks) return false;
  if (!schedule.weeks.includes(week)) return false;
  return !data.holidayLabels.has(date);
}

/** 课程课时排行：过去 + 待上的实际课次，按节数降序取前 5。 */
function rankCourses(data: Readonly<AppData>): CourseLessonRank[] {
  const byCourse = new Map<string, CourseLessonRank>();
  for (const list of data.lessonsByDate.values()) {
    for (const item of list) {
      if (item.cancelled) continue;
      const row = byCourse.get(item.courseId) ?? { courseId: item.courseId, name: item.courseName, count: 0 };
      row.count += 1;
      byCourse.set(item.courseId, row);
    }
  }
  return [...byCourse.values()]
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh'))
    .slice(0, TOP_RANK);
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
  for (const row of rows) {
    const date = examDateOf(row, data.timeZone);
    const started = row.start_at !== null && row.start_at !== undefined && row.start_at <= now;
    if (started || (date !== null && date < data.today)) {
      taken += 1;
      continue;
    }
    if (date === null) continue;
    const candidate = { title: row.title, date, daysUntil: Math.max(0, diffDays(date, data.today)) };
    if (next === null || candidate.date < next.date) next = candidate;
  }
  return { total: rows.length, taken, upcoming: rows.length - taken, next };
}

/** 供卡片显示周次：今天在学期外时给出阶段文案，学期中给「第 N 周 / 共 M 周」。 */
export function semesterWeekText(info: SemesterInfoStats | null): string {
  if (info === null) return '';
  if (info.phase === 'before') return `未开学 · 共 ${info.totalWeeks} 周`;
  if (info.phase === 'after') return `学期已结束 · 共 ${info.totalWeeks} 周`;
  return `第 ${info.currentWeek} 周 / 共 ${info.totalWeeks} 周`;
}
