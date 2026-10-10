import {
  activeSemester,
  addDays,
  dayOfWeek,
  expand,
  formatDate,
  listTimeSlots,
  loadExpandInput,
  nextOccurrence,
  resolveTimeZone,
  weekOfDate,
  weekView,
  type AppSettings,
  type Occurrence,
  type SemesterRow,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';

export interface LessonCell {
  courseId: string;
  name: string;
  room: string | null;
  color: string;
  periodStart: number;
  periodEnd: number;
}

export interface AppData {
  timeZone: string;
  today: string;
  todayOfWeek: number;
  week: number;
  semester: SemesterRow | null;
  slots: TimeSlotRow[];
  grid: Map<string, LessonCell[]>;
  todayLessons: Occurrence[];
  nextLesson: Occurrence | undefined;
}

const LOOKAHEAD_DAYS = 14;

export async function loadAppData(storage: Storage, settings: AppSettings): Promise<AppData> {
  const timeZone = resolveTimeZone(settings.timeZone, settings.autoTimeZone);
  const today = formatDate(Date.now(), timeZone);
  const semester = (await activeSemester(storage, 'u1')) ?? null;

  if (semester === null) {
    return {
      timeZone,
      today,
      todayOfWeek: 0,
      week: 0,
      semester: null,
      slots: [],
      grid: new Map(),
      todayLessons: [],
      nextLesson: undefined,
    };
  }

  const slots = await listTimeSlots(storage, semester.id);
  const week = Math.max(1, weekOfDate(today, semester.start_date));
  const grid = new Map<string, LessonCell[]>();
  for (let day = 1; day <= 7; day += 1) {
    for (const row of await weekView(storage, semester.id, day, week)) {
      for (let period = row.period_start; period <= row.period_end; period += 1) {
        const key = `${day}:${period}`;
        const list = grid.get(key) ?? [];
        list.push({
          courseId: row.course_id,
          name: row.short_name ?? row.name,
          room: row.room,
          color: row.color,
          periodStart: row.period_start,
          periodEnd: row.period_end,
        });
        grid.set(key, list);
      }
    }
  }

  const input = await loadExpandInput(storage, semester.id, today, addDays(today, LOOKAHEAD_DAYS));
  const occurrences = input === undefined ? [] : expand(input);
  const todayLessons = occurrences.filter((item) => item.date === today && !item.cancelled);

  return {
    timeZone,
    today,
    todayOfWeek: dayOfWeek(today),
    week,
    semester,
    slots,
    grid,
    todayLessons,
    nextLesson: nextOccurrence(occurrences, Date.now()),
  };
}
