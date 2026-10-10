import { parseWeeksText } from './weeks-text.ts';

export interface ParsedSlot {
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  name: string;
  teacher: string | null;
  room: string | null;
  weeks: number[] | null;
  weeksText: string | null;
  raw: string;
}

export interface ParsedTimeSlot {
  periodNo: number;
  startTime: string;
  endTime: string;
}

export interface ParsedTimetable {
  slots: ParsedSlot[];
  timeSlots: ParsedTimeSlot[];
  warnings: string[];
}

const WEEKDAY_PATTERNS: Array<[RegExp, number]> = [
  [/周一|星期一|礼拜一|Monday|^Mon/i, 1],
  [/周二|星期二|礼拜二|Tuesday|^Tue/i, 2],
  [/周三|星期三|礼拜三|Wednesday|^Wed/i, 3],
  [/周四|星期四|礼拜四|Thursday|^Thu/i, 4],
  [/周五|星期五|礼拜五|Friday|^Fri/i, 5],
  [/周六|星期六|礼拜六|Saturday|^Sat/i, 6],
  [/周日|周天|星期日|星期天|礼拜日|礼拜天|Sunday|^Sun/i, 7],
];

export function matchWeekday(text: string): number | null {
  for (const [pattern, day] of WEEKDAY_PATTERNS) {
    if (pattern.test(text)) return day;
  }
  return null;
}

/** 解析 CSV 文本为二维数组，支持引号包裹与字段内换行。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

interface PeriodLabel {
  periodStart: number;
  periodEnd: number;
  timeSlot: ParsedTimeSlot | null;
}

/** 解析左侧节次标签，支持「第1节」「1」「1-2」「08:00-08:45」「1-2节(08:00-09:40)」。 */
export function parsePeriodLabel(text: string): PeriodLabel | null {
  const source = text.replace(/\s+/g, '');
  const timeRange = /(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/.exec(source);
  const timeSlot =
    timeRange === null
      ? null
      : {
          periodNo: 0,
          startTime: `${timeRange[1]?.padStart(2, '0')}:${timeRange[2]}`,
          endTime: `${timeRange[3]?.padStart(2, '0')}:${timeRange[4]}`,
        };

  const withoutTime = source.replace(/\(?\d{1,2}:\d{2}-\d{1,2}:\d{2}\)?/g, '');
  const numbers = withoutTime.match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length === 0) return null;
  const start = numbers[0] as number;
  const end = numbers.length > 1 ? (numbers[1] as number) : start;
  if (start < 1 || start > 40 || end < 1 || end > 40) return null;
  return {
    periodStart: Math.min(start, end),
    periodEnd: Math.max(start, end),
    timeSlot: timeSlot === null ? null : { ...timeSlot, periodNo: Math.min(start, end) },
  };
}

function splitCellLines(cell: string): string[] {
  return cell
    .split(/\r?\n|@|\/|;/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function looksLikeRoom(text: string): boolean {
  return /楼|教室|教|室|号|馆|场|区|栋|[A-Za-z]{1,4}-?\d{2,4}/.test(text);
}

/** 解析「星期 × 节次」二维矩阵，单元格内可含课程名、教师、地点与周次文本。 */
export function parseTimetableMatrix(
  rows: readonly (readonly string[])[],
  totalWeeks: number = 20,
): ParsedTimetable {
  const warnings: string[] = [];
  const slots: ParsedSlot[] = [];
  const timeSlots = new Map<number, ParsedTimeSlot>();

  let headerIndex = -1;
  let headerDays: Array<number | null> = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const days = row.map((cell) => matchWeekday(String(cell ?? '')));
    if (days.filter((day) => day !== null).length >= 3) {
      headerIndex = index;
      headerDays = days;
      break;
    }
  }
  if (headerIndex === -1) {
    warnings.push('未找到星期表头');
    return { slots, timeSlots: [], warnings };
  }

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (row.length === 0) continue;
    const label = String(row[0] ?? '').trim();
    const period = parsePeriodLabel(label);
    if (period === null) continue;
    if (period.timeSlot !== null && !timeSlots.has(period.timeSlot.periodNo)) {
      timeSlots.set(period.timeSlot.periodNo, period.timeSlot);
    }

    for (let column = 1; column < row.length; column += 1) {
      const raw = String(row[column] ?? '').trim();
      if (raw.length === 0) continue;
      const dayOfWeek = headerDays[column] ?? null;
      if (dayOfWeek === null) continue;

      const lines = splitCellLines(raw);
      const name = lines[0] ?? '';
      if (name.length === 0) continue;

      const weeksText = lines.find((line) => /周|单|双/.test(line)) ?? null;
      const others = lines
        .slice(1)
        .filter((line) => line !== weeksText)
        .filter((line) => !/^\d+(\.\d+)?$/.test(line));

      const room = others.find((line) => looksLikeRoom(line)) ?? null;
      const teacher = others.find((line) => line !== room) ?? null;

      slots.push({
        dayOfWeek,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        name,
        teacher,
        room,
        weeks: weeksText === null ? null : parseWeeksText(weeksText, totalWeeks),
        weeksText,
        raw,
      });
    }
  }

  if (slots.length === 0) warnings.push('未解析出课程');
  return { slots, timeSlots: [...timeSlots.values()].sort((a, b) => a.periodNo - b.periodNo), warnings };
}
