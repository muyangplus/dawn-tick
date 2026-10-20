import { describeWeeks, weeksToMask } from '../weeks.ts';
import { createCourse, createSchedule, type WriteOptions } from '../mutations.ts';
import type { Storage } from '../storage.ts';
import type { CourseRow, CourseScheduleRow } from '../types.ts';

export interface ImportedSchedule {
  courseName: string;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  weeks: number[];
  room: string | null;
  teacher: string | null;
}

/** 默认取色，与 `docs/06-配色方案.md` 的青春活力色板一致。 */
export const DEFAULT_COURSE_COLORS: readonly string[] = [
  '#FF6B4A', '#FF9F43', '#FFD93D', '#6BCB77', '#2ED573', '#17C3B2',
  '#4D96FF', '#6C5CE7', '#B15CFF', '#FF6FB5', '#FF8FA3', '#8D6E63',
];

export interface ApplyImportOptions extends WriteOptions {
  colorPalette?: readonly string[];
}

export interface ApplyImportResult {
  createdCourses: number;
  createdSchedules: number;
  skippedSchedules: number;
  warnings: string[];
}

/**
 * 重复判定键：同一课程 + 同一星期 + 同一节次区间 + 同一周次掩码。
 * 写入（`applyImport`）与预检（`previewDuplicates`）共用这一口径，避免两处规则漂移。
 */
function duplicateKey(
  courseId: string,
  dayOfWeek: number,
  periodStart: number,
  periodEnd: number,
  mask: number,
): string {
  return `${courseId}|${dayOfWeek}|${periodStart}|${periodEnd}|${mask}`;
}

/**
 * 现有排课的重复判定集合。
 * 跨学期共用一个集合不会误判：键里带 `course_id`，课程 id 本身属于某个学期。
 */
function existingDuplicateKeys(rows: readonly CourseScheduleRow[]): Set<string> {
  return new Set(
    rows.map((row) =>
      duplicateKey(row.course_id, row.day_of_week, row.period_start, row.period_end, row.weeks_mask),
    ),
  );
}

/**
 * 只读预检：按 `applyImport` 的重复判定逐条回答「写入时会不会因重复被跳过」。
 * 返回数组与 `incoming` 下标一一对应；无名称或无周次的条目不算重复（它们走警告跳过）。
 *
 * 不写存储、不改写入策略；同一批里同名课程用名字占位（`pending:名字`），
 * 与 `applyImport` 先建课程再判重的顺序一致。
 */
export async function previewDuplicates(
  storage: Storage,
  semesterId: string,
  incoming: readonly ImportedSchedule[],
): Promise<boolean[]> {
  const courses = await storage.collection<CourseRow>('courses').getAll();
  const courseIdByName = new Map(
    courses
      .filter((row) => row.semester_id === semesterId && row.deleted_at === null)
      .map((row) => [row.name.trim(), row.id]),
  );
  const schedules = await storage.collection<CourseScheduleRow>('course_schedules').getAll();
  const seen = existingDuplicateKeys(schedules.filter((row) => row.deleted_at === null));

  return incoming.map((item) => {
    const name = item.courseName.trim();
    if (name.length === 0 || item.weeks.length === 0) return false;
    const courseId = courseIdByName.get(name) ?? `pending:${name}`;
    const key = duplicateKey(
      courseId,
      item.dayOfWeek,
      item.periodStart,
      item.periodEnd,
      weeksToMask(item.weeks),
    );
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

/** 把解析出的排课写入存储。同一课程同一星期同一节次同一周次的排课被跳过（重复导入幂等）。 */
export async function applyImport(
  storage: Storage,
  semesterId: string,
  incoming: readonly ImportedSchedule[],
  options: ApplyImportOptions = {},
): Promise<ApplyImportResult> {
  const palette = options.colorPalette ?? DEFAULT_COURSE_COLORS;
  const warnings: string[] = [];
  const courses = await storage.collection<CourseRow>('courses').getAll();
  const existingCourses = courses.filter((row) => row.semester_id === semesterId && row.deleted_at === null);
  const schedules = await storage.collection<CourseScheduleRow>('course_schedules').getAll();
  const existingSchedules = schedules.filter((row) => row.deleted_at === null);

  const byName = new Map(existingCourses.map((row) => [row.name.trim(), row]));
  const seen = existingDuplicateKeys(existingSchedules);
  let createdCourses = 0;
  let createdSchedules = 0;
  let skippedSchedules = 0;

  for (const item of incoming) {
    const name = item.courseName.trim();
    if (name.length === 0 || item.weeks.length === 0) {
      warnings.push(`跳过无名称或无周次的条目: ${item.courseName}`);
      continue;
    }

    let course = byName.get(name);
    if (course === undefined) {
      const created = await createCourse(
        storage,
        {
          semesterId,
          name,
          teacher: item.teacher,
          location: item.room,
          color: palette[byName.size % palette.length] ?? '#4F8DFD',
        },
        options,
      );
      course = created as unknown as CourseRow;
      byName.set(name, course);
      createdCourses += 1;
    }

    const mask = weeksToMask(item.weeks);
    const key = duplicateKey(course.id, item.dayOfWeek, item.periodStart, item.periodEnd, mask);
    if (seen.has(key)) {
      skippedSchedules += 1;
      continue;
    }
    // 本次写入的排课也要进集合：同一批里重复的条目随后同样被跳过
    seen.add(key);

    await createSchedule(
      storage,
      {
        courseId: course.id,
        dayOfWeek: item.dayOfWeek,
        periodStart: item.periodStart,
        periodEnd: item.periodEnd,
        weeks: item.weeks,
        weeksRaw: describeWeeks(mask, 30),
        room: item.room,
      },
      options,
    );
    createdSchedules += 1;
  }

  return { createdCourses, createdSchedules, skippedSchedules, warnings };
}
