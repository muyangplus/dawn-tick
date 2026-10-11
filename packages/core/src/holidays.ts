/**
 * 内置法定节假日表。
 *
 * 数据来源：国务院办公厅关于 2026 年部分节假日安排的通知（国办发明电〔2025〕7号，2025-11-04）
 * https://www.gov.cn/zhengce/content/202511/content_7047090.htm
 * 只收录全国统一的放假与调休上班日；各校校历与地方安排仍需自行用「设为假日/非假日」覆盖。
 */

export interface HolidayYear {
  year: number;
  source: string;
  /** 放假日期，date -> 节日名 */
  holidays: Readonly<Record<string, string>>;
  /** 调休上班日期（周末上班），date -> 说明 */
  workdays: Readonly<Record<string, string>>;
}

function range(from: string, to: string, name: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let at = start; at <= end; at += 86_400_000) {
    out.push([new Date(at).toISOString().slice(0, 10), name]);
  }
  return out;
}

const YEAR_2026_SOURCE = '国务院办公厅关于 2026 年部分节假日安排的通知（国办发明电〔2025〕7号）';

export const HOLIDAY_CALENDAR: readonly HolidayYear[] = [
  {
    year: 2026,
    source: YEAR_2026_SOURCE,
    holidays: Object.fromEntries([
      ...range('2026-01-01', '2026-01-03', '元旦'),
      ...range('2026-02-15', '2026-02-23', '春节'),
      ...range('2026-04-04', '2026-04-06', '清明节'),
      ...range('2026-05-01', '2026-05-05', '劳动节'),
      ...range('2026-06-19', '2026-06-21', '端午节'),
      ...range('2026-09-25', '2026-09-27', '中秋节'),
      ...range('2026-10-01', '2026-10-07', '国庆节'),
    ]),
    workdays: {
      '2026-01-04': '元旦调休上班',
      '2026-02-14': '春节调休上班',
      '2026-02-28': '春节调休上班',
      '2026-05-09': '劳动节调休上班',
      '2026-09-20': '国庆节调休上班',
      '2026-10-10': '国庆节调休上班',
    },
  },
];

const HOLIDAY_BY_DATE = new Map<string, string>();
const WORKDAY_BY_DATE = new Map<string, string>();
for (const year of HOLIDAY_CALENDAR) {
  for (const [date, name] of Object.entries(year.holidays)) HOLIDAY_BY_DATE.set(date, name);
  for (const [date, name] of Object.entries(year.workdays)) WORKDAY_BY_DATE.set(date, name);
}

/** 内置放假表里的节日名；不是放假返回 null。 */
export function builtinHolidayName(date: string): string | null {
  return HOLIDAY_BY_DATE.get(date) ?? null;
}

/** 内置表里的调休上班说明；不是调休上班返回 null。 */
export function builtinWorkdayName(date: string): string | null {
  return WORKDAY_BY_DATE.get(date) ?? null;
}

export function builtinHolidays(): string[] {
  return [...HOLIDAY_BY_DATE.keys()].sort();
}

export function builtinWorkdays(): string[] {
  return [...WORKDAY_BY_DATE.keys()].sort();
}
