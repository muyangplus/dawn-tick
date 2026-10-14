export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
export const META_TIME_ZONE = 'time_zone';
export const META_AUTO_TIME_ZONE = 'auto_time_zone';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, created);
  return created;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone).format(0);
    return true;
  } catch {
    return false;
  }
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function partsInZone(epochMs: number, timeZone: string): ZonedParts {
  const bag: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** 该时刻在 timeZone 的墙钟时间与 UTC 墙钟时间之差，毫秒。 */
export function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const p = partsInZone(epochMs, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(epochMs / 1000) * 1000;
}

export function parseDate(date: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) throw new RangeError(`非法日期: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function parseTime(time: string): { hour: number; minute: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (m === null) throw new RangeError(`非法时刻: ${time}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** 某时区的墙钟时间转 UTC epoch 毫秒。 */
export function epochFromParts(p: ZonedParts, timeZone: string): number {
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const first = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  return wallAsUtc - zoneOffsetMs(first, timeZone);
}

/** 日期 + 墙钟时刻 + 时区 转 UTC epoch 毫秒。 */
export function dateWallClockToEpoch(date: string, time: string, timeZone: string): number {
  const d = parseDate(date);
  const t = parseTime(time);
  return epochFromParts({ ...d, hour: t.hour, minute: t.minute, second: 0 }, timeZone);
}

function dateFromUtcMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function dateToUtcMs(date: string): number {
  const p = parseDate(date);
  return Date.UTC(p.year, p.month - 1, p.day);
}

export function formatDate(epochMs: number, timeZone: string): string {
  const p = partsInZone(epochMs, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function formatTime(epochMs: number, timeZone: string): string {
  const p = partsInZone(epochMs, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function formatDateTime(epochMs: number, timeZone: string): string {
  return `${formatDate(epochMs, timeZone)} ${formatTime(epochMs, timeZone)}`;
}

/** 纯日期加减，不受时区影响。 */
export function addDays(date: string, days: number): string {
  return dateFromUtcMs(dateToUtcMs(date) + days * 86400000);
}

/** 1=周一 … 7=周日。 */
export function dayOfWeek(date: string): number {
  const dow = new Date(dateToUtcMs(date)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function diffDays(later: string, earlier: string): number {
  return Math.round((dateToUtcMs(later) - dateToUtcMs(earlier)) / 86400000);
}

export function weekStart(date: string): string {
  return addDays(date, -(dayOfWeek(date) - 1));
}

/** 含首含尾的日期序列。 */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let cursor = from; diffDays(cursor, to) <= 0; cursor = addDays(cursor, 1)) {
    out.push(cursor);
  }
  return out;
}

/** 学期第 1 周周一为第 1 周；返回该日期所属周次，早于第 1 周返回 0。 */
export function weekOfDate(date: string, semesterStartDate: string): number {
  return Math.floor(diffDays(weekStart(date), weekStart(semesterStartDate)) / 7) + 1;
}

/** 显示时区：自动同步开启时用设备时区，否则用设置时区。 */
export function resolveTimeZone(storedTimeZone: string | undefined, autoSync: boolean, deviceTimeZone?: string): string {
  if (autoSync) {
    const candidate = deviceTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (candidate && isValidTimeZone(candidate)) return candidate;
  }
  if (storedTimeZone && isValidTimeZone(storedTimeZone)) return storedTimeZone;
  return DEFAULT_TIME_ZONE;
}
