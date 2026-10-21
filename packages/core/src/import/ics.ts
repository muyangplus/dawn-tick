import { epochFromParts, formatDate, formatTime, parseTime, weekStart, addDays, dayOfWeek } from '../time.ts';
import { maskToWeeks } from '../weeks.ts';
import type { ImportedSchedule } from './apply.ts';

export interface IcsSemester {
  id: string;
  start_date: string;
  total_weeks: number;
  time_zone: string;
}

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

export interface IcsTimeSlot {
  period_no: number;
  start_time: string;
  end_time: string;
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

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

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

export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function unescapeIcsText(text: string): string {
  return text
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
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

export interface ParsedIcsEvent {
  uid: string;
  summary: string;
  location: string | null;
  description: string | null;
  start: number;
  end: number;
  rrule: string | null;
  rdates: number[];
  exdates: number[];
}

export interface ParsedCalendar {
  events: ParsedIcsEvent[];
  warnings: string[];
}

function unfold(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const line of raw) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}${line.slice(1)}`;
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseIcsDate(value: string, params: string): number | null {
  const trimmed = value.trim();
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(trimmed);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second, zulu] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: hour === undefined ? 0 : Number(hour),
    minute: minute === undefined ? 0 : Number(minute),
    second: second === undefined ? 0 : Number(second),
  };
  if (zulu === 'Z') return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const tzid = /TZID=([^;:]+)/.exec(params)?.[1];
  return epochFromParts(parts, tzid ?? 'UTC');
}

/** 展开 FREQ=WEEKLY 的 RRULE，返回起始时刻毫秒列表。其余频度记入 warnings。 */
export function expandWeeklyRrule(
  start: number,
  rrule: string,
  extraDates: readonly number[],
  excluded: readonly number[],
): { dates: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const parts = new Map<string, string>();
  for (const chunk of rrule.split(';')) {
    const [key, value] = chunk.split('=');
    if (key !== undefined && value !== undefined) parts.set(key.trim().toUpperCase(), value.trim());
  }
  const freq = parts.get('FREQ');
  if (freq !== 'WEEKLY') {
    warnings.push(`不支持的 RRULE 频度: ${freq ?? '未指定'}`);
    return { dates: [], warnings };
  }
  const interval = Number(parts.get('INTERVAL') ?? '1');
  const count = parts.get('COUNT') === undefined ? null : Number(parts.get('COUNT'));
  const untilText = parts.get('UNTIL');
  const until = untilText === undefined ? null : (parseIcsDate(untilText, '') ?? null);

  const WEEK = 7 * 86400000;
  const dates: number[] = [];
  let current = start;
  let produced = 0;
  const limit = count ?? 200;
  while (produced < limit) {
    if (until !== null && current > until) break;
    if (!excluded.includes(current)) {
      dates.push(current);
      produced += 1;
    } else if (count !== null) {
      produced += 1;
    }
    if (count === null && until !== null && current + interval * WEEK > until) break;
    current += interval * WEEK;
    if (dates.length + extraDates.length > 400) break;
  }
  for (const extra of extraDates) {
    if (!dates.includes(extra) && !excluded.includes(extra)) dates.push(extra);
  }
  return { dates: dates.sort((a, b) => a - b), warnings };
}

export function parseIcs(text: string): ParsedCalendar {
  const warnings: string[] = [];
  const events: ParsedIcsEvent[] = [];
  const lines = unfold(text);
  let inEvent = false;
  let current: Record<string, { value: string; params: string }> = {};

  const flush = (): void => {
    const startRaw = current['DTSTART'];
    const summary = current['SUMMARY'];
    if (startRaw === undefined || summary === undefined) {
      if (Object.keys(current).length > 0) warnings.push('有 VEVENT 缺少 DTSTART 或 SUMMARY');
      current = {};
      return;
    }
    const start = parseIcsDate(startRaw.value, startRaw.params);
    if (start === null) {
      warnings.push(`无法解析 DTSTART: ${startRaw.value}`);
      current = {};
      return;
    }
    const endRaw = current['DTEND'];
    const end = endRaw === undefined ? start : (parseIcsDate(endRaw.value, endRaw.params) ?? start);
    const rrule = current['RRULE']?.value ?? null;
    const rdates = (current['RDATE']?.value ?? '')
      .split(',')
      .map((item) => parseIcsDate(item, current['RDATE']?.params ?? ''))
      .filter((item): item is number => item !== null);
    const exdates = (current['EXDATE']?.value ?? '')
      .split(',')
      .map((item) => parseIcsDate(item, current['EXDATE']?.params ?? ''))
      .filter((item): item is number => item !== null);

    events.push({
      uid: current['UID']?.value ?? '',
      summary: unescapeIcsText(summary.value),
      location: current['LOCATION'] === undefined ? null : unescapeIcsText(current['LOCATION'].value),
      description: current['DESCRIPTION'] === undefined ? null : unescapeIcsText(current['DESCRIPTION'].value),
      start,
      end,
      rrule,
      rdates,
      exdates,
    });
    current = {};
  };

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (inEvent) flush();
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const left = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const [name, ...params] = left.split(';');
    if (name === undefined) continue;
    current[name.toUpperCase()] = { value, params: params.join(';') };
  }

  return { events, warnings };
}

/** 把 ICS 事件按「课程名 + 地点」聚合为可写入的排课。 */
export function icsToSchedules(
  calendar: ParsedCalendar,
  semester: IcsSemester,
  timeSlots: readonly IcsTimeSlot[],
): { schedules: ImportedSchedule[]; warnings: string[] } {
  const warnings = [...calendar.warnings];
  const slots = [...timeSlots].sort((a, b) => a.period_no - b.period_no);
  const merged = new Map<string, ImportedSchedule>();

  for (const event of calendar.events) {
    const expanded =
      event.rrule === null
        ? { dates: [event.start], warnings: [] }
        : expandWeeklyRrule(event.start, event.rrule, event.rdates, event.exdates);
    warnings.push(...expanded.warnings);

    const wallStart = formatTime(event.start, semester.time_zone);
    const wallEnd = formatTime(event.end, semester.time_zone);
    const startSlot = slots.find((slot) => slot.start_time === wallStart);
    const endSlot = [...slots].reverse().find((slot) => slot.end_time === wallEnd) ?? startSlot;
    if (startSlot === undefined) {
      warnings.push(`未找到匹配节次: ${wallStart}，使用第 1 节代替`);
    }
    const periodStart = startSlot?.period_no ?? 1;
    const periodEnd = endSlot?.period_no ?? periodStart;

    const day = dayOfWeek(formatDate(event.start, semester.time_zone));
    const weeks = new Set<number>();
    for (const date of expanded.dates) {
      const formatted = formatDate(date, semester.time_zone);
      const diff = Math.floor(diffInDays(formatted, weekStart(semester.start_date)) / 7) + 1;
      if (diff >= 1 && diff <= semester.total_weeks) weeks.add(diff);
    }
    if (weeks.size === 0) {
      warnings.push(`事件不在学期范围内: ${event.summary}`);
      continue;
    }

    const key = `${event.summary}|${day}|${periodStart}|${periodEnd}|${event.location ?? ''}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        courseName: event.summary,
        dayOfWeek: day,
        periodStart,
        periodEnd,
        weeks: [...weeks].sort((a, b) => a - b),
        room: event.location,
        teacher: event.description,
      });
    } else {
      existing.weeks = [...new Set([...existing.weeks, ...weeks])].sort((a, b) => a - b);
    }
  }

  return { schedules: [...merged.values()], warnings };
}

function diffInDays(later: string, earlier: string): number {
  const toMs = (date: string): number => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year as number, (month as number) - 1, day as number);
  };
  return Math.round((toMs(later) - toMs(earlier)) / 86400000);
}
