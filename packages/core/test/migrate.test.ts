import test from 'node:test';
import assert from 'node:assert/strict';
import { openNodeSqlite } from '../src/drivers/node-sqlite.ts';
import { migrate, readMeta, readSchemaVersion, writeMeta } from '../src/migrate.ts';
import { createSqlite, initSql, migrations, tableNames } from './helpers.ts';

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
  assert.equal(await readSchemaVersion(db), '002_event_kinds');
});

test('迁移可重复执行', async () => {
  const db = openNodeSqlite(':memory:');
  const list = migrations();
  assert.equal(await migrate(db, list), '002_event_kinds');
  assert.equal(await migrate(db, list), '002_event_kinds');
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
  assert.equal(await migrate(db, migrations()), '002_event_kinds');
  const row = await db.get<{ countdown: number; manual_done: number; title: string }>(
    "SELECT countdown, manual_done, title FROM events WHERE id = 'old-exam'",
  );
  assert.equal(row?.title, '旧考试');
  assert.equal(row?.countdown, 1);
  assert.equal(row?.manual_done, 0);
  const legacy = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%legacy%'");
  assert.deepEqual(legacy, []);
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
