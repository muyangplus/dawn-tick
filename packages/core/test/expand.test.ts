import test from 'node:test';
import assert from 'node:assert/strict';
import { expand, nextOccurrence, resolveDayKind, type ExpandDayKind, type ExpandInput } from '../src/expand.ts';
import {
  loadCourses,
  loadDayKinds,
  loadReschedules,
  loadSchedules,
  loadSemester,
  loadTimeSlots,
} from '../src/queries.ts';
import type { SqlDriver } from '../src/db.ts';
import { NOW, SEMESTER_ID, USER_ID, createDb, insert, seed } from './helpers.ts';

function buildInput(db: SqlDriver, from: string, to: string): ExpandInput {
  const semester = loadSemester(db, SEMESTER_ID);
  assert.ok(semester !== undefined);
  return {
    semester: {
      id: semester.id,
      start_date: semester.start_date,
      total_weeks: semester.total_weeks,
      time_zone: semester.time_zone,
    },
    courses: loadCourses(db, SEMESTER_ID),
    schedules: loadSchedules(db, SEMESTER_ID),
    timeSlots: loadTimeSlots(db, SEMESTER_ID),
    dayKinds: loadDayKinds(db, SEMESTER_ID, from, to),
    reschedules: loadReschedules(db, SEMESTER_ID, from, to),
    from,
    to,
  };
}

function dayKindRow(onDate: string, type: string, extra: Record<string, string | number | null> = {}): Record<string, string | number | null> {
  return {
    user_id: USER_ID,
    semester_id: SEMESTER_ID,
    type,
    title: onDate,
    on_date: onDate,
    source: 'from_school',
    created_at: NOW,
    updated_at: NOW,
    ...extra,
  };
}

function rescheduleRow(id: string, onDate: string, action: string, extra: Record<string, string | number | null> = {}): Record<string, string | number | null> {
  return {
    id,
    user_id: USER_ID,
    semester_id: SEMESTER_ID,
    type: 'reschedule',
    title: '调课',
    on_date: onDate,
    ref_schedule_id: 's-1',
    action,
    created_at: NOW,
    updated_at: NOW,
    ...extra,
  };
}

test('连续周次与节次时间换算为 UTC', () => {
  const db = createDb();
  seed(db);
  const items = expand(buildInput(db, '2026-09-21', '2026-09-21'));
  assert.equal(items.length, 1);
  const first = items[0];
  assert.ok(first !== undefined);
  assert.equal(first.courseName, '高等数学');
  assert.equal(first.periodStart, 1);
  assert.equal(first.periodEnd, 2);
  assert.equal(first.startAt, Date.UTC(2026, 8, 21, 0, 0, 0));
  assert.equal(first.endAt, Date.UTC(2026, 8, 21, 1, 40, 0));
  assert.equal(first.room, '教三-201');
});

test('单双周按周次集合过滤', () => {
  const db = createDb();
  seed(db);
  assert.deepEqual(expand(buildInput(db, '2026-09-23', '2026-09-23')), []);
  const even = expand(buildInput(db, '2026-09-30', '2026-09-30'));
  assert.equal(even.length, 1);
  assert.equal(even[0]?.courseName, '大学物理');
});

test('碎片周次', () => {
  const db = createDb();
  seed(db);
  const weeks = ['2026-10-09', '2026-10-16', '2026-10-23'];
  const counts = weeks.map((date) => expand(buildInput(db, date, date)).length);
  assert.deepEqual(counts, [1, 0, 1]);
});

test('超出总周数不产生课次', () => {
  const db = createDb();
  seed(db);
  assert.deepEqual(expand(buildInput(db, '2027-01-04', '2027-01-10')), []);
});

test('放假当天不排课', () => {
  const db = createDb();
  seed(db);
  insert(db, 'events', { id: 'e-h', ...dayKindRow('2026-09-21', 'holiday', { source: 'builtin' }) });
  assert.deepEqual(expand(buildInput(db, '2026-09-21', '2026-09-21')), []);
});

test('调休补课按指定星期上课', () => {
  const db = createDb();
  seed(db);
  insert(db, 'events', { id: 'e-m', ...dayKindRow('2026-10-10', 'makeup', { as_day_of_week: 1 }) });
  const items = expand(buildInput(db, '2026-10-10', '2026-10-10'));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.courseName, '高等数学');
  assert.equal(items[0]?.date, '2026-10-10');
});

test('调课取消与改期', () => {
  const db = createDb();
  seed(db);
  insert(db, 'events', { id: 'e-c', ...rescheduleRow('e-c', '2026-09-21', 'cancel') });
  assert.deepEqual(expand(buildInput(db, '2026-09-21', '2026-09-21')), []);
  const withCancelled = expand({
    ...buildInput(db, '2026-09-21', '2026-09-21'),
    includeCancelled: true,
  });
  assert.equal(withCancelled.length, 1);
  assert.equal(withCancelled[0]?.cancelled, true);

  const db2 = createDb();
  seed(db2);
  insert(db2, 'events', {
    id: 'e-mv',
    ...rescheduleRow('e-mv', '2026-09-21', 'move', { new_date: '2026-09-22', new_period_start: 3, new_period_end: 4 }),
  });
  const moved = expand(buildInput(db2, '2026-09-21', '2026-09-22'));
  assert.equal(moved.length, 1);
  assert.equal(moved[0]?.date, '2026-09-22');
  assert.equal(moved[0]?.periodStart, 3);
  assert.equal(moved[0]?.startAt, Date.UTC(2026, 8, 22, 2, 0, 0));
});

test('调课换教室', () => {
  const db = createDb();
  seed(db);
  insert(db, 'events', { id: 'e-r', ...rescheduleRow('e-r', '2026-09-21', 'room_change', { new_room: '教三-305' }) });
  const items = expand(buildInput(db, '2026-09-21', '2026-09-21'));
  assert.equal(items[0]?.room, '教三-305');
});

test('下一节课取当前时刻之后的最近一次', () => {
  const db = createDb();
  seed(db);
  const items = expand(buildInput(db, '2026-09-14', '2026-10-30'));
  const now = Date.UTC(2026, 8, 21, 0, 30, 0);
  const next = nextOccurrence(items, now);
  assert.ok(next !== undefined);
  assert.equal(next.date, '2026-09-25');
  assert.equal(next.courseName, '大学英语');
});

test('同一天多来源按优先级取一条', () => {
  const kinds: ExpandDayKind[] = [
    { on_date: '2026-10-01', type: 'holiday', as_day_of_week: null, source: 'builtin' },
    { on_date: '2026-10-01', type: 'workday', as_day_of_week: null, source: 'manual' },
    { on_date: '2026-10-01', type: 'holiday', as_day_of_week: null, source: 'from_school' },
  ];
  const resolved = resolveDayKind(kinds);
  assert.equal(resolved.get('2026-10-01')?.source, 'manual');
});
