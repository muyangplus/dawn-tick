import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const SCHEMA = readFileSync(
  new URL('../../../packages/core/src/schema/001_init.sql', import.meta.url),
  'utf8',
);
const NOW = 1759900000000;

async function openDb() {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  db.exec(SCHEMA);
  return { sqlite3, db };
}

test('WASM SQLite 引擎版本可用', async () => {
  const { sqlite3, db } = await openDb();
  const version = sqlite3.version.libVersion;
  assert.equal(typeof version, 'string');
  assert.ok(version.startsWith('3.'), `SQLite 版本异常: ${version}`);
  db.close();
});

test('WASM SQLite 建表', async () => {
  const { db } = await openDb();
  const tables = db.selectValues(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  assert.deepEqual(tables, [
    'app_meta',
    'course_schedules',
    'courses',
    'events',
    'reminders',
    'semesters',
    'time_slots',
    'users',
  ]);
  db.close();
});

test('时刻列为 INTEGER，日期与墙钟为 TEXT', async () => {
  const { db } = await openDb();
  const columns = db.selectArrays("SELECT name, type FROM pragma_table_info('events')");
  const typeOf = (name) => columns.find(([column]) => column === name)?.[1];
  assert.equal(typeOf('start_at'), 'INTEGER');
  assert.equal(typeOf('end_at'), 'INTEGER');
  assert.equal(typeOf('due_at'), 'INTEGER');
  assert.equal(typeOf('on_date'), 'TEXT');
  assert.equal(typeOf('new_date'), 'TEXT');
  db.close();
});

test('位图周视图查询', async () => {
  const { db } = await openDb();
  db.exec(`
    INSERT INTO users (id,nickname,created_at,updated_at) VALUES ('u1','我',${NOW},${NOW});
    INSERT INTO semesters (id,user_id,name,start_date,total_weeks,is_active,created_at,updated_at)
      VALUES ('sem-1','u1','第一学期','2026-09-07',20,1,${NOW},${NOW});
    INSERT INTO courses (id,semester_id,name,color,created_at,updated_at)
      VALUES ('c-1','sem-1','高等数学','#4F8DFD',${NOW},${NOW});
    INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,created_at,updated_at)
      VALUES ('s-1','c-1',1,1,2,65535,${NOW},${NOW});
  `);
  const query = `
    SELECT c.name AS name,
           (cs.weeks_mask >> (? - 1)) & 1 AS hit
    FROM course_schedules cs
    JOIN courses c ON c.id = cs.course_id
    WHERE c.semester_id = 'sem-1' AND cs.day_of_week = 1
      AND cs.deleted_at IS NULL AND c.deleted_at IS NULL`;
  const week3 = db.selectArrays(query, [3]);
  assert.deepEqual(week3, [['高等数学', 1]]);
  const week17 = db.selectArrays(query, [17]);
  assert.deepEqual(week17, [['高等数学', 0]]);
  db.close();
});

test('约束拦截脏数据', async () => {
  const { db } = await openDb();
  db.exec(`
    INSERT INTO users (id,nickname,created_at,updated_at) VALUES ('u1','我',0,0);
    INSERT INTO semesters (id,user_id,name,start_date,total_weeks,is_active,created_at,updated_at)
      VALUES ('sem-1','u1','第一学期','2026-09-07',20,1,0,0);
    INSERT INTO courses (id,semester_id,name,color,created_at,updated_at)
      VALUES ('c-1','sem-1','高等数学','#4F8DFD',0,0);
  `);

  assert.throws(() =>
    db.exec(
      "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,created_at,updated_at) VALUES ('x1','c-1',1,5,3,1,0,0)",
    ),
  );
  assert.throws(() =>
    db.exec(
      "INSERT INTO course_schedules (id,course_id,day_of_week,period_start,period_end,weeks_mask,created_at,updated_at) VALUES ('x2','c-1',8,1,2,1,0,0)",
    ),
  );
  assert.throws(() =>
    db.exec(
      "INSERT INTO events (id,user_id,semester_id,type,title,created_at,updated_at) VALUES ('e1','u1','sem-1','holiday','国庆',0,0)",
    ),
  );
  assert.throws(() =>
    db.exec(
      "INSERT INTO events (id,user_id,semester_id,type,title,priority,created_at,updated_at) VALUES ('e2','u1','sem-1','temp','班会',1,0,0)",
    ),
  );
  db.close();
});
