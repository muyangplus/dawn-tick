import test from 'node:test';
import assert from 'node:assert/strict';
import { openNodeSqlite } from '../src/drivers/node-sqlite.ts';
import { migrate, readMeta, readSchemaVersion, writeMeta } from '../src/migrate.ts';
import { createDb, initSql, tableNames } from './helpers.ts';

test('迁移建立全部表并记录版本', () => {
  const db = createDb();
  assert.deepEqual(tableNames(db), [
    'app_meta',
    'course_schedules',
    'courses',
    'events',
    'reminders',
    'semesters',
    'time_slots',
    'users',
  ]);
  assert.equal(readSchemaVersion(db), '001_init');
});

test('迁移可重复执行', () => {
  const db = openNodeSqlite(':memory:');
  const migrations = [{ id: '001_init', sql: initSql() }];
  assert.equal(migrate(db, migrations), '001_init');
  assert.equal(migrate(db, migrations), '001_init');
});

test('外键开关在连接建立时生效', () => {
  const db = createDb();
  assert.equal(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys, 1);
});

test('app_meta 读写', () => {
  const db = createDb();
  writeMeta(db, 'time_zone', 'Asia/Shanghai');
  assert.equal(readMeta(db, 'time_zone'), 'Asia/Shanghai');
  writeMeta(db, 'time_zone', 'America/New_York');
  assert.equal(readMeta(db, 'time_zone'), 'America/New_York');
  assert.equal(readMeta(db, 'missing'), undefined);
});
