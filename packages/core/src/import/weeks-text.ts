import { MAX_WEEKS } from '../weeks.ts';

function normalize(text: string): string {
  return text
    .replace(/[\uff10-\uff19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[，、]/g, ',')
    .replace(/[～~—－]/g, '-')
    .replace(/\s+/g, '')
    .replace(/^第/, '');
}

/** 解析中文课表常见的周次文本，返回 1..totalWeeks 内的周次集合；无法解析返回 null。 */
export function parseWeeksText(text: string, totalWeeks: number = MAX_WEEKS): number[] | null {
  if (text.trim().length === 0) return null;
  const source = normalize(text);
  if (!/[0-9]/.test(source) && !/单|双/.test(source)) return null;

  const oddOnly = /(^|\()单周?(\)|$)/.test(source) || /单周/.test(source);
  const evenOnly = /(^|\()双周?(\)|$)/.test(source) || /双周/.test(source);

  const weeks = new Set<number>();
  const segments = source
    .replace(/\([^)]*\)/g, '')
    .replace(/周/g, '')
    .replace(/单|双/g, '')
    .split(',');
  for (const segment of segments) {
    if (segment.length === 0) continue;
    const range = /^(\d+)-(\d+)$/.exec(segment);
    if (range !== null) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let week = from; week <= to; week += 1) weeks.add(week);
      continue;
    }
    const single = /^(\d+)$/.exec(segment);
    if (single !== null) weeks.add(Number(single[1]));
  }

  if (weeks.size === 0) {
    if (oddOnly || evenOnly) {
      for (let week = oddOnly ? 1 : 2; week <= totalWeeks; week += 2) weeks.add(week);
    } else {
      return null;
    }
  }

  const filtered = [...weeks].filter((week) => week >= 1 && week <= totalWeeks).sort((a, b) => a - b);
  if (filtered.length === 0) return null;

  if (oddOnly) return filtered.filter((week) => week % 2 === 1);
  if (evenOnly) return filtered.filter((week) => week % 2 === 0);
  return filtered;
}

export function looksLikeWeeks(text: string): boolean {
  return /周|单|双/.test(text) && /[0-9]|单|双/.test(text);
}
