import test from 'node:test';
import assert from 'node:assert/strict';
import { openNodeSqlite } from '../src/drivers/node-sqlite.ts';
import { migrate, readMeta, readSchemaVersion, writeMeta } from '../src/migrate.ts';
import { createSqlite, initSql, tableNames } from './helpers.ts';

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
  assert.equal(await readSchemaVersion(db), '001_init');
});

test('迁移可重复执行', async () => {
  const db = openNodeSqlite(':memory:');
  const migrations = [{ id: '001_init', sql: initSql() }];
  assert.equal(await migrate(db, migrations), '001_init');
  assert.equal(await migrate(db, migrations), '001_init');
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
