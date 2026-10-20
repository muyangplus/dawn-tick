import type { PeriodSection } from './types.ts';

export interface GeneratedPeriod {
  periodNo: number;
  startTime: string;
  endTime: string;
  section: PeriodSection;
}

export interface TimeBlockInput {
  section: PeriodSection;
  startTime: string;
  count: number;
}

export interface TimetableInput {
  /** 固定上课时长（分钟） */
  durationMinutes: number;
  /** 同一时段内相邻两节的间隔（分钟） */
  breakMinutes: number;
  blocks: readonly TimeBlockInput[];
}

export function parseClock(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (match === null) throw new Error(`时间格式应为 HH:MM：${time}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`时间超出范围：${time}`);
  return hours * 60 + minutes;
}

export function formatClock(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function addMinutes(time: string, minutes: number): string {
  return formatClock(parseClock(time) + minutes);
}

/** 节次表的槽位：只取判定所需的三列，不依赖具体的行类型。 */
export interface PeriodSlot {
  period_no: number;
  start_time: string;
  end_time: string;
}

/** 一组节次范围（含首含尾）。 */
export interface PeriodRange {
  periodStart: number;
  periodEnd: number;
}

/** 容错的 HH:MM 解析：解析不出返回 null，供渲染路径不抛错地换算。 */
function clockMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * 两个含首含尾的节次区间是否相交，入参顺序无关。
 * 单节传 start === end；相邻不算重叠（1–2 与 3–4 不相交）。
 */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLow = Math.min(aStart, aEnd);
  const aHigh = Math.max(aStart, aEnd);
  const bLow = Math.min(bStart, bEnd);
  const bHigh = Math.max(bStart, bEnd);
  return aLow <= bHigh && bLow <= aHigh;
}

/** 两组周次是否有交集；任一侧为空集时不相交。 */
export function weeksIntersect(a: readonly number[], b: readonly number[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const [probe, pool] = a.length <= b.length ? [a, b] : [b, a];
  const set = new Set(pool);
  return probe.some((week) => set.has(week));
}

/** 开始时间离 target 最近的槽位（并列取靠前的一节）。 */
function nearestSlot(slots: readonly PeriodSlot[], target: number): PeriodSlot | null {
  let best: PeriodSlot | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const start = clockMinutes(slot.start_time);
    if (start === null) continue;
    const distance = Math.abs(start - target);
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * 墙钟时间落到重叠的节次上（含起点不含终点）；没有重叠时贴到开始时间最近的一节。
 * 时钟缺失、为空或解析不出时返回 null。
 */
export function periodAtClock(slots: readonly PeriodSlot[], clock: string | null): number | null {
  if (clock === null || clock === '' || slots.length === 0) return null;
  const target = clockMinutes(clock);
  if (target === null) return null;
  for (const slot of slots) {
    const start = clockMinutes(slot.start_time);
    const end = clockMinutes(slot.end_time);
    if (start === null || end === null) continue;
    if (start <= target && target < end) return slot.period_no;
  }
  return nearestSlot(slots, target)?.period_no ?? null;
}

/**
 * 钟点范围覆盖到的节次范围；没有任何重叠时贴到开始时间最近的一节。
 * 与 `periodAtClock` 分开保留：一个返回单节，一个返回范围，语义不同。
 */
export function periodsForClockRange(
  slots: readonly PeriodSlot[],
  start: string,
  end: string,
): PeriodRange | null {
  if (slots.length === 0) return null;
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null) return null;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const slot of slots) {
    const slotStart = clockMinutes(slot.start_time);
    const slotEnd = clockMinutes(slot.end_time);
    if (slotStart === null || slotEnd === null) continue;
    if (slotStart < to && slotEnd > from) {
      low = Math.min(low, slot.period_no);
      high = Math.max(high, slot.period_no);
    }
  }
  if (low <= high) return { periodStart: low, periodEnd: high };
  const nearest = nearestSlot(slots, from);
  return nearest === null ? null : { periodStart: nearest.period_no, periodEnd: nearest.period_no };
}

/**
 * 按固定时长与时段起点生成课次：时段内相邻两节间隔为 breakMinutes，
 * 时段之间由各自的起点决定（例如上午 08:00、下午 14:00、晚上 19:00）。
 */
export function generatePeriods(input: TimetableInput): GeneratedPeriod[] {
  const duration = Math.round(input.durationMinutes);
  const gap = Math.round(input.breakMinutes);
  if (!Number.isFinite(duration) || duration < 10 || duration > 240) {
    throw new Error('上课时长需在 10 到 240 分钟之间');
  }
  if (!Number.isFinite(gap) || gap < 0 || gap > 120) {
    throw new Error('课间间隔需在 0 到 120 分钟之间');
  }

  const periods: GeneratedPeriod[] = [];
  let periodNo = 1;
  for (const block of input.blocks) {
    const count = Math.max(0, Math.min(20, Math.round(block.count)));
    if (count === 0) continue;
    let cursor = parseClock(block.startTime);
    for (let index = 0; index < count; index += 1) {
      periods.push({
        periodNo,
        startTime: formatClock(cursor),
        endTime: formatClock(cursor + duration),
        section: block.section,
      });
      periodNo += 1;
      cursor += duration + gap;
    }
  }
  if (periods.length === 0) throw new Error('至少需要一个时段且节数大于零');
  if (periods.length > 30) throw new Error('节次不能超过 30 节');
  return periods;
}

export interface RegenerateInput {
  /** 固定上课时长（分钟） */
  durationMinutes: number;
  /** 同一时段内相邻两节的间隔（分钟） */
  breakMinutes: number;
}

/**
 * 按新的时长与课间重排指定时段，未列入 sections 的时段原样保留。
 * 每个待重排时段都用它在 existing 里的第一节开始时间作为起点、现有的节数作为节数，
 * 各时段的起点与节数不变，只有时段内的课次时间被重算。
 * 返回与 existing 等长、顺序一致的课次，periodNo 沿用原值。
 */
export function regenerateSections(
  existing: readonly GeneratedPeriod[],
  sections: readonly PeriodSection[],
  input: RegenerateInput,
): GeneratedPeriod[] {
  const wanted = new Set(sections);
  const groups = new Map<PeriodSection, GeneratedPeriod[]>();
  for (const period of existing) {
    const group = groups.get(period.section);
    if (group === undefined) groups.set(period.section, [period]);
    else group.push(period);
  }

  const regenerated = new Map<number, GeneratedPeriod>();
  for (const [section, group] of groups) {
    if (!wanted.has(section)) continue;
    const first = group[0];
    if (first === undefined) continue;
    if (group.length > 20) throw new Error(`单个时段的节次不能超过 20 节：${section} 有 ${group.length} 节`);
    const fresh = generatePeriods({
      durationMinutes: input.durationMinutes,
      breakMinutes: input.breakMinutes,
      blocks: [{ section, startTime: first.startTime, count: group.length }],
    });
    group.forEach((period, index) => {
      const next = fresh[index];
      if (next === undefined) return;
      regenerated.set(period.periodNo, { ...period, startTime: next.startTime, endTime: next.endTime });
    });
  }

  return existing.map((period) => regenerated.get(period.periodNo) ?? period);
}

/** 锚点顺延重排的输入课次：只有 start 会被用来定位锚点，end 会被整段重算。 */
export interface ReflowPeriodInput {
  periodNo: number;
  start: string;
  end: string;
}

export interface ReflowOptions {
  /** 锚点节次：这一节保持它当前的 start，并从这里开始往后顺延 */
  anchorPeriodNo: number;
  /** 每节时长（分钟），10–240 */
  durationMinutes: number;
  /** 顺延时的相邻两节间隔（分钟），0–120 */
  breakMinutes: number;
}

/**
 * 锚点顺延重排：锚点那一节保持它当前的 start、end = start + duration；
 * 之后按 periodNo 递增，每一节 start = 前一节 end + breakMinutes、end = start + duration，
 * 一路顺延到底（不因 section 变化而重置，也不回填锚点之前）。锚点之前的节次原样复制。
 *
 * 例：锚点第 1 节 08:00、duration 45、break 10 →
 * 1: 08:00-08:45、2: 08:55-09:40、3: 09:50-10:35 …
 * 若把第 3 节的 start 改成 09:55 再以它为锚点 →
 * 3: 09:55-10:40、4: 10:50-11:35 …（与苏科大实际作息一致）。
 *
 * 结果按 periodNo 递增返回；输入顺序不影响结果。
 */
export function reflowPeriods(
  periods: readonly ReflowPeriodInput[],
  options: ReflowOptions,
): ReflowPeriodInput[] {
  const duration = Math.round(options.durationMinutes);
  const gap = Math.round(options.breakMinutes);
  if (!Number.isFinite(duration) || duration < 10 || duration > 240) {
    throw new Error('上课时长需在 10 到 240 分钟之间');
  }
  if (!Number.isFinite(gap) || gap < 0 || gap > 120) {
    throw new Error('课间间隔需在 0 到 120 分钟之间');
  }
  if (periods.length === 0) throw new Error('节次列表不能为空');

  const sorted = [...periods].sort((left, right) => left.periodNo - right.periodNo);
  for (const [index, period] of sorted.entries()) {
    if (!Number.isInteger(period.periodNo) || period.periodNo < 1) {
      throw new Error(`节次编号应为正整数：${String(period.periodNo)}`);
    }
    const previous = sorted[index - 1];
    if (previous !== undefined && previous.periodNo === period.periodNo) {
      throw new Error(`节次编号重复：${period.periodNo}`);
    }
  }

  const anchorIndex = sorted.findIndex((period) => period.periodNo === options.anchorPeriodNo);
  if (anchorIndex < 0) throw new Error(`锚点节次不在列表中：第 ${options.anchorPeriodNo} 节`);
  const anchor = sorted[anchorIndex] as ReflowPeriodInput;

  const result: ReflowPeriodInput[] = sorted
    .slice(0, anchorIndex)
    .map((period) => ({ periodNo: period.periodNo, start: period.start, end: period.end }));

  let cursor = parseClock(anchor.start);
  for (const period of sorted.slice(anchorIndex)) {
    result.push({ periodNo: period.periodNo, start: formatClock(cursor), end: formatClock(cursor + duration) });
    cursor += duration + gap;
  }
  return result;
}

/** 在最后一节之后追加一节，用于「自动添加课次」。 */
export function nextPeriod(
  periods: readonly GeneratedPeriod[],
  durationMinutes: number,
  breakMinutes: number,
): GeneratedPeriod {
  const duration = Math.round(durationMinutes);
  const last = periods.at(-1);
  if (last === undefined) {
    return { periodNo: 1, startTime: '08:00', endTime: addMinutes('08:00', duration), section: 'am' };
  }
  const start = addMinutes(last.endTime, Math.max(0, Math.round(breakMinutes)));
  return { periodNo: last.periodNo + 1, startTime: start, endTime: addMinutes(start, duration), section: sectionOf(start) };
}

export function sectionOf(time: string): PeriodSection {
  const minutes = parseClock(time);
  if (minutes < 12 * 60) return 'am';
  if (minutes < 18 * 60) return 'pm';
  return 'night';
}
