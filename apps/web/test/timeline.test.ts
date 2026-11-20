import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentPeriod,
  minutesOfDay,
  nowRatio,
  slotRangeRatio,
  timelineBounds,
} from '../src/lib/timeline.ts';
import { formatCountdown, formatDayCountdown, formatRemaining, formatShortCountdown } from '../src/lib/format.ts';
import { buildTimeline, splitTimeline } from '../src/screens/cards/timeline.ts';
import type { AppData } from '../src/data.ts';
import { appDataOf } from './kit/app-data.ts';
import type { EventRow, ManagedCourse, Occurrence, TimeSlotRow } from '@dawn-tick/core';

const LESSON: Occurrence = {
  date: '2026-10-13',
  semesterId: 'sem-1',
  scheduleId: 'sch-1',
  courseId: 'c-1',
  courseName: '高等数学',
  shortName: '高数',
  color: '#4F8DFD',
  periodStart: 1,
  periodEnd: 2,
  startAt: Date.UTC(2026, 9, 13, 0, 0, 0),
  endAt: Date.UTC(2026, 9, 13, 1, 40, 0),
  room: '教三-201',
  cancelled: false,
};

const CANCEL_EVENT = {
  id: 'e-cancel',
  type: 'reschedule',
  title: '停课：高等数学',
  on_date: '2026-10-13',
  action: 'cancel',
  done: 0,
  start_at: null,
  end_at: null,
  new_date: null,
  new_period_start: null,
  new_period_end: null,
  new_room: null,
  location: null,
} as unknown as EventRow;

function makeData(overrides: Partial<AppData> = {}): AppData {
  return appDataOf({
    timeZone: 'Asia/Shanghai',
    today: '2026-10-13',
    todayOfWeek: 2,
    week: 6,
    viewWeek: 6,
    weekStartDate: '2026-10-12',
    hasLessons: true,
    courses: [],
    lessonsByDate: new Map([['2026-10-13', [LESSON]]]),
    holidayLabels: new Map(),
    workdayDates: [],
    semester: null,
    semesters: [],
    slots: [],
    grid: new Map(),
    todayLessons: [LESSON],
    todoSort: 'start',
    currentLesson: undefined,
    nextLesson: undefined,
    exams: [],
    todos: [],
    labs: [],
    countdowns: [],
    reschedules: [],
    ...overrides,
  });
}

const SLOTS = [
  { periodNo: 1, startTime: '08:00', endTime: '08:45' },
  { periodNo: 2, startTime: '08:55', endTime: '09:40' },
  { periodNo: 3, startTime: '10:00', endTime: '10:45' },
];

test('时间解析与范围', () => {
  assert.equal(minutesOfDay('08:00'), 480);
  assert.equal(minutesOfDay('8:05'), 485);
  assert.throws(() => minutesOfDay('八点'), /非法时间/);
  assert.deepEqual(timelineBounds(SLOTS), { start: 480, end: 645 });
  assert.equal(timelineBounds([]), null);
});

test('当前时间比例', () => {
  assert.equal(nowRatio([], 500), null);
  assert.equal(nowRatio(SLOTS, 400), null);
  assert.equal(nowRatio(SLOTS, 700), null);
  assert.equal(nowRatio(SLOTS, 480), 0);
  assert.equal(nowRatio(SLOTS, 645), 1);
  const mid = nowRatio(SLOTS, 562.5);
  assert.ok(mid !== null && Math.abs(mid - 0.5) < 1e-9);
});

test('节次区间比例', () => {
  const first = slotRangeRatio(SLOTS, '08:00', '08:45');
  assert.ok(first !== null);
  assert.equal(first.top, 0);
  assert.ok(Math.abs(first.height - 45 / 165) < 1e-9);
  const last = slotRangeRatio(SLOTS, '10:00', '10:45');
  assert.ok(last !== null && Math.abs(last.top + last.height - 1) < 1e-9);
  assert.equal(slotRangeRatio([], '08:00', '08:45'), null);
});

