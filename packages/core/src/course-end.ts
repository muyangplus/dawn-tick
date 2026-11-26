import type { Storage } from './storage.ts';
import { deleteEvent } from './mutations/events.ts';
import { deleteSchedule, updateSchedule } from './mutations/courses.ts';
import type { WriteOptions } from './mutations/base.ts';
import { addDays, weekStart } from './time.ts';
import { describeWeeks, maskToWeeks, weeksToMask } from './weeks.ts';

/** 存量结课转换完成标记：存在即跳过。 */
export const COURSE_END_CONVERT_KEY = 'course_end_convert_v1';

/** 同一次批量停课写入的记录，created_at 相差不超过这个毫秒数。 */
const BATCH_WINDOW_MS = 60_000;

type Row = Record<string, unknown>;

export interface TruncateScheduleInput {
  scheduleId: string;
  /** 保留的周次；为空时整条排课删除 */
  keepWeeks: readonly number[];
  totalWeeks: number;
  /** 截掉的周次上的停课记录 */
  dropEventIds: readonly string[];
}

/**
 * 结课：把排课截短到 `keepWeeks`，并删掉截掉周次上的停课记录。
 * 一周都不剩时排课无法保存空位图，直接删除这条排课。
 */
export async function truncateScheduleWeeks(
  storage: Storage,
  input: TruncateScheduleInput,
  options: WriteOptions = {},
): Promise<'updated' | 'deleted'> {
  for (const id of input.dropEventIds) await deleteEvent(storage, id, options);
  if (input.keepWeeks.length === 0) {
    await deleteSchedule(storage, input.scheduleId, options);
    return 'deleted';
  }
  const mask = weeksToMask(input.keepWeeks);
  await updateSchedule(
    storage,
    input.scheduleId,
    { weeks_mask: mask, weeks_raw: describeWeeks(mask, input.totalWeeks) },
    options,
  );
  return 'updated';
}

function alive(row: Row): boolean {
  return row['deleted_at'] === null || row['deleted_at'] === undefined;
}

/**
 * 一次性转换旧版结课：旧版结课给结课后的每一次课各写一条停课记录。
 * 识别方式：某条排课从某周起直到最后一个上课周全部停课，至少两周，且这些记录是同一批写入的。
 * 识别到的排课保留到这段停课的第一周（该周仍记停课），之后的周次清掉，对应停课记录删除。
 * 返回转换的排课条数；重复调用幂等。
 */
export async function convertCourseEnds(storage: Storage): Promise<number> {
  if ((await storage.readMeta(COURSE_END_CONVERT_KEY)) === '1') return 0;
  const semesters = new Map(
    (await storage.collection<Row>('semesters').getAll()).filter(alive).map((row) => [row['id'] as string, row]),
  );
  const courses = new Map(
    (await storage.collection<Row>('courses').getAll()).filter(alive).map((row) => [row['id'] as string, row]),
  );
  const schedules = (await storage.collection<Row>('course_schedules').getAll()).filter(alive);
  // 排课 → 日期 → 停课记录
  const cancels = new Map<string, Map<string, Row>>();
  for (const row of await storage.collection<Row>('events').getAll()) {
    if (!alive(row) || row['type'] !== 'reschedule' || row['action'] !== 'cancel') continue;
    const scheduleId = row['ref_schedule_id'];
    const date = row['on_date'];
    if (typeof scheduleId !== 'string' || typeof date !== 'string') continue;
    const byDate = cancels.get(scheduleId) ?? new Map<string, Row>();
    byDate.set(date, row);
    cancels.set(scheduleId, byDate);
  }
  let converted = 0;
  for (const schedule of schedules) {
    const byDate = cancels.get(schedule['id'] as string);
    if (byDate === undefined || byDate.size < 2) continue;
    const course = courses.get(schedule['course_id'] as string);
    const semester = course === undefined ? undefined : semesters.get(course['semester_id'] as string);
    if (semester === undefined) continue;
    const totalWeeks = Number(semester['total_weeks']);
    const firstMonday = weekStart(semester['start_date'] as string);
    const day = Number(schedule['day_of_week']);
    const weeks = maskToWeeks(Number(schedule['weeks_mask']), totalWeeks);
    const tail: Array<{ week: number; row: Row }> = [];
    for (let index = weeks.length - 1; index >= 0; index -= 1) {
      const week = weeks[index] as number;
      const row = byDate.get(addDays(firstMonday, (week - 1) * 7 + (day - 1)));
      if (row === undefined) break;
      tail.unshift({ week, row });
    }
    if (tail.length < 2) continue;
    const created = tail.map((item) => Number(item.row['created_at']));
    if (Math.max(...created) - Math.min(...created) > BATCH_WINDOW_MS) continue;
    const endWeek = tail[0]!.week;
    await truncateScheduleWeeks(storage, {
      scheduleId: schedule['id'] as string,
      keepWeeks: weeks.filter((week) => week <= endWeek),
      totalWeeks,
      dropEventIds: tail.slice(1).map((item) => item.row['id'] as string),
    });
    converted += 1;
  }
  await storage.writeMeta(COURSE_END_CONVERT_KEY, '1');
  return converted;
}
