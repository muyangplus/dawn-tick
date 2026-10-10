import { hasWeek } from './weeks.ts';
import type { Storage } from './storage.ts';
import { expand, type ExpandCourse, type ExpandDayKind, type ExpandInput, type ExpandReschedule, type ExpandSchedule, type ExpandTimeSlot, type Occurrence } from './expand.ts';
import type {
  CourseRow,
  CourseScheduleRow,
  DayKindRow,
  EventRow,
  HolidaySource,
  ReminderRow,
  SemesterRow,
  TimeSlotRow,
  WeekViewRow,
} from './types.ts';

const SOURCE_RANK: Record<HolidaySource, number> = { manual: 1, from_school: 2, builtin: 3 };

function alive<T extends { deleted_at: number | null }>(row: T): boolean {
  return row.deleted_at === null;
}

export async function listSemesters(storage: Storage, userId: string): Promise<SemesterRow[]> {
  const rows = await storage.collection<SemesterRow>('semesters').getAll();
  return rows.filter((row) => row.user_id === userId && alive(row));
}

export async function activeSemester(storage: Storage, userId: string): Promise<SemesterRow | undefined> {
  const rows = await listSemesters(storage, userId);
  return rows.find((row) => row.is_active === 1);
}

export async function loadSemester(storage: Storage, semesterId: string): Promise<SemesterRow | undefined> {
  const row = await storage.collection<SemesterRow>('semesters').get(semesterId);
  return row === undefined || row.deleted_at !== null ? undefined : row;
}

export async function listTimeSlots(storage: Storage, semesterId: string): Promise<TimeSlotRow[]> {
  const rows = await storage.collection<TimeSlotRow>('time_slots').getAll();
  return rows
    .filter((row) => row.semester_id === semesterId && alive(row))
    .sort((left, right) => left.period_no - right.period_no);
}

export async function listCourses(storage: Storage, semesterId: string): Promise<CourseRow[]> {
  const rows = await storage.collection<CourseRow>('courses').getAll();
  return rows.filter((row) => row.semester_id === semesterId && alive(row));
}

export async function listSchedules(storage: Storage, semesterId: string): Promise<CourseScheduleRow[]> {
  const courses = await listCourses(storage, semesterId);
  const courseIds = new Set(courses.map((course) => course.id));
  const rows = await storage.collection<CourseScheduleRow>('course_schedules').getAll();
  return rows.filter((row) => courseIds.has(row.course_id) && alive(row));
}

/** 第 N 周某天的课。判定逻辑与 SQL 版本一致：位图取位。 */
export async function weekView(
  storage: Storage,
  semesterId: string,
  dayOfWeek: number,
  week: number,
): Promise<WeekViewRow[]> {
  const courses = new Map((await listCourses(storage, semesterId)).map((course) => [course.id, course]));
  const schedules = await listSchedules(storage, semesterId);
  return schedules
    .filter((schedule) => schedule.day_of_week === dayOfWeek && hasWeek(schedule.weeks_mask, week))
    .map((schedule) => {
      const course = courses.get(schedule.course_id);
      return {
        schedule_id: schedule.id,
        course_id: schedule.course_id,
        name: course?.name ?? '',
        short_name: course?.short_name ?? null,
        color: course?.color ?? '#4F8DFD',
        period_start: schedule.period_start,
        period_end: schedule.period_end,
        room: schedule.room ?? course?.location ?? null,
      };
    })
    .sort((left, right) => left.period_start - right.period_start);
}

export type DayKindEvent = DayKindRow & {
  id: string;
  semester_id: string | null;
  on_date: string;
  deleted_at: number | null;
};

/** 某天的放假/调休判定，按来源优先级取一条。 */
export async function dayKindForDate(
  storage: Storage,
  semesterId: string,
  date: string,
): Promise<DayKindEvent | undefined> {
  const rows = await storage.collection<DayKindEvent>('events').getAll();
  return rows
    .filter(
      (row) =>
        row.deleted_at === null &&
        row.semester_id === semesterId &&
        row.on_date === date &&
        (row.type === 'holiday' || row.type === 'makeup' || row.type === 'workday'),
    )
    .sort((left, right) => rank(left.source) - rank(right.source))[0];
}

function rank(source: HolidaySource | null): number {
  return source === null ? 4 : SOURCE_RANK[source];
}

/** 按来源优先级写入某天的放假/调休判定。 */
export async function applyDayKind(
  storage: Storage,
  input: {
    id: string;
    userId: string;
    semesterId: string;
    onDate: string;
    type: 'holiday' | 'makeup' | 'workday';
    source: HolidaySource;
    title: string;
    asDayOfWeek?: number | null;
  },
): Promise<'insert' | 'overwrite' | 'skip'> {
  const events = storage.collection<Record<string, unknown>>('events');
  const existing = await dayKindForDate(storage, input.semesterId, input.onDate);
  const now = Date.now();
  if (existing === undefined) {
    await events.put({
      id: input.id,
      user_id: input.userId,
      semester_id: input.semesterId,
      parent_id: null,
      type: input.type,
      title: input.title,
      on_date: input.onDate,
      start_at: null,
      end_at: null,
      all_day: 0,
      location: null,
      note: null,
      done: 0,
      priority: null,
      due_at: null,
      subject: null,
      seat_no: null,
      ref_schedule_id: null,
      action: null,
      new_date: null,
      new_period_start: null,
      new_period_end: null,
      new_room: null,
      as_day_of_week: input.asDayOfWeek ?? null,
      source: input.source,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      rev: 0,
      dirty: 1,
    });
    return 'insert';
  }

  const existingSource = existing.source ?? null;
  if (rank(input.source) < rank(existingSource)) {
    const full = await events.get(existing.id);
    if (full !== undefined) {
      await events.put({ ...full, source: input.source, title: input.title, updated_at: now, rev: Number(full.rev ?? 0) + 1, dirty: 1 });
    }
    return 'overwrite';
  }
  return 'skip';
}

