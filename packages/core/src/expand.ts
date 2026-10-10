import { dateRange, dateWallClockToEpoch, dayOfWeek, weekOfDate } from './time.ts';
import { hasWeek } from './weeks.ts';
import type { EventAction, EventType, HolidaySource } from './types.ts';

export interface ExpandSemester {
  id: string;
  start_date: string;
  total_weeks: number;
  time_zone: string;
}

export interface ExpandCourse {
  id: string;
  name: string;
  short_name: string | null;
  location: string | null;
  color: string;
}

export interface ExpandSchedule {
  id: string;
  course_id: string;
  day_of_week: number;
  period_start: number;
  period_end: number;
  weeks_mask: number;
  room: string | null;
}

export interface ExpandTimeSlot {
  period_no: number;
  start_time: string;
  end_time: string;
}

export interface ExpandDayKind {
  on_date: string;
  type: Extract<EventType, 'holiday' | 'makeup' | 'workday'>;
  as_day_of_week: number | null;
  source: HolidaySource | null;
}

export interface ExpandReschedule {
  ref_schedule_id: string;
  on_date: string;
  action: EventAction;
  new_date: string | null;
  new_period_start: number | null;
  new_period_end: number | null;
  new_room: string | null;
}

export interface Occurrence {
  date: string;
  semesterId: string;
  scheduleId: string;
  courseId: string;
  courseName: string;
  shortName: string | null;
  color: string;
  periodStart: number;
  periodEnd: number;
  startAt: number;
  endAt: number;
  room: string | null;
  cancelled: boolean;
}

export interface ExpandInput {
  semester: ExpandSemester;
  courses: readonly ExpandCourse[];
  schedules: readonly ExpandSchedule[];
  timeSlots: readonly ExpandTimeSlot[];
  dayKinds?: readonly ExpandDayKind[];
  reschedules?: readonly ExpandReschedule[];
  from: string;
  to: string;
  includeCancelled?: boolean;
}

const SOURCE_RANK: Record<HolidaySource, number> = {
  manual: 1,
  from_school: 2,
  builtin: 3,
};

/** 同一日期多条判定时按来源优先级取一条。 */
export function resolveDayKind(kinds: readonly ExpandDayKind[]): Map<string, ExpandDayKind> {
  const out = new Map<string, ExpandDayKind>();
  for (const kind of kinds) {
    const existing = out.get(kind.on_date);
    if (existing === undefined) {
      out.set(kind.on_date, kind);
      continue;
    }
    const rank = kind.source === null ? 4 : SOURCE_RANK[kind.source];
    const existingRank = existing.source === null ? 4 : SOURCE_RANK[existing.source];
    if (rank < existingRank) out.set(kind.on_date, kind);
  }
  return out;
}

export function expand(input: ExpandInput): Occurrence[] {
  const { semester, from, to } = input;
  const includeCancelled = input.includeCancelled ?? false;

  const courseById = new Map(input.courses.map((course) => [course.id, course]));
  const slotByPeriod = new Map(input.timeSlots.map((slot) => [slot.period_no, slot]));
  const dayKinds = resolveDayKind(input.dayKinds ?? []);
  const rescheduleByKey = new Map(
    (input.reschedules ?? []).map((item) => [`${item.ref_schedule_id}|${item.on_date}`, item]),
  );

  const occurrences: Occurrence[] = [];

  for (const date of dateRange(from, to)) {
    const kind = dayKinds.get(date);
    if (kind?.type === 'holiday') continue;

    const effectiveDayOfWeek =
      kind?.type === 'makeup' && kind.as_day_of_week !== null
        ? kind.as_day_of_week
        : dayOfWeek(date);

    const week = weekOfDate(date, semester.start_date);
    if (week < 1 || week > semester.total_weeks) continue;

    for (const schedule of input.schedules) {
      if (schedule.day_of_week !== effectiveDayOfWeek) continue;
      if (!hasWeek(schedule.weeks_mask, week)) continue;

      const course = courseById.get(schedule.course_id);
      if (course === undefined) continue;

      const override = rescheduleByKey.get(`${schedule.id}|${date}`);
      const cancelled = override?.action === 'cancel';
      if (cancelled && !includeCancelled) continue;

      const targetDate =
        override?.action === 'move' && override.new_date !== null ? override.new_date : date;
      const periodStart = override?.new_period_start ?? schedule.period_start;
      const periodEnd = override?.new_period_end ?? schedule.period_end;

      const startSlot = slotByPeriod.get(periodStart);
      const endSlot = slotByPeriod.get(periodEnd);
      if (startSlot === undefined || endSlot === undefined) continue;

      const room = override?.new_room ?? schedule.room ?? course.location;

      occurrences.push({
        date: targetDate,
        semesterId: semester.id,
        scheduleId: schedule.id,
        courseId: course.id,
        courseName: course.name,
        shortName: course.short_name,
        color: course.color,
        periodStart,
        periodEnd,
        startAt: dateWallClockToEpoch(targetDate, startSlot.start_time, semester.time_zone),
        endAt: dateWallClockToEpoch(targetDate, endSlot.end_time, semester.time_zone),
        room,
        cancelled,
      });
    }
  }

  occurrences.sort((left, right) =>
    left.startAt === right.startAt ? left.periodStart - right.periodStart : left.startAt - right.startAt,
  );
  return occurrences;
}

/** 现在之后最近的一次课。 */
export function nextOccurrence(occurrences: readonly Occurrence[], nowMs: number): Occurrence | undefined {
  return occurrences.find((item) => !item.cancelled && item.startAt > nowMs);
}
