import test from 'node:test';
import assert from 'node:assert/strict';
import { openNodeSqlite } from '../src/drivers/node-sqlite.ts';
import { migrate, readMeta, readSchemaVersion, writeMeta } from '../src/migrate.ts';
import { createSqlite, eventKindsSql, initSql, migrations, tableNames } from './helpers.ts';

test('迁移建立全部表并记录版本', async () => {
  const db = await createSqlite();
  assert.deepEqual(await tableNames(db), [
    'app_meta',
    'course_schedules',
    'courses',
    'events',
    'reminders',
    'semesters',
    'time_slots',
    'users',
  ]);
  assert.equal(await readSchemaVersion(db), '005_due_at_any');
});

test('迁移可重复执行', async () => {
  const db = openNodeSqlite(':memory:');
  const list = migrations();
  assert.equal(await migrate(db, list), '005_due_at_any');
  assert.equal(await migrate(db, list), '005_due_at_any');
});

test('002 迁移保留旧库数据并补齐新列', async () => {
  const db = openNodeSqlite(':memory:');
  await migrate(db, [{ id: '001_init', sql: initSql() }]);
  await db.run(
    `INSERT INTO users (id, nickname, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ['u1', '我', 1, 1],
  );
  await db.run(
    `INSERT INTO events (id, user_id, type, title, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['old-exam', 'u1', 'exam', '旧考试', 0, 1, 1],
  );
  assert.equal(await migrate(db, migrations()), '005_due_at_any');
  const row = await db.get<{ countdown: number; manual_done: number; title: string }>(
    "SELECT countdown, manual_done, title FROM events WHERE id = 'old-exam'",
  );
  assert.equal(row?.title, '旧考试');
  assert.equal(row?.countdown, 1);
  assert.equal(row?.manual_done, 0);
  const legacy = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%legacy%'");
  assert.deepEqual(legacy, []);
});

test('003 迁移为自定义时间加列且老数据保留', async () => {
  const db = openNodeSqlite(':memory:');
  await migrate(db, [{ id: '001_init', sql: initSql() }]);
  await db.run(`INSERT INTO users (id, nickname, created_at, updated_at) VALUES (?, ?, ?, ?)`, ['u2', '我', 1, 1]);
  await db.run(
    `INSERT INTO semesters (id, user_id, name, start_date, total_weeks, time_zone, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['sem-2', 'u2', '旧学期', '2026-09-07', 20, 'Asia/Shanghai', 1, 1, 1],
  );
  await db.run(
    `INSERT INTO courses (id, semester_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ['c-old', 'sem-2', '旧课', '#123456', 1, 1],
  );
  await db.run(
    `INSERT INTO course_schedules (id, course_id, day_of_week, period_start, period_end, weeks_mask, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['s-old', 'c-old', 2, 1, 2, 3, 1, 1],
  );
  assert.equal(await migrate(db, migrations()), '005_due_at_any');
  const eventCols = (await db.all<{ name: string }>("PRAGMA table_info(events)")).map((row) => row.name);
  const scheduleCols = (await db.all<{ name: string }>("PRAGMA table_info(course_schedules)")).map((row) => row.name);
  assert.ok(eventCols.includes('start_time') && eventCols.includes('end_time'));
  assert.ok(scheduleCols.includes('start_time') && scheduleCols.includes('end_time'));
  await db.run(`UPDATE course_schedules SET start_time = ?, end_time = ? WHERE id = 's-old'`, ['19:00', '21:00']);
  const row = await db.get<{ room: string | null; start_time: string }>(
    "SELECT room, start_time FROM course_schedules WHERE id = 's-old'",
  );
  assert.equal(row?.start_time, '19:00');
  assert.equal(row?.room, null);
});

test('004 迁移默认不占课表并把实验回填为显示', async () => {
  const db = openNodeSqlite(':memory:');
  await migrate(db, [
    { id: '001_init', sql: initSql() },
    { id: '002_event_kinds', sql: eventKindsSql() },
  ]);
  await db.run(`INSERT INTO users (id, nickname, created_at, updated_at) VALUES (?, ?, ?, ?)`, ['u3', '我', 1, 1]);
  await db.run(
    `INSERT INTO events (id, user_id, type, title, on_date, period_start, period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['e-lab', 'u3', 'lab', '物理实验', '2026-10-13', 3, 4, 1, 1],
  );
  await db.run(
    `INSERT INTO events (id, user_id, type, title, on_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['e-todo', 'u3', 'todo', '交作业', '2026-10-13', 1, 1],
  );
  assert.equal(await migrate(db, migrations()), '005_due_at_any');
  const lab = await db.get<{ show_in_timetable: number }>("SELECT show_in_timetable FROM events WHERE id = 'e-lab'");
  const todo = await db.get<{ show_in_timetable: number }>("SELECT show_in_timetable FROM events WHERE id = 'e-todo'");
  assert.equal(lab?.show_in_timetable, 1);
  assert.equal(todo?.show_in_timetable, 0);
});

test('外键开关在连接建立时生效', async () => {
  const db = await createSqlite();
  assert.equal((await db.get<{ foreign_keys: number }>('PRAGMA foreign_keys'))?.foreign_keys, 1);
});

test('app_meta 读写', async () => {
  const db = await createSqlite();
  await writeMeta(db, 'time_zone', 'Asia/Shanghai');
  assert.equal(await readMeta(db, 'time_zone'), 'Asia/Shanghai');
  await writeMeta(db, 'time_zone', 'America/New_York');
  assert.equal(await readMeta(db, 'time_zone'), 'America/New_York');
  assert.equal(await readMeta(db, 'missing'), undefined);
});
