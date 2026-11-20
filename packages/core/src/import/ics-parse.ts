/** ICS 解析：VCALENDAR 文本 → 事件与排课。 */

import {
  DEFAULT_TIME_ZONE,
  addDays,
  dayOfWeek,
  diffDays,
  epochFromParts,
  formatDate,
  formatTime,
  isValidTimeZone,
  partsInZone,
  weekStart,
} from '../time.ts';
import type { ImportedSchedule } from './apply.ts';
import { DAY_CODES, unescapeIcsText } from './ics-shared.ts';
import type { IcsSemester, IcsTimeSlot } from './ics-shared.ts';

export interface ParsedIcsEvent {
  uid: string;
  summary: string;
  location: string | null;
  description: string | null;
  start: number;
  end: number;
  /** DTSTART 为 DATE 值（全天） */
  allDay: boolean;
  /** 重复规则按哪个时区的墙钟展开：TZID、`Z` 为 UTC、浮动时间为导入时给的默认时区 */
  timeZone: string;
  rrule: string | null;
  rdates: number[];
  exdates: number[];
  /** DATE 值的 EXDATE：按日期排除，不比时刻 */
  exdateDays: string[];
}

export interface ParsedCalendar {
  events: ParsedIcsEvent[];
  warnings: string[];
}

export interface ParseIcsOptions {
  /** 浮动时间（不带 Z 也不带 TZID）与无法识别的 TZID 按这个时区读；默认 Asia/Shanghai */
  defaultTimeZone?: string;
}

/** Outlook / Exchange 导出常见的 Windows 时区名。 */
const WINDOWS_TIME_ZONES: Record<string, string> = {
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Singapore Standard Time': 'Asia/Singapore',
  'India Standard Time': 'Asia/Kolkata',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC',
};

function unfold(text: string): string[] {
  const raw = text.replace(/^﻿/, '').split(/\r?\n/);
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

function paramOf(params: string, name: string): string | undefined {
  for (const chunk of params.split(';')) {
    const [key, ...rest] = chunk.split('=');
    if (key?.trim().toUpperCase() === name) return rest.join('=').trim().replace(/^"(.*)"$/, '$1');
  }
  return undefined;
}

interface DateValue {
  epoch: number;
  /** YYYY-MM-DD，DATE 值才有 */
  date: string | null;
  timeZone: string;
}

/** 解析单个 DATE / DATE-TIME 值。时区按 Z → TZID → 默认时区的顺序取。 */
function parseIcsValue(value: string, params: string, resolveZone: (tzid: string | undefined) => string): DateValue | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
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
  const isDate = hour === undefined;
  if (zulu === 'Z') {
    return {
      epoch: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
      date: null,
      timeZone: 'UTC',
    };
  }
  const timeZone = resolveZone(paramOf(params, 'TZID'));
  return {
    epoch: epochFromParts(parts, timeZone),
    date: isDate ? `${year}-${month}-${day}` : null,
    timeZone,
  };
}

interface ExpandOptions {
  rdates?: readonly number[];
  exdates?: readonly number[];
  exdateDays?: readonly string[];
  /** 按哪个时区的墙钟逐周推进；跨夏令时也保持同一墙钟时刻 */
  timeZone?: string;
}

const MAX_OCCURRENCES = 400;
const DAY_CODE_INDEX = new Map(DAY_CODES.map((code, index) => [code, index + 1]));

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * 展开 FREQ=WEEKLY 的 RRULE（支持 INTERVAL、COUNT、UNTIL、多值 BYDAY），返回起始时刻毫秒列表。
 * COUNT 按 RFC 5545 计入被 EXDATE 排除的那些；其余频度记入 warnings、只保留首次。
 */