test('当前节次', () => {
  assert.equal(currentPeriod(SLOTS, 480), 1);
  assert.equal(currentPeriod(SLOTS, 500), 1);
  assert.equal(currentPeriod(SLOTS, 530), null);
  assert.equal(currentPeriod(SLOTS, 470), null);
  assert.equal(currentPeriod(SLOTS, 600), 3);
});

test('倒计时格式', () => {
  assert.equal(formatCountdown(-1), '即将开始');
  assert.equal(formatCountdown(65_000), '01:05');
  assert.equal(formatCountdown(3_665_000), '1:01:05');
  assert.equal(formatShortCountdown(90_000), '1 分钟');
  assert.equal(formatShortCountdown(3_600_000), '1 小时');
  assert.equal(formatShortCountdown(5_400_000), '1 小时 30 分');
  assert.equal(formatDayCountdown(1_000_000 + 86_400_000 * 2, 1_000_000), '2 天');
  assert.equal(formatDayCountdown(500, 1_000_000), '今天');
});

test('剩余时间格式', () => {
  const base = 1_000_000;
  assert.equal(formatRemaining(base + 65_000, base), '01:05');
  assert.equal(formatRemaining(base + 3_665_000, base), '1:01:05');
  assert.equal(formatRemaining(base, base), '00:00');
  assert.equal(formatRemaining(base - 5_000, base), '00:00');
});

test('待办排序：按类型时作业排在日程前，按开始时间时以时间先后为准', () => {
  const todo = (id: string, type: EventRow['type'], title: string, startAt: number): EventRow =>
    ({
      id,
      type,
      title,
      on_date: '2026-10-13',
      start_at: startAt,
      due_at: null,
      end_at: null,
      done: 0,
      countdown: 0,
      manual_done: 0,
      subject: null,
      location: null,
      note: null,
      period_start: null,
      period_end: null,
      weeks_mask: null,
      start_time: null,
      end_time: null,
      show_in_timetable: 0,
      nature: null,
      as_day_of_week: null,
    }) as unknown as EventRow;
  const at = (hour: number): number => Date.UTC(2026, 9, 13, hour, 0, 0);
  const todos = [todo('t-1', 'temp', '组会', at(1)), todo('t-2', 'homework', '交作业', at(6))];
  const byStart = buildTimeline(makeData({ todos }), '2026-10-13', at(0));
  const byType = buildTimeline(makeData({ todos, todoSort: 'type' }), '2026-10-13', at(0));
  const titles = (items: ReturnType<typeof buildTimeline>): string[] =>
    items.filter((item) => item.kind === 'todo').map((item) => item.title);
  assert.deepEqual(titles(byStart), ['组会', '交作业']);
  assert.deepEqual(titles(byType), ['交作业', '组会']);
});

test('时间线：进行中的课带 running 标记，到点后进已完成', () => {
  const data = makeData();
  const during = buildTimeline(data, '2026-10-13', Date.UTC(2026, 9, 13, 0, 30, 0));
  assert.equal(during.length, 1);
  assert.equal(during[0]?.running, true);
  assert.equal(during[0]?.completed, false);
  assert.equal(splitTimeline(during).main.length, 1);

  const after = buildTimeline(data, '2026-10-13', Date.UTC(2026, 9, 13, 2, 0, 0));
  assert.equal(after[0]?.running, false);
  assert.equal(after[0]?.completed, true);
  assert.equal(splitTimeline(after).completed.length, 1);
});

test('时间线：停课记录默认已完成，不计入未完成安排', () => {
  const data = makeData({ reschedules: [CANCEL_EVENT] });
  const items = buildTimeline(data, '2026-10-13', Date.UTC(2026, 9, 13, 0, 30, 0));
  const cancel = items.find((item) => item.key === 'adjust-e-cancel');
  assert.ok(cancel !== undefined);
  // 没关联排课：时间列写「停课」，副标题留空
  assert.equal(cancel.statusText, '停课');
  assert.equal(cancel.detail, '');
  assert.equal(cancel.done, true);
  assert.equal(cancel.completed, true);
  assert.equal(cancel.checkable, false);
  const { main, completed } = splitTimeline(items);
  assert.equal(completed.filter((item) => item.key === 'adjust-e-cancel').length, 1);
  assert.equal(main.filter((item) => item.key === 'adjust-e-cancel').length, 0);
});

