import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '@dawn-tick/core';
import { buildWidgetSnapshot } from '../src/widget-snapshot.ts';
import type { AppData, LessonCell } from '../src/data.ts';

function appData(overrides: Partial<AppData> = {}): AppData {
  return {
    timeZone: 'Asia/Shanghai',
    today: '2026-09-21',
    todayOfWeek: 1,
    week: 3,
    viewWeek: 3,
    weekStartDate: '2026-09-21',
    semester: null,
    semesters: [],
    slots: [],
    grid: new Map(),
    todayLessons: [],
    currentLesson: undefined,
    nextLesson: undefined,
    exams: [],
    todos: [],
    reschedules: [],
    ...overrides,
  };
}

const lesson = {
  scheduleId: 's-1',
  courseId: 'c-1',
  courseName: '高等数学',
  room: '教三-201',
  color: '#4F8DFD',
  date: '2026-09-21',
  periodStart: 1,
  periodEnd: 2,
  startAt: 1790000000000,
  endAt: 1790003600000,
  cancelled: false,
};

const cell: LessonCell = {
  scheduleId: 's-1',
  courseId: 'c-1',
  name: '高数',
  teacher: '张老师',
  room: '教三-201',
  color: '#4F8DFD',
  dayOfWeek: 1,
  periodStart: 1,
  periodEnd: 2,
  startTime: '08:00',
  endTime: '09:40',
  inWeek: true,
  holiday: false,
  cancelled: false,
};

test('无课时的快照', () => {
  const snapshot = buildWidgetSnapshot(appData(), DEFAULT_SETTINGS, 42);
  assert.equal(snapshot.updatedAt, 42);
  assert.equal(snapshot.week, 3);
  assert.equal(snapshot.timeZone, 'Asia/Shanghai');
  assert.equal(snapshot.background, 'light');
  assert.equal(snapshot.current, null);
  assert.equal(snapshot.next, null);
  assert.deepEqual(snapshot.today, []);
  assert.deepEqual(snapshot.grid, []);
  assert.deepEqual(snapshot.exams, []);
});

test('正在上课时快照给出 current 与剩余时间', () => {
  const snapshot = buildWidgetSnapshot(
    appData({ currentLesson: lesson, nextLesson: { ...lesson, courseName: '大学物理' } }),
    DEFAULT_SETTINGS,
    9,
  );
  assert.equal(snapshot.current?.title, '高等数学');
  assert.equal(snapshot.current?.endsAt, lesson.endAt);
  assert.equal(snapshot.next?.title, '大学物理');
});

test('有课时快照包含下一节、今日列表与周网格', () => {
  const data = appData({
    todayLessons: [lesson, { ...lesson, scheduleId: 's-2', courseName: '大学物理', room: null }],
    nextLesson: lesson,
    grid: new Map([['1:1', [cell]]]),
  });
  const snapshot = buildWidgetSnapshot(data, { ...DEFAULT_SETTINGS, widgetBackground: 'transparent' }, 7);

  assert.equal(snapshot.next?.title, '高等数学');
  assert.equal(snapshot.next?.room, '教三-201');
  assert.equal(snapshot.next?.startsAt, lesson.startAt);
  assert.equal(snapshot.today.length, 2);
  assert.equal(snapshot.today[1]?.room, null);
  assert.equal(snapshot.background, 'transparent');
  assert.equal(snapshot.grid.length, 1);
  assert.equal(snapshot.grid[0]?.title, '高数');
  assert.equal(snapshot.grid[0]?.periodEnd, 2);
  assert.equal(snapshot.grid[0]?.cancelled, false);
});

test('考试写入快照', () => {
  const data = appData({
    exams: [
      {
        id: 'e-1',
        user_id: 'u1',
        semester_id: 'sem-1',
        parent_id: null,
        type: 'exam',
        title: '高等数学期末',
        on_date: '2027-01-05',
        start_at: 1790000000000,
        end_at: null,
        all_day: 0,
        location: '教三-201',
        note: null,
        done: 0,
        priority: null,
        due_at: null,
        subject: '高等数学',
        seat_no: null,
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
      },
    ],
  });
  const snapshot = buildWidgetSnapshot(data, DEFAULT_SETTINGS, 1);
  assert.equal(snapshot.exams.length, 1);
  assert.equal(snapshot.exams[0]?.title, '高等数学期末');
  assert.equal(snapshot.exams[0]?.date, '2027-01-05');
});

test('快照可被 JSON 序列化并原样还原', () => {
  const data = appData({ todayLessons: [lesson], nextLesson: lesson, grid: new Map([['1:1', [cell]]]) });
  const snapshot = buildWidgetSnapshot(data, DEFAULT_SETTINGS, 1);
  const restored = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
  assert.deepEqual(restored, snapshot);
});

test('不显示周末时一周概览的快照不含周六日课程', () => {
  const saturday: LessonCell = { ...cell, scheduleId: 's-6', dayOfWeek: 6, date: '2026-09-26' };
  const sunday: LessonCell = { ...cell, scheduleId: 's-7', dayOfWeek: 7, date: '2026-09-27' };
  const data = appData({
    grid: new Map([
      ['2026-09-21:1', [cell]],
      ['2026-09-26:1', [saturday]],
      ['2026-09-27:1', [sunday]],
    ]),
  });

  const hidden = buildWidgetSnapshot(data, { ...DEFAULT_SETTINGS, hideWeekends: true }, 1);
  assert.deepEqual([...new Set(hidden.grid.map((item) => item.dayOfWeek))].sort(), [1]);

  const shown = buildWidgetSnapshot(data, DEFAULT_SETTINGS, 1);
  assert.equal(shown.grid.length, 3);
});
