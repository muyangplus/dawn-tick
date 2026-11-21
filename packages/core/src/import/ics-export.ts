/** ICS 导出：学期课表 → VCALENDAR 文本。 */

import {
  addDays,
  epochFromParts,
  formatDate,
  parseTime,
  weekStart,
} from '../time.ts';
import { maskToWeeks } from '../weeks.ts';
import { DAY_CODES, escapeIcsText } from './ics-shared.ts';
import type { IcsSemester, IcsTimeSlot } from './ics-shared.ts';
export type { IcsSemester, IcsTimeSlot } from './ics-shared.ts';

export interface IcsCourse {
  id: string;
  name: string;
  short_name: string | null;
  teacher: string | null;
  location: string | null;
}

export interface IcsSchedule {
  id: string;
  course_id: string;
  day_of_week: number;
  period_start: number;
  period_end: number;
  weeks_mask: number;
  room: string | null;
}

/**
 * 额外条目：课表模型表达不了的单次事件（调课落点、自定义时间课次、日程）。
 * 与 `schedules` 的周次位图模型不同，这里直接给起止时刻，不生成 RRULE。
 */
export interface IcsExtraEvent {
  uid: string;
  summary: string;
  /** 开始时刻（毫秒） */
  start: number;
  /** 结束时刻（毫秒）；全天条目忽略，按开始日期的次日结束 */
  end: number;
  location?: string | null;
  description?: string | null;
  /** 全天条目：DTSTART/DTEND 写成 DATE 值，日期按学期时区取 */
  allDay?: boolean;
}

export interface IcsExportInput {
  semester: IcsSemester;
  courses: readonly IcsCourse[];
  schedules: readonly IcsSchedule[];
  timeSlots: readonly IcsTimeSlot[];
  /** 额外条目：先写课表排课，再写这些单次事件 */
  extraEvents?: readonly IcsExtraEvent[];
  calendarName?: string;
  stamp?: number;
}


function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function icsStamp(epochMs: number): string {
  const date = new Date(epochMs);
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 74) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

/** 连续周次分段：用于把不规则周次拆成多个 VEVENT。 */
export function consecutiveRuns(weeks: readonly number[]): Array<{ from: number; to: number; step: number }> {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const runs: Array<{ from: number; to: number; step: number }> = [];
  let index = 0;
  while (index < sorted.length) {
    const first = sorted[index] as number;
    const second = sorted[index + 1];
    if (second !== undefined && second - first === 2) {
      let cursor = index;
      while (cursor + 1 < sorted.length && (sorted[cursor + 1] as number) - (sorted[cursor] as number) === 2) {
        cursor += 1;
      }
      runs.push({ from: first, to: sorted[cursor] as number, step: 2 });
      index = cursor + 1;
      continue;
    }
    let cursor = index;
    while (cursor + 1 < sorted.length && (sorted[cursor + 1] as number) - (sorted[cursor] as number) === 1) {
      cursor += 1;
    }
    runs.push({ from: first, to: sorted[cursor] as number, step: 1 });
    index = cursor + 1;
  }
  return runs;
}