/** 作息表：第 3、4 节 10:00–11:40 */
const SLOT_ROWS = [
  { period_no: 3, start_time: '10:00', end_time: '10:45' },
  { period_no: 4, start_time: '10:55', end_time: '11:40' },
] as unknown as TimeSlotRow[];

function courseWith(schedule: Partial<ManagedCourse['schedules'][number]>): ManagedCourse {
  return {
    id: 'c-2',
    name: '大学物理',
    shortName: null,
    teacher: null,
    location: null,
    color: '#4F8DFD',
    credits: null,
    note: null,
    schedules: [
      {
        id: 'sch-phy',
        dayOfWeek: 2,
        periodStart: 3,
        periodEnd: 4,
        weeks: [6],
        room: null,
        startTime: null,
        endTime: null,
        ...schedule,
      },
    ],
  };
}

const PHYSICS_CANCEL = { ...CANCEL_EVENT, id: 'e-phy', title: '停课：大学物理', ref_schedule_id: 'sch-phy' } as EventRow;

test('时间线：停课条目副标题是原节次与作息表时间，按原开始时间排序', () => {
  const data = makeData({ courses: [courseWith({})], slots: SLOT_ROWS, reschedules: [PHYSICS_CANCEL] });
  const items = buildTimeline(data, '2026-10-13', Date.UTC(2026, 9, 13, 0, 30, 0));
  const cancel = items.find((item) => item.key === 'adjust-e-phy');
  assert.ok(cancel !== undefined);
  assert.equal(cancel.statusText, '停课');
  assert.equal(cancel.detail, '第 3–4 节 10:00–11:40');
  assert.equal(cancel.minute, 600);
  assert.equal(cancel.completed, true);
});

test('时间线：停课条目的时间以排课自定义时间为准', () => {
  const data = makeData({
    courses: [courseWith({ startTime: '13:30', endTime: '15:05' })],
    slots: SLOT_ROWS,
    reschedules: [PHYSICS_CANCEL],
  });
  const cancel = buildTimeline(data, '2026-10-13', Date.UTC(2026, 9, 13, 0, 30, 0)).find((item) => item.key === 'adjust-e-phy');
  assert.equal(cancel?.detail, '第 3–4 节 13:30–15:05');
  assert.equal(cancel?.minute, 13 * 60 + 30);
});

test('时间线：停课排课没有作息时间时只写节次', () => {
  const data = makeData({ courses: [courseWith({ periodStart: 7, periodEnd: 7 })], slots: SLOT_ROWS, reschedules: [PHYSICS_CANCEL] });
  const cancel = buildTimeline(data, '2026-10-13', Date.UTC(2026, 9, 13, 0, 30, 0)).find((item) => item.key === 'adjust-e-phy');
  assert.equal(cancel?.detail, '第 7 节');
});

test('时间线：找不到停课对应的排课时副标题留空', () => {
  const orphan = { ...PHYSICS_CANCEL, ref_schedule_id: 'sch-gone' } as EventRow;
  const data = makeData({ courses: [courseWith({})], slots: SLOT_ROWS, reschedules: [orphan] });
  const cancel = buildTimeline(data, '2026-10-13', Date.UTC(2026, 9, 13, 0, 30, 0)).find((item) => item.key === 'adjust-e-phy');
  assert.equal(cancel?.detail, '');
  assert.equal(cancel?.statusText, '停课');
});

test('时间线：非停课的调整不带 statusText', () => {
  const move = {
    ...CANCEL_EVENT,
    id: 'e-move',
    action: 'move',
    new_date: '2026-10-15',
    new_period_start: 5,
    new_period_end: 6,
  } as EventRow;
  const item = buildTimeline(makeData({ reschedules: [move] }), '2026-10-13', 0).find((entry) => entry.key === 'adjust-e-move');
  assert.equal(item?.statusText, null);
  assert.equal(item?.detail, '改至 2026-10-15 第 5–6 节');
});
