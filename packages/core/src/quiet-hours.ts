import { addDays, dateWallClockToEpoch, dayOfWeek, formatDate } from './time.ts';

/** 勿扰时段内的提醒：顺延到时段结束，或直接跳过。 */
export type QuietMode = 'defer' | 'skip';
export const QUIET_MODES: readonly QuietMode[] = ['defer', 'skip'];

/**
 * 一条勿扰规则：`days` 是时段开始那天的星期（1=周一 … 7=周日）。
 * `end` 不晚于 `start` 时跨午夜，结束在次日；两者相等表示从 `start` 起整整 24 小时。
 */
export interface QuietRule {
  days: number[];
  start: string;
  end: string;
}

export interface QuietHours {
  enabled: boolean;
  mode: QuietMode;
  rules: QuietRule[];
}

export const QUIET_RULE_LIMIT = 8;

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  mode: 'defer',
  rules: [{ days: [1, 2, 3, 4, 5, 6, 7], start: '23:00', end: '07:00' }],
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeDays(days: unknown): number[] | null {
  if (!Array.isArray(days)) return null;
  const set = new Set<number>();
  for (const day of days) {
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 7) return null;
    set.add(day);
  }
  return set.size === 0 ? null : [...set].sort((a, b) => a - b);
}

function normalizeRule(raw: unknown): QuietRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { days, start, end } = raw as Record<string, unknown>;
  const cleanDays = normalizeDays(days);
  if (cleanDays === null || typeof start !== 'string' || typeof end !== 'string') return null;
  if (!CLOCK.test(start) || !CLOCK.test(end)) return null;
  return { days: cleanDays, start, end };
}

/** 校验并规整；不合法返回错误文案。 */
export function checkQuietHours(value: QuietHours): string | null {
  if (!QUIET_MODES.includes(value.mode)) return '勿扰时段的处理方式只能是顺延或跳过';
  if (value.rules.length > QUIET_RULE_LIMIT) return `勿扰时段最多 ${QUIET_RULE_LIMIT} 条`;
  for (const rule of value.rules) {
    if (normalizeRule(rule) === null) return '勿扰时段需要至少选一天，时间格式为 HH:MM';
  }
  return null;
}

/** 从存储字符串读回；缺失或损坏时用默认值，单条坏规则丢掉。 */
export function parseQuietHours(raw: string | undefined, fallback: QuietHours = DEFAULT_QUIET_HOURS): QuietHours {
  if (raw === undefined || raw === '') return fallback;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof value !== 'object' || value === null) return fallback;
  const { enabled, mode, rules } = value as Record<string, unknown>;
  return {
    enabled: enabled === true,
    mode: QUIET_MODES.includes(mode as QuietMode) ? (mode as QuietMode) : fallback.mode,
    rules: Array.isArray(rules)
      ? rules
          .map(normalizeRule)
          .filter((rule): rule is QuietRule => rule !== null)
          .slice(0, QUIET_RULE_LIMIT)
      : fallback.rules,
  };
}

export function encodeQuietHours(value: QuietHours): string {
  return JSON.stringify({
    enabled: value.enabled,
    mode: value.mode,
    rules: value.rules.map((rule) => ({ days: [...rule.days].sort((a, b) => a - b), start: rule.start, end: rule.end })),
  });
}

/** 某条规则在 `date` 当天开始的那一段，epoch 毫秒，左闭右开。 */
function windowOn(rule: QuietRule, date: string, timeZone: string): { start: number; end: number } {
  const start = dateWallClockToEpoch(date, rule.start, timeZone);
  const end = dateWallClockToEpoch(rule.end > rule.start ? date : addDays(date, 1), rule.end, timeZone);
  return { start, end };
}

/**
 * `at` 落在哪段勿扰里，返回该段结束时刻；不在勿扰里返回 null。
 * 多段重叠时取最晚的结束；墙钟按 `timeZone` 解释，夏令时切换日按当天实际偏移算。
 */
export function quietWindowEnd(at: number, quiet: QuietHours, timeZone: string): number | null {
  if (!quiet.enabled) return null;
  const today = formatDate(at, timeZone);
  let end: number | null = null;
  // 跨午夜的时段从前一天开始；24 小时时段最多覆盖到次日同一时刻
  for (const date of [addDays(today, -1), today]) {
    const weekday = dayOfWeek(date);
    for (const rule of quiet.rules) {
      if (!rule.days.includes(weekday)) continue;
      const window = windowOn(rule, date, timeZone);
      if (at >= window.start && at < window.end && (end === null || window.end > end)) end = window.end;
    }
  }
  return end;
}

/**
 * 勿扰判定：返回实际提醒时刻，跳过时返回 null。
 * 顺延到时段结束；结束时刻又落进下一段就继续顺延；顺延后已到开始时刻（课已开始）的不再提醒。
 */
export function applyQuietHours(
  triggerAt: number,
  startsAt: number,
  quiet: QuietHours,
  timeZone: string,
): number | null {
  let at = triggerAt;
  // 规则最多 8 条、每条一天一段，连续顺延不会超过两周的段数
  for (let hop = 0; hop < 7 * QUIET_RULE_LIMIT * 2; hop += 1) {
    const end = quietWindowEnd(at, quiet, timeZone);
    if (end === null) return at;
    if (quiet.mode === 'skip') return null;
    at = end;
    if (at >= startsAt) return null;
  }
  return null;
}
