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
  if (periods.length > 30) throw new Error('课次不能超过 30 节');
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
 * 因此各时段的起点与节数不变，只有时段内的课次时间被重算。
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
    if (group.length > 20) throw new Error(`单个时段的课次不能超过 20 节：${section} 有 ${group.length} 节`);
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
