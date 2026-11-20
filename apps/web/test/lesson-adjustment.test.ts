import test from 'node:test';
import assert from 'node:assert/strict';
import type { ManagedCourse } from '@dawn-tick/core';
import { adjustmentEditTarget, adjustmentSummary } from '../src/screens/timetable/lesson-adjustment.ts';
import { eventRowOf, lessonCellOf } from './kit/app-data.ts';

const COURSES: ManagedCourse[] = [
  {
    id: 'c-1',
    name: '高等数学',
    shortName: '高数',
    teacher: null,
    location: null,
    color: '#4F8DFD',
    credits: null,
    note: null,
    schedules: [
      { id: 's-1', dayOfWeek: 1, periodStart: 1, periodEnd: 2, weeks: [1, 2, 3], room: null, startTime: null, endTime: null },
    ],
  },
];

const cancelEvent = eventRowOf({
  id: 'e-cancel',
  type: 'reschedule',
  ref_schedule_id: 's-1',
  on_date: '2026-09-21',
  action: 'cancel',
});

const moveEvent = eventRowOf({
  id: 'e-move',
  type: 'reschedule',
  ref_schedule_id: 's-1',
  on_date: '2026-09-21',
  action: 'move',
  new_date: '2026-09-23',
  new_period_start: 5,
  new_period_end: 6,
  new_room: '教一-101',
});

test('adjustmentSummary：停课 / 调走 / 调入各一句', () => {
  assert.equal(adjustmentSummary(lessonCellOf({ cancelled: true }), cancelEvent), '2026-09-21 这一次已停课');
  assert.equal(
    adjustmentSummary(lessonCellOf({ movedOut: true }), moveEvent),
    '2026-09-21 这一次已调到 2026-09-23 第 5–6 节',
  );
  assert.equal(
    adjustmentSummary(lessonCellOf({ movedIn: true, date: '2026-09-23' }), moveEvent),
    '由 2026-09-21 的课调来',
  );
});

test('adjustmentSummary：调课没记节次时只写日期，单节写成第 N 节', () => {
  const noPeriod = { ...moveEvent, new_period_start: null, new_period_end: null };
  assert.equal(adjustmentSummary(lessonCellOf({ movedOut: true }), noPeriod), '2026-09-21 这一次已调到 2026-09-23');
  const single = { ...moveEvent, new_period_start: 7, new_period_end: null };
  assert.equal(adjustmentSummary(lessonCellOf({ movedOut: true }), single), '2026-09-21 这一次已调到 2026-09-23 第 7 节');
});

test('adjustmentSummary：记录没有原日期时用格子的日期', () => {
  const noDate = { ...cancelEvent, on_date: null };
  assert.equal(adjustmentSummary(lessonCellOf({ cancelled: true, date: '2026-09-28' }), noDate), '2026-09-28 这一次已停课');
});

test('adjustmentEditTarget：停课还原成停课模式，保存时替换原记录', () => {
  assert.deepEqual(adjustmentEditTarget(cancelEvent, COURSES), {
    scheduleId: 's-1',
    courseId: 'c-1',
    courseName: '高等数学',
    date: '2026-09-21',
    periodStart: 1,
    periodEnd: 2,
    mode: 'cancel',
    drop: undefined,
    room: null,
    replaceEventId: 'e-cancel',
  });
});

test('adjustmentEditTarget：调课还原成改期，落点带新日期、新节次与教室', () => {
  const target = adjustmentEditTarget(moveEvent, COURSES);
  assert.ok(target !== null);
  assert.equal(target.mode, 'move');
  assert.deepEqual(target.drop, { date: '2026-09-23', periodStart: 5, periodEnd: 6 });
  assert.equal(target.room, '教一-101');
  assert.equal(target.replaceEventId, 'e-move');
  assert.equal(target.date, '2026-09-21');
});

test('adjustmentEditTarget：调课缺节次时退回原排课节次', () => {
  const target = adjustmentEditTarget({ ...moveEvent, new_period_start: null, new_period_end: null }, COURSES);
  assert.deepEqual(target?.drop, { date: '2026-09-23', periodStart: 1, periodEnd: 2 });
});

test('adjustmentEditTarget：排课已删或记录缺字段时返回 null', () => {
  assert.equal(adjustmentEditTarget({ ...cancelEvent, ref_schedule_id: 's-gone' }, COURSES), null);
  assert.equal(adjustmentEditTarget({ ...cancelEvent, ref_schedule_id: null }, COURSES), null);
  assert.equal(adjustmentEditTarget({ ...cancelEvent, on_date: null }, COURSES), null);
  assert.equal(adjustmentEditTarget(cancelEvent, []), null);
});