export async function loadExpandInput(
  storage: Storage,
  semesterId: string,
  from: string,
  to: string,
): Promise<ExpandInput | undefined> {
  const semester = (await storage.collection<SemesterRow>('semesters').get(semesterId));
  if (semester === undefined || semester.deleted_at !== null) return undefined;

  const courses: ExpandCourse[] = (await listCourses(storage, semesterId)).map((course) => ({
    id: course.id,
    name: course.name,
    short_name: course.short_name,
    location: course.location,
    color: course.color,
  }));

  const schedules: ExpandSchedule[] = (await listSchedules(storage, semesterId)).map((schedule) => ({
    id: schedule.id,
    course_id: schedule.course_id,
    day_of_week: schedule.day_of_week,
    period_start: schedule.period_start,
    period_end: schedule.period_end,
    weeks_mask: schedule.weeks_mask,
    room: schedule.room,
  }));

  const timeSlots: ExpandTimeSlot[] = (await listTimeSlots(storage, semesterId)).map((slot) => ({
    period_no: slot.period_no,
    start_time: slot.start_time,
    end_time: slot.end_time,
  }));

  const courseIds = new Set(courses.map((course) => course.id));
  const scheduleIds = new Set(schedules.map((schedule) => schedule.id));
  const events = (await storage.collection<Record<string, unknown>>('events').getAll()).filter(
    (row) => row['deleted_at'] === null && row['semester_id'] === semesterId,
  );

  const dayKinds: ExpandDayKind[] = events
    .filter((row) => {
      const date = row['on_date'];
      return (
        typeof date === 'string' &&
        date >= from &&
        date <= to &&
        (row['type'] === 'holiday' || row['type'] === 'makeup' || row['type'] === 'workday')
      );
    })
    .map((row) => ({
      on_date: row['on_date'] as string,
      type: row['type'] as ExpandDayKind['type'],
      as_day_of_week: (row['as_day_of_week'] as number | null) ?? null,
      source: (row['source'] as ExpandDayKind['source']) ?? null,
    }));

  const reschedules: ExpandReschedule[] = events
    .filter((row) => {
      const date = row['on_date'];
      return (
        row['type'] === 'reschedule' &&
        typeof date === 'string' &&
        date >= from &&
        date <= to &&
        typeof row['ref_schedule_id'] === 'string' &&
        scheduleIds.has(row['ref_schedule_id'])
      );
    })
    .map((row) => ({
      ref_schedule_id: row['ref_schedule_id'] as string,
      on_date: row['on_date'] as string,
      action: row['action'] as ExpandReschedule['action'],
      new_date: (row['new_date'] as string | null) ?? null,
      new_period_start: (row['new_period_start'] as number | null) ?? null,
      new_period_end: (row['new_period_end'] as number | null) ?? null,
      new_room: (row['new_room'] as string | null) ?? null,
    }));

  return {
    semester: {
      id: semester.id,
      start_date: semester.start_date,
      total_weeks: semester.total_weeks,
      time_zone: semester.time_zone,
    },
    courses,
    schedules,
    timeSlots,
    dayKinds,
    reschedules,
    from,
    to,
  };
}

export async function listRemindersFor(storage: Storage, targetType: string, targetId: string) {
  const rows = await storage.collection<Record<string, unknown>>('reminders').getAll();
  return rows.filter(
    (row) => row['deleted_at'] === null && row['target_type'] === targetType && row['target_id'] === targetId,
  );
}

export interface ReminderData {
  occurrences: Occurrence[];
  reminders: ReminderRow[];
  events: EventRow[];
  dayKinds: ExpandDayKind[];
  timeZone: string;
}

/** 装载提醒计算所需的一切：展开后的课次、提醒规则、日程与日期判定。 */
export async function loadReminderData(
  storage: Storage,
  semesterId: string,
  from: string,
  to: string,
): Promise<ReminderData | undefined> {
  const input = await loadExpandInput(storage, semesterId, from, to);
  if (input === undefined) return undefined;

  const reminders = (await storage.collection<ReminderRow>('reminders').getAll()).filter(
    (row) => row.deleted_at === null,
  );
  const events = (await storage.collection<EventRow>('events').getAll()).filter(
    (row) => row.deleted_at === null && row.semester_id === semesterId,
  );

  return {
    occurrences: expand(input),
    reminders,
    events,
    dayKinds: [...(input.dayKinds ?? [])],
    timeZone: input.semester.time_zone,
  };
}