export function expandWeeklyRrule(
  start: number,
  rrule: string,
  options: ExpandOptions = {},
): { dates: number[]; warnings: string[] } {
  const timeZone = options.timeZone ?? 'UTC';
  const warnings: string[] = [];
  const parts = new Map<string, string>();
  for (const chunk of rrule.split(';')) {
    const [key, value] = chunk.split('=');
    if (key !== undefined && value !== undefined) parts.set(key.trim().toUpperCase(), value.trim());
  }
  const excludedAt = new Set(options.exdates ?? []);
  const excludedDays = new Set(options.exdateDays ?? []);
  const isExcluded = (epoch: number): boolean =>
    excludedAt.has(epoch) || excludedDays.has(formatDate(epoch, timeZone));

  const freq = parts.get('FREQ');
  const collected: number[] = [];
  if (freq !== 'WEEKLY') {
    warnings.push(`不支持的 RRULE 频度: ${freq ?? '未指定'}，只导入首次`);
    if (!isExcluded(start)) collected.push(start);
  } else {
    const interval = Math.max(1, Number(parts.get('INTERVAL') ?? '1') || 1);
    const countText = parts.get('COUNT');
    const count = countText === undefined ? null : Math.max(0, Number(countText) || 0);
    const untilText = parts.get('UNTIL');
    let until: number | null = null;
    if (untilText !== undefined) {
      const parsed = parseIcsValue(untilText, '', () => timeZone);
      // 仅日期的 UNTIL 含当天：截到当天最后一刻
      until = parsed === null ? null : parsed.date !== null ? parsed.epoch + 86400000 - 1 : parsed.epoch;
    }

    const wall = partsInZone(start, timeZone);
    const startDate = `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
    const byDay = (parts.get('BYDAY') ?? '')
      .split(',')
      .map((code) => DAY_CODE_INDEX.get(code.trim().toUpperCase().replace(/^[+-]?\d+/, '')))
      .filter((day): day is number => day !== undefined);
    const days = byDay.length > 0 ? [...new Set(byDay)].sort((a, b) => a - b) : [dayOfWeek(startDate)];
    const firstMonday = weekStart(startDate);

    let produced = 0;
    outer: for (let week = 0; week < 1000; week += interval) {
      for (const day of days) {
        const date = addDays(firstMonday, week * 7 + day - 1);
        if (diffDays(date, startDate) < 0) continue;
        const [year, month, dayOfMonth] = date.split('-').map(Number);
        const epoch = epochFromParts(
          { year: year as number, month: month as number, day: dayOfMonth as number, hour: wall.hour, minute: wall.minute, second: wall.second },
          timeZone,
        );
        if (until !== null && epoch > until) break outer;
        if (count !== null && produced >= count) break outer;
        produced += 1;
        if (!isExcluded(epoch)) collected.push(epoch);
        if (collected.length >= MAX_OCCURRENCES) {
          warnings.push(`重复次数超过 ${MAX_OCCURRENCES}，其余已忽略`);
          break outer;
        }
      }
      if (count === null && until === null && produced >= MAX_OCCURRENCES) break;
    }
  }
  const all = new Set(collected);
  for (const extra of options.rdates ?? []) {
    if (!isExcluded(extra)) all.add(extra);
  }
  return { dates: [...all].sort((a, b) => a - b), warnings };
}

export function parseIcs(text: string, options: ParseIcsOptions = {}): ParsedCalendar {
  const fallbackZone =
    options.defaultTimeZone !== undefined && isValidTimeZone(options.defaultTimeZone)
      ? options.defaultTimeZone
      : DEFAULT_TIME_ZONE;
  const warnings: string[] = [];
  const unknownZones = new Set<string>();
  const resolveZone = (tzid: string | undefined): string => {
    if (tzid === undefined || tzid.length === 0) return fallbackZone;
    if (isValidTimeZone(tzid)) return tzid;
    const windows = WINDOWS_TIME_ZONES[tzid];
    if (windows !== undefined) return windows;
    // 形如 /mozilla.org/20050126_1/Asia/Shanghai 的前缀
    const tail = /([A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(tzid)?.[1];
    if (tail !== undefined && isValidTimeZone(tail)) return tail;
    if (!unknownZones.has(tzid)) {
      unknownZones.add(tzid);
      warnings.push(`无法识别的时区 ${tzid}，按 ${fallbackZone} 读取`);
    }
    return fallbackZone;
  };

  const events: ParsedIcsEvent[] = [];
  type Property = { value: string; params: string };
  let current: Map<string, Property[]> | null = null;
  // VEVENT 里嵌套的 VALARM 等组件有自己的 DESCRIPTION / TRIGGER，不能混进事件
  let nested = 0;

  const first = (name: string): Property | undefined => current?.get(name)?.[0];

  const flush = (): void => {
    const startRaw = first('DTSTART');
    const summary = first('SUMMARY');
    if (startRaw === undefined || summary === undefined) {
      warnings.push('有 VEVENT 缺少 DTSTART 或 SUMMARY');
      return;
    }
    const start = parseIcsValue(startRaw.value, startRaw.params, resolveZone);
    if (start === null) {
      warnings.push(`无法解析 DTSTART: ${startRaw.value}`);
      return;
    }
    const endRaw = first('DTEND');
    const end = endRaw === undefined ? null : parseIcsValue(endRaw.value, endRaw.params, resolveZone);
    const rdates: number[] = [];
    for (const property of current?.get('RDATE') ?? []) {
      for (const item of property.value.split(',')) {
        const parsed = parseIcsValue(item, property.params, resolveZone);
        if (parsed !== null) rdates.push(parsed.epoch);
      }
    }
    const exdates: number[] = [];
    const exdateDays: string[] = [];
    for (const property of current?.get('EXDATE') ?? []) {
      for (const item of property.value.split(',')) {
        const parsed = parseIcsValue(item, property.params, resolveZone);
        if (parsed === null) continue;
        if (parsed.date !== null) exdateDays.push(parsed.date);
        else exdates.push(parsed.epoch);
      }
    }
    const location = first('LOCATION');
    const description = first('DESCRIPTION');
    events.push({
      uid: first('UID')?.value ?? '',
      summary: unescapeIcsText(summary.value),
      location: location === undefined ? null : unescapeIcsText(location.value),
      description: description === undefined ? null : unescapeIcsText(description.value),
      start: start.epoch,
      end: end?.epoch ?? start.epoch,
      allDay: start.date !== null,
      timeZone: start.timeZone,
      rrule: first('RRULE')?.value ?? null,
      rdates,
      exdates,
      exdateDays,
    });
  };

  for (const rawLine of unfold(text)) {
    const line = rawLine.trimEnd();
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      current = new Map();
      nested = 0;
      continue;
    }
    if (current === null) continue;
    if (upper === 'END:VEVENT') {
      flush();
      current = null;
      continue;
    }
    if (upper.startsWith('BEGIN:')) {
      nested += 1;
      continue;
    }
    if (upper.startsWith('END:')) {
      nested = Math.max(0, nested - 1);
      continue;
    }
    if (nested > 0) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const [name, ...params] = line.slice(0, separator).split(';');
    if (name === undefined || name.length === 0) continue;
    const key = name.toUpperCase();
    const list = current.get(key) ?? [];
    list.push({ value: line.slice(separator + 1), params: params.join(';') });
    current.set(key, list);
  }

  return { events, warnings };
}

/** 把 ICS 事件按「课程名 + 星期 + 节次 + 地点」聚合为可写入的排课；多值 BYDAY 拆成多条。 */
export function icsToSchedules(
  calendar: ParsedCalendar,
  semester: IcsSemester,
  timeSlots: readonly IcsTimeSlot[],
): { schedules: ImportedSchedule[]; warnings: string[] } {
  const warnings = [...calendar.warnings];
  const slots = [...timeSlots].sort((a, b) => a.period_no - b.period_no);
  const merged = new Map<string, ImportedSchedule>();
  const firstMonday = weekStart(semester.start_date);

  for (const event of calendar.events) {
    if (event.allDay) {
      warnings.push(`全天事件不是课程，已跳过: ${event.summary}`);
      continue;
    }
    const expanded =
      event.rrule === null
        ? { dates: [event.start, ...event.rdates.filter((item) => item !== event.start)], warnings: [] }
        : expandWeeklyRrule(event.start, event.rrule, {
            rdates: event.rdates,
            exdates: event.exdates,
            exdateDays: event.exdateDays,
            timeZone: event.timeZone,
          });
    warnings.push(...expanded.warnings);

    const wallStart = formatTime(event.start, semester.time_zone);
    const wallEnd = formatTime(event.end, semester.time_zone);
    const startSlot = slots.find((slot) => slot.start_time === wallStart);
    const endSlot = [...slots].reverse().find((slot) => slot.end_time === wallEnd) ?? startSlot;
    if (startSlot === undefined) {
      warnings.push(`未找到匹配节次: ${wallStart}，使用第 1 节代替`);
    }
    const periodStart = startSlot?.period_no ?? 1;
    const periodEnd = Math.max(endSlot?.period_no ?? periodStart, periodStart);

    let inRange = 0;
    for (const occurrence of expanded.dates) {
      const date = formatDate(occurrence, semester.time_zone);
      const week = Math.floor(diffDays(date, firstMonday) / 7) + 1;
      if (week < 1 || week > semester.total_weeks) continue;
      inRange += 1;
      const day = dayOfWeek(date);
      const key = `${event.summary}|${day}|${periodStart}|${periodEnd}|${event.location ?? ''}`;
      const existing = merged.get(key);
      if (existing === undefined) {
        merged.set(key, {
          courseName: event.summary,
          dayOfWeek: day,
          periodStart,
          periodEnd,
          weeks: [week],
          room: event.location,
          teacher: event.description,
        });
      } else if (!existing.weeks.includes(week)) {
        existing.weeks.push(week);
      }
    }
    if (inRange === 0) warnings.push(`事件不在学期范围内: ${event.summary}`);
  }

  for (const schedule of merged.values()) schedule.weeks.sort((a, b) => a - b);
  return { schedules: [...merged.values()], warnings };
}
