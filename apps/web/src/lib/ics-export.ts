import {
  addDays,
  exportIcs,
  maskToWeeks,
  weekStart,
  weeksToMask,
  type CourseRow,
  type CourseScheduleRow,
  type EventRow,
  type IcsCourse,
  type IcsExtraEvent,
  type IcsSchedule,
  type SemesterRow,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { dayStampUtc } from './dates.ts';
import { collectEventExtras, clockOf, scheduleExtraEvent } from './ics-export-events.ts';

/**
 * 课表导出 ICS 的数据组装（R-01）：纯函数，不读 storage。
 *
 * 边界：
 * - 课表走 core `exportIcs` 的周次位图 + RRULE 压缩；调课落点、自定义时间课次与日程
 *   走 `extraEvents` 单次事件（周次位图表达不了逐次覆盖）；
 * - 停课不导出，调课按「调整后」的日期/节次/地点落事件（与课表页口径一致）；
 * - 无法写入的条目只统计并给出可读说明，不静默丢数据。
 */

/** 导出输入：调用方从 storage 读出的当前学期数据。 */
export interface IcsExportInput {
  semester: SemesterRow;
  courses: readonly CourseRow[];
  schedules: readonly CourseScheduleRow[];
  events: readonly EventRow[];
  slots: readonly TimeSlotRow[];
}

export interface IcsExportOptions {
  /** Q17：是否把日程（待办/考试/作业/实验）一并写入，默认不写 */
  includeEvents: boolean;
  /** 生成时间与 DTSTAMP，测试可固定 */
  now?: number;
}

export interface IcsExportCounts {
  /** 学期内课程门数 */
  courses: number;
  /** 学期内排课条数 */
  schedules: number;
  /** 写进 ICS 的上课次数（含调课落点与自定义时间，不含停课） */
  lessons: number;
  /** 可写入的日程条数（按源条目计，勾选日程时才有） */
  events: number;
  /** 按「调整后」写入的调课次数 */
  moved: number;
  /** 停课而未导出的次数 */
  cancelled: number;
}

export interface IcsExportResult {
  text: string;
  counts: IcsExportCounts;
  /** 无法写入的内容说明；空数组表示全部写入 */
  notes: string[];
  /** DawnTick-<学期名>-<日期>.ics */
  fileName: string;
}

/** 同一「排课 + 日期」多次调整时后写的生效，与课表页按 updated_at 覆盖的口径一致。 */
function rescheduleByKey(events: readonly EventRow[]): Map<string, EventRow> {
  const map = new Map<string, EventRow>();
  const rows = events
    .filter(
      (row) =>
        row.deleted_at === null &&
        row.type === 'reschedule' &&
        typeof row.ref_schedule_id === 'string' &&
        typeof row.on_date === 'string',
    )
    .sort((left, right) => left.updated_at - right.updated_at);
  for (const row of rows) {
    map.set(`${row.ref_schedule_id as string}|${row.on_date as string}`, row);
  }
  return map;
}

/** 第 N 周（从学期第一周周一起算）星期几的日期。 */
function dateOfWeek(semester: SemesterRow, week: number, day: number): string {
  return addDays(weekStart(semester.start_date), (week - 1) * 7 + (day - 1));
}

/**
 * 生成 ICS 文本与统计：排课先按周次位图落基础事件，停课/调课的周次从位图剔除，
 * 调课落点与自定义时间课次再作为单次事件写入。
 */
export function buildIcsExport(input: IcsExportInput, options: IcsExportOptions): IcsExportResult {
  const now = options.now ?? Date.now();
  const { semester } = input;
  const timeZone = semester.time_zone;
  const slots = input.slots.filter((slot) => slot.deleted_at === null);
  const courses = input.courses.filter(
    (course) => course.deleted_at === null && course.semester_id === semester.id,
  );
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const schedules = input.schedules.filter(
    (schedule) => schedule.deleted_at === null && courseById.has(schedule.course_id),
  );
  const semesterEvents = input.events.filter(
    (row) => row.deleted_at === null && row.semester_id === semester.id,
  );
  const overrides = rescheduleByKey(semesterEvents);

  const baseSchedules: IcsSchedule[] = [];
  const extraEvents: IcsExtraEvent[] = [];
  let lessons = 0;
  let moved = 0;
  let cancelled = 0;
  let missingClock = 0;
  let unsupportedAdjust = 0;

  for (const schedule of schedules) {
    const course = courseById.get(schedule.course_id);
    if (course === undefined) continue;
    const weeks = maskToWeeks(schedule.weeks_mask, semester.total_weeks);
    const custom =
      typeof schedule.start_time === 'string' && typeof schedule.end_time === 'string'
        ? { start: schedule.start_time, end: schedule.end_time }
        : null;
    const remaining: number[] = [];

    for (const week of weeks) {
      const date = dateOfWeek(semester, week, schedule.day_of_week);
      const override = overrides.get(`${schedule.id}|${date}`);
      if (override !== undefined) {
        if (override.action === 'cancel') {
          cancelled += 1;
          continue;
        }
        if (
          override.action === 'move' ||
          override.action === 'room_change' ||
          override.action === 'add'
        ) {
          const clock = clockOf(
            schedule,
            override.new_period_start ?? schedule.period_start,
            override.new_period_end ?? schedule.period_end,
            slots,
          );
          if (clock === null) {
            missingClock += 1;
            continue;
          }
          extraEvents.push(
            scheduleExtraEvent({
              uid: `${schedule.id}-${date}-${override.action}@dawn-tick`,
              course,
              date: override.new_date ?? date,
              clock,
              room: override.new_room ?? schedule.room ?? course.location,
              timeZone,
            }),
          );
          lessons += 1;
          if (override.action === 'add') {
            // 补课不占用原周次：原课次照常导出，额外再写一条。
            remaining.push(week);
            lessons += 1;
            continue;
          }
          if (override.action === 'move') moved += 1;
          // 调课/换教室都换了这一次的位置，从基础排课的周次位图里剔除。
          continue;
        }
        unsupportedAdjust += 1;
        remaining.push(week);
        continue;
      }

      if (custom !== null) {
        extraEvents.push(
          scheduleExtraEvent({
            uid: `${schedule.id}-${date}-custom@dawn-tick`,
            course,
            date,
            clock: custom,
            room: schedule.room ?? course.location,
            timeZone,
          }),
        );
        lessons += 1;
        continue;
      }
      if (clockOf(schedule, schedule.period_start, schedule.period_end, slots) === null) {
        missingClock += 1;
        continue;
      }
      remaining.push(week);
      lessons += 1;
    }

    if (remaining.length > 0) {
      baseSchedules.push({
        id: schedule.id,
        course_id: schedule.course_id,
        day_of_week: schedule.day_of_week,
        period_start: schedule.period_start,
        period_end: schedule.period_end,
        weeks_mask: weeksToMask(remaining),
        room: schedule.room,
      });
    }
  }

  const collected = collectEventExtras(semesterEvents, slots, semester);
  if (options.includeEvents) extraEvents.push(...collected.events);

  const text = exportIcs({
    semester: {
      id: semester.id,
      start_date: semester.start_date,
      total_weeks: semester.total_weeks,
      time_zone: timeZone,
    },
    courses: courses.map(
      (course): IcsCourse => ({
        id: course.id,
        name: course.name,
        short_name: course.short_name,
        teacher: course.teacher,
        location: course.location,
      }),
    ),
    schedules: baseSchedules,
    timeSlots: slots.map((slot) => ({
      period_no: slot.period_no,
      start_time: slot.start_time,
      end_time: slot.end_time,
    })),
    extraEvents,
    calendarName: `${semester.name} 课表`,
    stamp: now,
  });

  const notes: string[] = [];
  if (missingClock > 0) notes.push(`${missingClock} 条排课缺少作息时间，未写入 ICS`);
  if (unsupportedAdjust > 0) notes.push(`${unsupportedAdjust} 条调课记录无法写入 ICS`);
  if (collected.skipped > 0) notes.push(`${collected.skipped} 条日程没有可用的日期或时间，未写入 ICS`);
  if (options.includeEvents && collected.signMarkers > 0) {
    notes.push('节假日与调休标记不写入 ICS');
  }

  return {
    text,
    counts: {
      courses: courses.length,
      schedules: schedules.length,
      lessons,
      events: collected.rows,
      moved,
      cancelled,
    },
    notes,
    fileName: icsFileName(semester.name, now),
  };
}

/** 文件名：DawnTick-<学期名>-<UTC 日期>.ics；学期名去掉文件系统保留字符。 */
export function icsFileName(semesterName: string, stamp: number): string {
  const safe = semesterName
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `DawnTick-${safe.length === 0 ? '课表' : safe}-${dayStampUtc(stamp)}.ics`;
}
