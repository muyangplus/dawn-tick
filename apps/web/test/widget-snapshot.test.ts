import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWidgetSnapshot } from '../src/widget-snapshot.ts';
import type { AppData } from '../src/data.ts';

function appData(overrides: Partial<AppData> = {}): AppData {
  return {
    timeZone: 'Asia/Shanghai',
    today: '2026-09-21',
    todayOfWeek: 1,
    week: 3,
    semester: null,
    slots: [],
    grid: new Map(),
    todayLessons: [],
    nextLesson: undefined,
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

test('无课时的快照', () => {
  const snapshot = buildWidgetSnapshot(appData(), 42);
  assert.equal(snapshot.updatedAt, 42);
  assert.equal(snapshot.week, 3);
  assert.equal(snapshot.timeZone, 'Asia/Shanghai');
  assert.equal(snapshot.next, null);
  assert.deepEqual(snapshot.today, []);
});

test('有课时快照包含下一节与今日列表', () => {
  const data = appData({
    todayLessons: [lesson, { ...lesson, scheduleId: 's-2', courseName: '大学物理', room: null }],
    nextLesson: lesson,
  });
  const snapshot = buildWidgetSnapshot(data, 7);

  assert.equal(snapshot.next?.title, '高等数学');
  assert.equal(snapshot.next?.room, '教三-201');
  assert.equal(snapshot.next?.startsAt, lesson.startAt);
  assert.equal(snapshot.today.length, 2);
  assert.equal(snapshot.today[1]?.title, '大学物理');
  assert.equal(snapshot.today[1]?.room, null);
});

test('快照可被 JSON 序列化并原样还原', () => {
  const data = appData({ todayLessons: [lesson], nextLesson: lesson });
  const snapshot = buildWidgetSnapshot(data, 1);
  const restored = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
  assert.deepEqual(restored, snapshot);
});
