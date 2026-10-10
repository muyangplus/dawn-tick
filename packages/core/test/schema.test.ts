import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteStorage } from '../src/sqlite-storage.ts';
import { activeSemester, weekView } from '../src/repository.ts';
import type { CourseRow, CourseScheduleRow, SemesterRow, UserRow } from '../src/types.ts';
import {
  NOW,
  SEMESTER_ID,
  USER_ID,
  courseRow,
  createSqlite,
  insertSql,
  scheduleRow,
  semesterRow,
  tableNames,
  userRow,
  weekRange,
} from './helpers.ts';

function sample(): {
  semester: SemesterRow;
  course: CourseRow;
  schedule: CourseScheduleRow;
} {
  return {
    semester: semesterRow(),
    course: courseRow('c-1', '高等数学', { short_name: '高数', location: '教三-201' }),
    schedule: scheduleRow('s-1', 'c-1', weekRange(1, 16), { day_of_week: 1, period_start: 1, period_end: 2 }),
  };
}

test('DDL 建表与约束', () => {
  const db = createSqlite();
  assert.equal(tableNames(db).length, 8);

  insertSql(db, 'users', { id: USER_ID, nickname: '我', created_at: NOW, updated_at: NOW });
  insertSql(db, 'semesters', {
    id: SEMESTER_ID,
    user_id: USER_ID,
    name: '第一学期',
    start_date: '2026-09-07',
    total_weeks: 20,
    is_active: 1,
    created_at: NOW,
    updated_at: NOW,
  });
  insertSql(db, 'courses', {
    id: 'c-1',
    semester_id: SEMESTER_ID,
    name: '高等数学',
    color: '#4F8DFD',
    created_at: NOW,
    updated_at: NOW,
  });

  const bad = (row: Record<string, string | number | null>): void =>
    insertSql(db, 'course_schedules', {
      course_id: 'c-1',
      weeks_mask: 1,
      created_at: NOW,
      updated_at: NOW,
      ...row,
    });

  assert.throws(() => bad({ id: 'x1', day_of_week: 1, period_start: 5, period_end: 3 }));
  assert.throws(() => bad({ id: 'x2', day_of_week: 8, period_start: 1, period_end: 2 }));
  assert.throws(() => bad({ id: 'x3', day_of_week: 1, period_start: 1, period_end: 2, weeks_mask: 0 }));
  assert.throws(() => bad({ id: 'x4', course_id: 'nope', day_of_week: 1, period_start: 1, period_end: 2 }));
  assert.throws(() =>
    insertSql(db, 'events', {
      id: 'e1',
      user_id: USER_ID,
      semester_id: SEMESTER_ID,
      type: 'holiday',
      title: '放假',
      created_at: NOW,
      updated_at: NOW,
    }),
  );
  assert.throws(() =>
    insertSql(db, 'events', {
      id: 'e2',
      user_id: USER_ID,
      semester_id: SEMESTER_ID,
      type: 'temp',
      title: '临时',
      priority: 1,
      created_at: NOW,
      updated_at: NOW,
    }),
  );
  assert.throws(() =>
    insertSql(db, 'reminders', {
      id: 'r1',
      user_id: USER_ID,
      target_type: 'course',
      target_id: 'c-1',
      advance_minutes: 1441,
      created_at: NOW,
      updated_at: NOW,
    }),
  );
});

test('级联删除', () => {
  const db = createSqlite();
  insertSql(db, 'users', { id: USER_ID, nickname: '我', created_at: NOW, updated_at: NOW });
  insertSql(db, 'semesters', {
    id: SEMESTER_ID,
    user_id: USER_ID,
    name: '第一学期',
    start_date: '2026-09-07',
    total_weeks: 20,
    is_active: 1,
    created_at: NOW,
    updated_at: NOW,
  });
  insertSql(db, 'courses', {
    id: 'c-1',
    semester_id: SEMESTER_ID,
    name: '高等数学',
    color: '#4F8DFD',
    created_at: NOW,
    updated_at: NOW,
  });
  insertSql(db, 'course_schedules', {
    id: 's-1',
    course_id: 'c-1',
    day_of_week: 1,
    period_start: 1,
    period_end: 2,
    weeks_mask: 65535,
    created_at: NOW,
    updated_at: NOW,
  });
  insertSql(db, 'events', {
    id: 'e-mv',
    user_id: USER_ID,
    semester_id: SEMESTER_ID,
    type: 'reschedule',
    title: '改期',
    on_date: '2026-09-21',
    ref_schedule_id: 's-1',
    action: 'cancel',
    created_at: NOW,
    updated_at: NOW,
  });

  db.run('DELETE FROM courses WHERE id = ?', ['c-1']);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM course_schedules')?.n, 0);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n, 0);
});

test('sqliteStorage 作为统一存储接口可用', async () => {
  const db = createSqlite();
  const storage = sqliteStorage(db);
  const data = sample();

  await storage.collection<UserRow>('users').put(userRow());
  await storage.collection<SemesterRow>('semesters').put(data.semester);
  await storage.collection<CourseRow>('courses').put(data.course);
  await storage.collection<CourseScheduleRow>('course_schedules').put(data.schedule);

  assert.equal((await activeSemester(storage, USER_ID))?.id, SEMESTER_ID);
  const monday = await weekView(storage, SEMESTER_ID, 1, 3);
  assert.equal(monday.length, 1);
  assert.equal(monday[0]?.name, '高等数学');
  assert.deepEqual(await weekView(storage, SEMESTER_ID, 1, 17), []);

  await storage.writeMeta('time_zone', 'Asia/Shanghai');
  assert.equal(await storage.readMeta('time_zone'), 'Asia/Shanghai');
});

test('sqliteStorage 的 put 是 upsert', async () => {
  const db = createSqlite();
  const storage = sqliteStorage(db);
  const data = sample();
  await storage.collection<UserRow>('users').put(userRow());
  await storage.collection<SemesterRow>('semesters').put(data.semester);
  await storage.collection<CourseRow>('courses').put(data.course);
  await storage.collection<CourseRow>('courses').put({ ...data.course, name: '高等数学（改）' });
  const rows = await storage.collection<CourseRow>('courses').getAll();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.name, '高等数学（改）');

  await storage.collection<CourseRow>('courses').delete('c-1');
  assert.equal((await storage.collection<CourseRow>('courses').getAll()).length, 0);
});
