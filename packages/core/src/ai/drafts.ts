import type { ImportedSchedule } from '../import/apply.ts';

/**
 * AI 输出的格式与校验：模型只能给草稿，逐条校验后才进预览，非法条目丢弃并记一条说明。
 * 课表草稿直接是 `ImportedSchedule`，走导入的预览与写入；日程草稿由界面映射成条目。
 */

export type AiEventKind = 'todo' | 'homework' | 'exam';

export interface AiEventDraft {
  kind: AiEventKind;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM；没有具体时刻为 null */
  startTime: string | null;
  /** HH:MM；只有开始时刻时为 null */
  endTime: string | null;
  location: string | null;
  note: string | null;
}

export interface AiDraftResult<T> {
  items: T[];
  warnings: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EVENT_KINDS: readonly AiEventKind[] = ['todo', 'homework', 'exam'];

/** 取出模型输出里的 JSON：容忍 ``` 代码块和前后的说明文字。 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const starts = [body.indexOf('['), body.indexOf('{')].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error('AI 输出里没有 JSON');
  const start = Math.min(...starts);
  const close = body[start] === '[' ? ']' : '}';
  const end = body.lastIndexOf(close);
  if (end <= start) throw new Error('AI 输出的 JSON 不完整');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error('AI 输出的 JSON 无法解析');
  }
}

/** 顶层可以是数组，也可以是 `{ items: [...] }`。 */
function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') {
    const items = (value as { items?: unknown }).items;
    if (Array.isArray(items)) return items;
  }
  throw new Error('AI 输出不是条目列表');
}

function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function intOf(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) ? number : null;
}

function validDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 周次：数组 `[1,2,3]`，或文本 `1-16`、`1-8,10`；超出学期的周次去掉。 */
function weeksOf(value: unknown, totalWeeks: number): number[] | null {
  const result = new Set<number>();
  const add = (week: number): void => {
    if (Number.isInteger(week) && week >= 1 && week <= totalWeeks) result.add(week);
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      const week = intOf(item);
      if (week !== null) add(week);
    }
  } else if (typeof value === 'string') {
    for (const part of value.split(/[,，、\s]+/)) {
      const range = /^(\d+)\s*[-–~～]\s*(\d+)$/.exec(part);
      if (range !== null) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        for (let week = Math.min(from, to); week <= Math.max(from, to); week += 1) add(week);
      } else if (/^\d+$/.test(part)) add(Number(part));
    }
  } else if (value === undefined || value === null) {
    return null;
  }
  return [...result].sort((left, right) => left - right);
}

export interface ScheduleDraftContext {
  totalWeeks: number;
  /** 当前作息的节数；超出的节次判为非法 */
  periodCount: number;
}

/** 校验课表草稿；周次缺省按全学期。 */
export function parseScheduleDrafts(output: string, context: ScheduleDraftContext): AiDraftResult<ImportedSchedule> {
  const list = listOf(extractJson(output));
  const items: ImportedSchedule[] = [];
  const warnings: string[] = [];
  const maxPeriod = Math.max(1, context.periodCount);
  list.forEach((raw, index) => {
    const label = `第 ${index + 1} 条`;
    if (raw === null || typeof raw !== 'object') {
      warnings.push(`${label}不是对象，已跳过`);
      return;
    }
    const row = raw as Record<string, unknown>;
    const courseName = textOf(row['courseName']);
    const dayOfWeek = intOf(row['dayOfWeek']);
    const periodStart = intOf(row['periodStart']);
    const periodEnd = intOf(row['periodEnd']) ?? periodStart;
    if (courseName === null) {
      warnings.push(`${label}缺少课程名，已跳过`);
      return;
    }
    if (dayOfWeek === null || dayOfWeek < 1 || dayOfWeek > 7) {
      warnings.push(`「${courseName}」星期不在 1–7，已跳过`);
      return;
    }
    if (periodStart === null || periodEnd === null || periodStart < 1 || periodEnd < periodStart || periodEnd > maxPeriod) {
      warnings.push(`「${courseName}」节次不在 1–${maxPeriod}，已跳过`);
      return;
    }
    const weeks = weeksOf(row['weeks'], context.totalWeeks);
    const allWeeks = Array.from({ length: context.totalWeeks }, (_, week) => week + 1);
    if (weeks !== null && weeks.length === 0) {
      warnings.push(`「${courseName}」周次不在本学期内，已跳过`);
      return;
    }
    items.push({
      courseName,
      dayOfWeek,
      periodStart,
      periodEnd,
      weeks: weeks ?? allWeeks,
      room: textOf(row['room']),
      teacher: textOf(row['teacher']),
    });
  });
  return { items, warnings };
}

/** 校验日程草稿；类型认不出按普通日程。 */
export function parseEventDrafts(output: string): AiDraftResult<AiEventDraft> {
  const list = listOf(extractJson(output));
  const items: AiEventDraft[] = [];
  const warnings: string[] = [];
  list.forEach((raw, index) => {
    const label = `第 ${index + 1} 条`;
    if (raw === null || typeof raw !== 'object') {
      warnings.push(`${label}不是对象，已跳过`);
      return;
    }
    const row = raw as Record<string, unknown>;
    const title = textOf(row['title']);
    if (title === null) {
      warnings.push(`${label}缺少标题，已跳过`);
      return;
    }
    const date = textOf(row['date']);
    if (date === null || !validDate(date)) {
      warnings.push(`「${title}」日期不是 YYYY-MM-DD，已跳过`);
      return;
    }
    const kindText = textOf(row['kind']);
    const kind = EVENT_KINDS.includes(kindText as AiEventKind) ? (kindText as AiEventKind) : 'todo';
    let startTime = textOf(row['startTime']);
    let endTime = textOf(row['endTime']);
    if (startTime !== null && !TIME_RE.test(startTime)) {
      warnings.push(`「${title}」开始时刻无法识别，按无时刻处理`);
      startTime = null;
    }
    if (endTime !== null && (startTime === null || !TIME_RE.test(endTime) || endTime <= startTime)) {
      warnings.push(`「${title}」结束时刻无法识别，已去掉`);
      endTime = null;
    }
    items.push({ kind, title, date, startTime, endTime, location: textOf(row['location']), note: textOf(row['note']) });
  });
  return { items, warnings };
}
