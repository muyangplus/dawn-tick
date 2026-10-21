import {
  addDays,
  dateWallClockToEpoch,
  dayOfWeek,
  maskToWeeks,
  type CourseRow,
  type CourseScheduleRow,
  type EventRow,
  type IcsExtraEvent,
  type SemesterRow,
  type TimeSlotRow,
} from '@dawn-tick/core';

/**
 * 排课与日程 → ICS 单次事件（R-01 的纯映射，不读 storage）。
 *
 * 周次位图表达不了逐次覆盖：调课落点、自定义时间课次走这里；
 * 实验等带周次位图的日程按各周同一天展开；只有日期的条目不丢弃，按全天写入；
 * 节假日/调休只是课表口径的日期标记，不写成日历事件。
 */

const EVENT_TYPE_LABEL: Record<string, string> = {
  exam: '考试',
  todo: '日程',
  temp: '临时',
  homework: '作业',
  lab: '实验',
};

function describeCourse(course: CourseRow): string | null {
  const parts = [course.teacher, course.short_name].filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
  return parts.length === 0 ? null : parts.join(' ');
}

/** 课次钟点：排课自带的自定义时间优先，否则按节次查作息表。 */
export function clockOf(
  schedule: CourseScheduleRow,
  periodStart: number,
  periodEnd: number,
  slots: readonly TimeSlotRow[],
): { start: string; end: string } | null {
  if (typeof schedule.start_time === 'string' && typeof schedule.end_time === 'string') {
    return { start: schedule.start_time, end: schedule.end_time };
  }
  const start = slots.find((slot) => slot.period_no === periodStart);
  const end = slots.find((slot) => slot.period_no === periodEnd);
  if (start === undefined || end === undefined) return null;
  if (typeof start.start_time !== 'string' || typeof end.end_time !== 'string') return null;
  return { start: start.start_time, end: end.end_time };
}

/** 某天的钟点转起止时刻；结束不晚于开始时视为跨天。 */
function clockRangeEpoch(
  date: string,
  clock: { start: string; end: string },
  timeZone: string,
): { start: number; end: number } {
  const start = dateWallClockToEpoch(date, clock.start, timeZone);
  const end = dateWallClockToEpoch(date, clock.end, timeZone);
  return {
    start,
    end: end > start ? end : dateWallClockToEpoch(addDays(date, 1), clock.end, timeZone),
  };
}

export function scheduleExtraEvent(input: {
  uid: string;
  course: CourseRow;
  date: string;
  clock: { start: string; end: string };
  room: string | null;
  timeZone: string;
}): IcsExtraEvent {
  const range = clockRangeEpoch(input.date, input.clock, input.timeZone);
  return {
    uid: input.uid,
    summary: input.course.name,
    start: range.start,
    end: range.end,
    location: input.room,
    description: describeCourse(input.course),
  };
}

export interface CollectedEvents {
  events: IcsExtraEvent[];
  /** 成功写入的源条目数 */
  rows: number;
  /** 没有可用日期/时间的条目数 */
  skipped: number;
  /** 节假日/调休这类日期标记的条数（不写入） */
  signMarkers: number;
}

export function collectEventExtras(
  rows: readonly EventRow[],
  slots: readonly TimeSlotRow[],
  semester: SemesterRow,
): CollectedEvents {
  const result: CollectedEvents = { events: [], rows: 0, skipped: 0, signMarkers: 0 };
  const monday = weekStartMonday(semester.start_date);
  for (const row of rows) {
    if (row.type === 'reschedule') continue;
    if (row.type === 'holiday' || row.type === 'workday' || row.type === 'makeup') {
      result.signMarkers += 1;
      continue;
    }
    const dates = eventDates(row, semester, monday);
    if (dates.length === 0) {
      result.skipped += 1;
      continue;
    }
    let written = false;
    for (const date of dates) {
      const timing = timingOf(row, date, slots, semester.time_zone);
      if (timing === null) continue;
      const label = EVENT_TYPE_LABEL[row.type] ?? '日程';
      result.events.push({
        uid: dates.length === 1 ? `${row.id}@dawn-tick` : `${row.id}-${date}@dawn-tick`,
        summary: row.title,
        start: timing.start,
        end: timing.end,
        location: row.location,
        description: [label, row.note]
          .filter((item): item is string => typeof item === 'string' && item.length > 0)
          .join(' · '),
        allDay: timing.allDay,
      });
      written = true;
    }
    if (written) result.rows += 1;
    else result.skipped += 1;
  }
  return result;
}

/** 学期第一周周一：与 core 的周次公式保持一致。 */
function weekStartMonday(startDate: string): string {
  return addDays(startDate, -(dayOfWeek(startDate) - 1));
}

/** 条目落在哪些日期：实验等带周次位图的按各周同一天展开。 */
function eventDates(row: EventRow, semester: SemesterRow, monday: string): string[] {
  if (typeof row.on_date !== 'string') return [];
  if (typeof row.weeks_mask !== 'number') return [row.on_date];
  const weeks = maskToWeeks(row.weeks_mask, semester.total_weeks);
  if (weeks.length === 0) return [row.on_date];
  const day = typeof row.as_day_of_week === 'number' ? row.as_day_of_week : dayOfWeek(row.on_date);
  return weeks.map((week) => addDays(monday, (week - 1) * 7 + (day - 1)));
}

interface EventTiming {
  start: number;
  end: number;
  allDay: boolean;
}

/** 条目起止：绝对时间优先，其次自定义时间/节次，只有日期时按全天。 */
function timingOf(
  row: EventRow,
  date: string,
  slots: readonly TimeSlotRow[],
  timeZone: string,
): EventTiming | null {
  const allDayStart = dateWallClockToEpoch(date, '00:00', timeZone);
  if (row.all_day === 1) return { start: allDayStart, end: allDayStart, allDay: true };

  if (typeof row.start_at === 'number') {
    const startAt = row.start_at;
    const end = typeof row.end_at === 'number' ? row.end_at : startAt + 45 * 60000;
    return { start: startAt, end: end > startAt ? end : startAt + 45 * 60000, allDay: false };
  }
  if (typeof row.start_time === 'string' && row.start_time.length > 0) {
    const start = dateWallClockToEpoch(date, row.start_time, timeZone);
    const end =
      typeof row.end_time === 'string' && row.end_time.length > 0
        ? dateWallClockToEpoch(date, row.end_time, timeZone)
        : start + 45 * 60000;
    return { start, end: end > start ? end : start + 45 * 60000, allDay: false };
  }
  if (typeof row.period_start === 'number') {
    const startSlot = slots.find((slot) => slot.period_no === row.period_start);
    const periodEnd = typeof row.period_end === 'number' ? row.period_end : row.period_start;
    const endSlot = slots.find((slot) => slot.period_no === periodEnd);
    if (
      startSlot !== undefined &&
      endSlot !== undefined &&
      typeof startSlot.start_time === 'string' &&
      typeof endSlot.end_time === 'string'
    ) {
      const start = dateWallClockToEpoch(date, startSlot.start_time, timeZone);
      const end = dateWallClockToEpoch(date, endSlot.end_time, timeZone);
      return { start, end: end > start ? end : end + 86400000, allDay: false };
    }
  }
  if (typeof row.due_at === 'number') {
    return { start: row.due_at, end: row.due_at + 30 * 60000, allDay: false };
  }
  return { start: allDayStart, end: allDayStart, allDay: true };
}
