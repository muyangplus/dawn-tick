export const MAX_WEEKS = 30;

function checkWeek(week: number): void {
  if (!Number.isInteger(week) || week < 1 || week > MAX_WEEKS) {
    throw new RangeError(`周次超出 1..${MAX_WEEKS}: ${week}`);
  }
}

export function setWeek(mask: number, week: number): number {
  checkWeek(week);
  return (mask | (1 << (week - 1))) >>> 0;
}

export function clearWeek(mask: number, week: number): number {
  checkWeek(week);
  return (mask & ~(1 << (week - 1))) >>> 0;
}

export function hasWeek(mask: number, week: number): boolean {
  if (!Number.isInteger(week) || week < 1 || week > MAX_WEEKS) return false;
  return ((mask >>> (week - 1)) & 1) === 1;
}

export function weeksToMask(weeks: Iterable<number>): number {
  let mask = 0;
  for (const week of weeks) mask = setWeek(mask, week);
  return mask;
}

export function maskToWeeks(mask: number, totalWeeks: number = MAX_WEEKS): number[] {
  const out: number[] = [];
  const limit = Math.min(totalWeeks, MAX_WEEKS);
  for (let week = 1; week <= limit; week += 1) {
    if (hasWeek(mask, week)) out.push(week);
  }
  return out;
}

export function parityMask(totalWeeks: number, parity: 'odd' | 'even'): number {
  checkWeek(totalWeeks);
  let mask = 0;
  const first = parity === 'odd' ? 1 : 2;
  for (let week = first; week <= totalWeeks; week += 2) mask = setWeek(mask, week);
  return mask;
}

/** 周次集合转文本，例如 1-16 周 -> '1-16周'，双周 -> '2-16周(双)'。 */
export function describeWeeks(mask: number, totalWeeks: number = MAX_WEEKS): string {
  const weeks = maskToWeeks(mask, totalWeeks);
  if (weeks.length === 0) return '';
  const first = weeks[0] as number;
  const last = weeks[weeks.length - 1] as number;
  const isArithmetic = (step: number): boolean =>
    weeks.every((week, index) => week === first + index * step);

  if (weeks.length > 1 && isArithmetic(2)) {
    return `${first}-${last}周${first % 2 === 1 ? '(单)' : '(双)'}`;
  }
  if (isArithmetic(1)) return `${first}-${last}周`;

  const runs: Array<[number, number]> = [];
  let start = first;
  let prev = first;
  for (let i = 1; i < weeks.length; i += 1) {
    const week = weeks[i] as number;
    if (week === prev + 1) {
      prev = week;
      continue;
    }
    runs.push([start, prev]);
    start = week;
    prev = week;
  }
  runs.push([start, prev]);
  return `${runs.map(([from, to]) => (from === to ? String(from) : `${from}-${to}`)).join(',')}周`;
}