export function exportIcs(input: IcsExportInput): string {
  const stamp = input.stamp ?? Date.now();
  const slotByPeriod = new Map(input.timeSlots.map((slot) => [slot.period_no, slot]));
  const courseById = new Map(input.courses.map((course) => [course.id, course]));
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//dawn-tick//xiaoke//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (input.calendarName !== undefined) {
    lines.push(`X-WR-CALNAME:${escapeIcsText(input.calendarName)}`);
  }

  const weekOneMonday = weekStart(input.semester.start_date);

  for (const schedule of input.schedules) {
    const course = courseById.get(schedule.course_id);
    if (course === undefined) continue;
    const startSlot = slotByPeriod.get(schedule.period_start);
    const endSlot = slotByPeriod.get(schedule.period_end);
    if (startSlot === undefined || endSlot === undefined) continue;

    const weeks = maskToWeeks(schedule.weeks_mask, input.semester.total_weeks);
    const runs = consecutiveRuns(weeks);
    const single = runs.length === 1 && runs[0]?.step === 1 && (runs[0]?.to ?? 0) - (runs[0]?.from ?? 0) + 1 === weeks.length;
    const irregular = !single && runs.some((run) => run.step === 2);

    for (const [index, run] of runs.entries()) {
      const firstDate = addDays(weekOneMonday, (run.from - 1) * 7 + (schedule.day_of_week - 1));
      const startAt = icsEpoch(firstDate, startSlot.start_time, input.semester.time_zone);
      const endAt = icsEpoch(firstDate, endSlot.end_time, input.semester.time_zone);
      const count = Math.floor((run.to - run.from) / run.step) + 1;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${schedule.id}-${index}@dawn-tick`);
      lines.push(`DTSTAMP:${icsStamp(stamp)}`);
      lines.push(`DTSTART:${icsStamp(startAt)}`);
      lines.push(`DTEND:${icsStamp(endAt)}`);
      lines.push(`SUMMARY:${escapeIcsText(course.name)}`);
      const location = schedule.room ?? course.location;
      if (location !== null) lines.push(`LOCATION:${escapeIcsText(location)}`);
      const description = [course.teacher, course.short_name].filter((item) => item !== null).join(' ');
      if (description.length > 0) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);

      if (single) {
        lines.push(
          `RRULE:FREQ=WEEKLY;COUNT=${count};BYDAY=${DAY_CODES[schedule.day_of_week - 1]};WKST=MO`,
        );
      } else if (irregular && run.step === 2) {
        lines.push(
          `RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=${count};BYDAY=${DAY_CODES[schedule.day_of_week - 1]};WKST=MO`,
        );
      } else {
        const rdates: string[] = [];
        for (let week = run.from; week <= run.to; week += run.step) {
          const date = addDays(weekOneMonday, (week - 1) * 7 + (schedule.day_of_week - 1));
          rdates.push(icsStamp(icsEpoch(date, startSlot.start_time, input.semester.time_zone)));
        }
        if (rdates.length > 1) {
          lines.push(`RDATE:${rdates.slice(1).join(',')}`);
          lines.push(
            `RRULE:FREQ=WEEKLY;COUNT=1;BYDAY=${DAY_CODES[schedule.day_of_week - 1]};WKST=MO`,
          );
        }
      }
      lines.push('END:VEVENT');
    }
  }

  for (const event of input.extraEvents ?? []) {
    pushExtraEvent(lines, event, stamp, input.semester.time_zone);
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** 单次事件：全天条目写 DATE 值（DTEND 为次日），其余写 UTC 时刻。 */
function pushExtraEvent(
  lines: string[],
  event: IcsExtraEvent,
  stamp: number,
  timeZone: string,
): void {
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${event.uid}`);
  lines.push(`DTSTAMP:${icsStamp(stamp)}`);
  if (event.allDay === true) {
    const date = formatDate(event.start, timeZone);
    lines.push(`DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`);
    lines.push(`DTEND;VALUE=DATE:${addDays(date, 1).replace(/-/g, '')}`);
  } else {
    lines.push(`DTSTART:${icsStamp(event.start)}`);
    lines.push(`DTEND:${icsStamp(event.end)}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
  if (event.location !== undefined && event.location !== null) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  if (event.description !== undefined && event.description !== null && event.description.length > 0) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  lines.push('END:VEVENT');
}

function icsEpoch(date: string, time: string, timeZone: string): number {
  const parsed = parseTime(time);
  const [year, month, day] = date.split('-').map(Number);
  return epochFromParts(
    {
      year: year as number,
      month: month as number,
      day: day as number,
      hour: parsed.hour,
      minute: parsed.minute,
      second: 0,
    },
    timeZone,
  );
}
