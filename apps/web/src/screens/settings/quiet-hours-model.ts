import { WEEKDAY_LABELS, type QuietHours, type QuietRule } from '@dawn-tick/core';
import { quietHoursCopy } from '../../copy/settings-quiet-hours.ts';

/** 新增时段的默认值：午休。 */
export const NEW_QUIET_RULE: QuietRule = { days: [1, 2, 3, 4, 5], start: '12:00', end: '14:00' };

/** 勾掉 / 勾上一天；至少保留一天，最后一天勾不掉。 */
export function toggleQuietDay(rule: QuietRule, day: number): QuietRule {
  if (rule.days.includes(day)) {
    if (rule.days.length === 1) return rule;
    return { ...rule, days: rule.days.filter((item) => item !== day) };
  }
  return { ...rule, days: [...rule.days, day].sort((a, b) => a - b) };
}

export function replaceQuietRule(value: QuietHours, index: number, rule: QuietRule): QuietHours {
  return { ...value, rules: value.rules.map((item, at) => (at === index ? rule : item)) };
}

export function removeQuietRule(value: QuietHours, index: number): QuietHours {
  return { ...value, rules: value.rules.filter((_, at) => at !== index) };
}

/** 星期文案：每天 / 工作日 / 周末 / 周一、周三。 */
export function quietDaysText(days: readonly number[]): string {
  const key = [...days].sort((a, b) => a - b).join(',');
  if (key === '1,2,3,4,5,6,7') return quietHoursCopy.everyDay;
  if (key === '1,2,3,4,5') return quietHoursCopy.workdays;
  if (key === '6,7') return quietHoursCopy.weekend;
  return quietHoursCopy.daysJoin(days.map((day) => WEEKDAY_LABELS[day - 1] ?? ''));
}

/** 一条时段的文案：「工作日 22:00–次日 07:00」。 */
export function quietRuleText(rule: QuietRule): string {
  return quietHoursCopy.rule(quietDaysText(rule.days), rule.start, rule.end, rule.end <= rule.start);
}
