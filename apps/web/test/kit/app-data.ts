import type { EventRow, Occurrence } from '@dawn-tick/core';
import type { AppData, LessonCell } from '../../src/data.ts';

/** 完整的空 AppData：各用例只覆盖关心的字段。 */
export function appDataOf(overrides: Partial<AppData> = {}): AppData {
  const base: AppData = {
    timeZone: 'Asia/Shanghai',
    today: '2026-09-21',
    todayOfWeek: 1,
    week: 3,
    viewWeek: 3,
    weekStartDate: '2026-09-21',
    windowStart: '2026-09-21',
    windowDates: [],
    windowSpansWeeks: false,
    hasLessons: false,
    courses: [],
    lessonsByDate: new Map(),
    holidayLabels: new Map(),
    workdayDates: [],
    semester: null,
    semesters: [],
    slots: [],
    grid: new Map(),
    todayLessons: [],
    todoSort: 'start',
    showCancelled: false,
    tomorrowLessons: [],
    currentLesson: undefined,
    nextLesson: undefined,
    exams: [],
    todos: [],
    labs: [],
    countdowns: [],
    reschedules: [],
  };
  return Object.assign(base, overrides);
}

export function occurrenceOf(overrides: Partial<Occurrence> = {}): Occurrence {
  const base: Occurrence = {
    date: '2026-09-21',
    semesterId: 'sem-1',
    scheduleId: 's-1',
    courseId: 'c-1',
    courseName: '高等数学',
    shortName: null,
    color: '#4F8DFD',
    periodStart: 1,
    periodEnd: 2,
    startAt: 1790000000000,
    endAt: 1790003600000,
    room: '教三-201',
    cancelled: false,
  };
  return Object.assign(base, overrides);
}

export function lessonCellOf(overrides: Partial<LessonCell> = {}): LessonCell {
  const base: LessonCell = {
    scheduleId: 's-1',
    courseId: 'c-1',
    name: '高数',
    teacher: null,
    room: null,
    color: '#4F8DFD',
    dayOfWeek: 1,
    date: '2026-09-21',
    periodStart: 1,
    periodEnd: 2,
    startTime: '08:00',
    endTime: '09:40',
    inWeek: true,
    holiday: false,
    cancelled: false,
    movedOut: false,
    movedIn: false,
    lab: false,
  };
  return Object.assign(base, overrides);
}

export function eventRowOf(overrides: Partial<EventRow> = {}): EventRow {
  const base: EventRow = {
    id: 'e-1',
    user_id: 'u1',
    semester_id: 'sem-1',
    parent_id: null,
    type: 'todo',
    title: '',
    on_date: null,
    start_at: null,
    end_at: null,
    all_day: 0,
    location: null,
    note: null,
    done: 0,
    countdown: 0,
    manual_done: 0,
    nature: null,
    priority: null,
    due_at: null,
    subject: null,
    seat_no: null,
    period_start: null,
    period_end: null,
    weeks_mask: null,
    start_time: null,
    end_time: null,
    show_in_timetable: 0,
    ref_schedule_id: null,
    action: null,
    new_date: null,
    new_period_start: null,
    new_period_end: null,
    new_room: null,
    as_day_of_week: null,
    source: null,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    rev: 0,
    dirty: 0,
  };
  return Object.assign(base, overrides);
}
