import test from 'node:test';
import assert from 'node:assert/strict';
import { weekView } from '../src/queries.ts';
import { createDb, insert, seed, NOW, SEMESTER_ID, USER_ID } from './helpers.ts';

test('约束拦截脏数据', () => {
  const db = createDb();
  seed(db);

  const badSchedule = (row: Record<string, string | number | null>): void => {
    insert(db, 'course_schedules', {
      course_id: 'c-1',
      weeks_mask: 1,
      created_at: NOW,
      updated_at: NOW,
      ...row,
    });
  };

  assert.throws(() => badSchedule({ id: 'x1', day_of_week: 1, period_start: 5, period_end: 3 }));
  assert.throws(() => badSchedule({ id: 'x2', day_of_week: 8, period_start: 1, period_end: 2 }));
  assert.throws(() => badSchedule({ id: 'x3', day_of_week: 1, period_start: 1, period_end: 2, weeks_mask: 0 }));
  assert.throws(() => badSchedule({ id: 'x4', course_id: 'nope', day_of_week: 1, period_start: 1, period_end: 2 }));
  assert.throws(() =>
    insert(db, 'courses', {
      id: 'c-x',
      semester_id: SEMESTER_ID,
      name: '坏课',
      credits: -1,
      created_at: NOW,
      updated_at: NOW,
    }),
  );
  assert.throws(() =>
    insert(db, 'time_slots', {
      id: 'ts-x',
      semester_id: SEMESTER_ID,
      period_no: 41,
      start_time: '22:00',
      end_time: '22:45',
      created_at: NOW,
      updated_at: NOW,
    }),
  );
});

test('每用户仅一个当前学期', () => {
  const db = createDb();
  seed(db);
  assert.throws(() =>
    insert(db, 'semesters', {
      id: 'sem-2',
      user_id: USER_ID,
      name: '第二学期',
      start_date: '2027-02-22',
      total_weeks: 20,
      is_active: 1,
      created_at: NOW,
      updated_at: NOW,
    }),
  );
});

test('events 七种类型与条件约束', () => {
  const db = createDb();
  seed(db);
  const base = { user_id: USER_ID, semester_id: SEMESTER_ID, created_at: NOW, updated_at: NOW };

  insert(db, 'events', { id: 'e-exam', type: 'exam', title: '高数期末', subject: '高等数学', seat_no: 'A-12', ...base });
  insert(db, 'events', { id: 'e-todo', type: 'todo', title: '交实验报告', priority: 3, due_at: Date.UTC(2026, 9, 20, 14, 0, 0), ...base });
  insert(db, 'events', { id: 'e-sub', type: 'todo', title: '写实验一', parent_id: 'e-todo', ...base });
  insert(db, 'events', { id: 'e-holiday', type: 'holiday', title: '国庆节', on_date: '2026-10-01', source: 'builtin', ...base });
  insert(db, 'events', { id: 'e-makeup', type: 'makeup', title: '调休补课', on_date: '2026-10-10', as_day_of_week: 1, source: 'from_school', ...base });
  insert(db, 'events', { id: 'e-move', type: 'reschedule', title: '高数改期', on_date: '2026-09-21', ref_schedule_id: 's-1', action: 'move', new_date: '2026-09-22', new_period_start: 3, new_period_end: 4, ...base });

  assert.throws(() => insert(db, 'events', { id: 'b1', type: 'reschedule', title: 'x', action: 'cancel', ...base }));
  assert.throws(() => insert(db, 'events', { id: 'b2', type: 'holiday', title: 'x', ...base }));
  assert.throws(() => insert(db, 'events', { id: 'b3', type: 'temp', title: 'x', priority: 1, ...base }));
  assert.throws(() => insert(db, 'events', { id: 'b4', type: 'exam', title: 'x', due_at: NOW, ...base }));
  assert.throws(() => insert(db, 'events', { id: 'b5', type: 'makeup', title: 'x', on_date: '2026-10-11', ...base }));
  assert.throws(() => insert(db, 'events', { id: 'b6', type: 'holiday', title: 'x', on_date: '2026-10-01', ...base }));
  assert.throws(() => insert(db, 'events', { id: 'b7', type: 'todo', title: 'x', parent_id: 'b7', ...base }));
  assert.throws(() => insert(db, 'events', { id: 'b8', type: 'todo', title: 'x', priority: 4, ...base }));
});

test('级联删除', () => {
  const db = createDb();
  seed(db);
  const base = { user_id: USER_ID, semester_id: SEMESTER_ID, created_at: NOW, updated_at: NOW };
  insert(db, 'events', { id: 'e-todo', type: 'todo', title: '父任务', ...base });
  insert(db, 'events', { id: 'e-sub', type: 'todo', title: '子任务', parent_id: 'e-todo', ...base });
  insert(db, 'events', { id: 'e-move', type: 'reschedule', title: '改期', on_date: '2026-09-21', ref_schedule_id: 's-1', action: 'cancel', ...base });

  db.run('DELETE FROM courses WHERE id = ?', ['c-2']);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM course_schedules WHERE course_id = ?', ['c-2'])?.n, 0);

  db.run('DELETE FROM course_schedules WHERE id = ?', ['s-1']);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE ref_schedule_id = ?', ['s-1'])?.n, 0);

  db.run('DELETE FROM events WHERE id = ?', ['e-todo']);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE parent_id = ?', ['e-todo'])?.n, 0);
});

test('周视图查询按位图过滤', () => {
  const db = createDb();
  seed(db);

  const week3Mon = weekView(db, SEMESTER_ID, 1, 3);
  assert.equal(week3Mon.length, 1);
  assert.equal(week3Mon[0]?.name, '高等数学');

  assert.deepEqual(weekView(db, SEMESTER_ID, 3, 3), []);
  assert.equal(weekView(db, SEMESTER_ID, 3, 4)[0]?.name, '大学物理');
  assert.deepEqual(weekView(db, SEMESTER_ID, 1, 17), []);
  assert.equal(weekView(db, SEMESTER_ID, 5, 5)[0]?.name, '大学英语');
  assert.deepEqual(weekView(db, SEMESTER_ID, 5, 6), []);
  assert.equal(weekView(db, SEMESTER_ID, 5, 7)[0]?.name, '大学英语');
});

test('提醒默认值', () => {
  const db = createDb();
  seed(db);
  insert(db, 'reminders', {
    id: 'r-1',
    user_id: USER_ID,
    target_type: 'course',
    target_id: 'c-1',
    created_at: NOW,
    updated_at: NOW,
  });
  const row = db.get<{
    advance_minutes: number;
    enabled: number;
    skip_holidays: number;
    sound: number;
    vibrate: number;
    dnd: number;
    snooze_minutes: number | null;
  }>('SELECT advance_minutes, enabled, skip_holidays, sound, vibrate, dnd, snooze_minutes FROM reminders WHERE id = ?', ['r-1']);
  assert.equal(row?.advance_minutes, 10);
  assert.equal(row?.enabled, 1);
  assert.equal(row?.skip_holidays, 1);
  assert.equal(row?.sound, 1);
  assert.equal(row?.vibrate, 1);
  assert.equal(row?.dnd, 0);
  assert.equal(row?.snooze_minutes, null);
  assert.throws(() =>
    insert(db, 'reminders', {
      id: 'r-2',
      user_id: USER_ID,
      target_type: 'course',
      target_id: 'c-1',
      advance_minutes: 1441,
      created_at: NOW,
      updated_at: NOW,
    }),
  );
});
