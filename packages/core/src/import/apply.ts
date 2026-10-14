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
    const duplicate = existingSchedules.some(
      (row) =>
        row.course_id === course.id &&
        row.day_of_week === item.dayOfWeek &&
        row.period_start === item.periodStart &&
        row.period_end === item.periodEnd &&
        row.weeks_mask === mask,
    );
    if (duplicate) {
      skippedSchedules += 1;
      continue;
    }

    const created = await createSchedule(
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
    existingSchedules.push(created as unknown as CourseScheduleRow);
    createdSchedules += 1;
  }

  return { createdCourses, createdSchedules, skippedSchedules, warnings };
}
