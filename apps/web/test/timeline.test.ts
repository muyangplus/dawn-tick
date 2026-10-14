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
import type { EventRow, Occurrence } from '@dawn-tick/core';

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
  return {
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
  };
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
  assert.equal(cancel.detail, '停课');
  assert.equal(cancel.done, true);
  assert.equal(cancel.completed, true);
  assert.equal(cancel.checkable, false);
  const { main, completed } = splitTimeline(items);
  assert.equal(completed.filter((item) => item.key === 'adjust-e-cancel').length, 1);
  assert.equal(main.filter((item) => item.key === 'adjust-e-cancel').length, 0);
});
