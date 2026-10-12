import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUMN_ALIASES, TABLE_COLUMNS, camelToSnake, normalizeRow, toColumnName } from '../src/columns.ts';
import { sqliteStorage } from '../src/sqlite-storage.ts';
import { STORE_NAMES } from '../src/storage.ts';
import {
  createCourse,
  createEvent,
  createSchedule,
  createSemester,
  setReminder,
  updateCourse,
  updateEvent,
  updateSchedule,
  updateSemester,
  updateTimeSlot,
} from '../src/mutations.ts';
import { START_DATE, USER_ID, createSqlite } from './helpers.ts';

type Row = Record<string, unknown>;

/** SQLite 上的一个学期（含默认节次），其余数据由各用例自己造。 */
async function sqliteStorageWithSemester(): Promise<{
  db: Awaited<ReturnType<typeof createSqlite>>;
  storage: ReturnType<typeof sqliteStorage>;
  semesterId: string;
}> {
  const db = await createSqlite();
  const storage = sqliteStorage(db);
  const semester = await createSemester(storage, {
    userId: USER_ID,
    name: '第一学期',
    startDate: START_DATE,
    totalWeeks: 18,
  });
  return { db, storage, semesterId: String(semester['id']) };
}

async function columnsOf(db: Awaited<ReturnType<typeof createSqlite>>, table: string): Promise<string[]> {
  const rows = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((row) => row.name);
}

test('列名映射表与 001_init.sql 的实际列名一致', async () => {
  const db = await createSqlite();
  for (const store of STORE_NAMES) {
    assert.deepEqual(
      (await columnsOf(db, store)).sort(),
      [...TABLE_COLUMNS[store]].sort(),
      `${store} 的列名与建表语句不一致`,
    );
  }
});

test('驼峰字段映射到真实列名，下划线列名原样通过', () => {
  assert.equal(toColumnName('courses', 'shortName'), 'short_name');
  assert.equal(toColumnName('courses', 'short_name'), 'short_name');
  assert.equal(toColumnName('courses', 'color'), 'color');
  assert.equal(toColumnName('semesters', 'startDate'), 'start_date');
  assert.equal(toColumnName('course_schedules', 'periodEnd'), 'period_end');
  assert.equal(toColumnName('events', 'asDayOfWeek'), 'as_day_of_week');
  assert.equal(toColumnName('time_slots', 'startTime'), 'start_time');
  assert.equal(toColumnName('reminders', 'advanceMinutes'), 'advance_minutes');

  assert.equal(camelToSnake('shortName'), 'short_name');
  assert.equal(camelToSnake('asDayOfWeek'), 'as_day_of_week');
  assert.equal(camelToSnake('short_name'), 'short_name');

  // 显式映射里的每个别名都必须落在真实列上
  for (const store of STORE_NAMES) {
    for (const [alias, column] of Object.entries(COLUMN_ALIASES[store])) {
      assert.ok(TABLE_COLUMNS[store].includes(column), `${store}.${alias} → ${column} 不是真实列`);
      assert.equal(toColumnName(store, alias), column);
    }
  }

  // 拼错的名字宁可返回 null，也不要漏到 SQL 里
  assert.equal(toColumnName('courses', 'shortNam'), null);
  assert.equal(toColumnName('courses', 'semester'), null);
  assert.throws(() => normalizeRow('courses', { shortNam: 'x' }), /short_name/);
});

// 复现用户报错：编辑课程颜色时 course-form.tsx 传的是驼峰 payload，
// 修复前这条会以 `table courses has no column named shortName` 失败。
test('编辑课程颜色与其它字段（驼峰入参）在真实 SQLite 上写入成功', async () => {
  const { db, storage, semesterId } = await sqliteStorageWithSemester();
  const course = await createCourse(storage, {
    semesterId,
    name: '高等数学',
    shortName: '高数',
    color: '#4F8DFD',
  });

  const updated = await updateCourse(storage, String(course['id']), {
    name: '高等数学（改）',
    shortName: '高数改',
    teacher: '张老师',
    location: '教三-201',
    color: '#F2994A',
    credits: 3.5,
    note: '带上课本',
  });

  // 返回值里只有真实列名，不该残留驼峰键
  assert.equal(updated['color'], '#F2994A');
  assert.equal(updated['short_name'], '高数改');
  assert.equal('shortName' in updated, false);
  assert.equal(updated['rev'], 1);
  assert.equal(updated['dirty'], 1);

  // 重新从 SQLite 读回来核对每一列
  const row = await storage.collection<Row>('courses').get(String(course['id']));
  assert.equal(row?.['name'], '高等数学（改）');
  assert.equal(row?.['short_name'], '高数改');
  assert.equal(row?.['teacher'], '张老师');
  assert.equal(row?.['location'], '教三-201');
  assert.equal(row?.['color'], '#F2994A');
  assert.equal(row?.['credits'], 3.5);
  assert.equal(row?.['note'], '带上课本');
  assert.equal(row?.['semester_id'], semesterId);

  // 表结构里根本没有驼峰列，说明上面确实是写进了 short_name
  assert.deepEqual(await columnsOf(db, 'courses'), [...TABLE_COLUMNS.courses]);
  assert.ok(!(await columnsOf(db, 'courses')).includes('shortName'));
});

test('课程字段逐个用驼峰名写入 SQLite', async () => {
  const { storage, semesterId } = await sqliteStorageWithSemester();
  const course = await createCourse(storage, { semesterId, name: '大学物理' });
  const id = String(course['id']);

  await updateCourse(storage, id, { shortName: '大物' });
  assert.equal((await storage.collection<Row>('courses').get(id))?.['short_name'], '大物');
  await updateCourse(storage, id, { teacher: '李老师' });
  assert.equal((await storage.collection<Row>('courses').get(id))?.['teacher'], '李老师');
  await updateCourse(storage, id, { location: '理科楼-105' });
  assert.equal((await storage.collection<Row>('courses').get(id))?.['location'], '理科楼-105');
  await updateCourse(storage, id, { credits: 2.5 });
  assert.equal((await storage.collection<Row>('courses').get(id))?.['credits'], 2.5);
  await updateCourse(storage, id, { note: '闭卷' });
  assert.equal((await storage.collection<Row>('courses').get(id))?.['note'], '闭卷');
  await updateCourse(storage, id, { color: '#27AE60' });
  assert.equal((await storage.collection<Row>('courses').get(id))?.['color'], '#27AE60');
  // 下划线写法保持兼容
  await updateCourse(storage, id, { short_name: '大物2' });
  assert.equal((await storage.collection<Row>('courses').get(id))?.['short_name'], '大物2');
  await updateCourse(storage, id, { shortName: null });
  assert.equal((await storage.collection<Row>('courses').get(id))?.['short_name'], null);
});

test('其它表的驼峰入参同样写入真实列', async () => {
  const { storage, semesterId } = await sqliteStorageWithSemester();

  const semester = await updateSemester(storage, semesterId, {
    name: '第二学期',
    startDate: '2027-02-22',
    totalWeeks: 20,
    timeZone: 'Asia/Tokyo',
    isActive: 0,
  });
  assert.equal(semester['start_date'], '2027-02-22');
  assert.equal(semester['total_weeks'], 20);
  assert.equal(semester['time_zone'], 'Asia/Tokyo');
  assert.equal(semester['is_active'], 0);
  assert.equal('startDate' in semester, false);

  const slot = (await storage.collection<Row>('time_slots').getAll())[0];
  assert.ok(slot !== undefined);
  const slotUpdated = await updateTimeSlot(storage, String(slot['id']), {
    startTime: '10:20',
    endTime: '11:05',
  });
  assert.equal(slotUpdated['start_time'], '10:20');
  assert.equal(slotUpdated['end_time'], '11:05');
  assert.equal(slotUpdated['section'], 'am');

  const course = await createCourse(storage, { semesterId, name: '线性代数', shortName: '线代' });
  const schedule = await createSchedule(storage, {
    courseId: String(course['id']),
    dayOfWeek: 2,
    periodStart: 1,
    periodEnd: 2,
    weeks: [1, 2, 3],
  });
  const scheduleUpdated = await updateSchedule(storage, String(schedule['id']), {
    dayOfWeek: 4,
    periodStart: 5,
    periodEnd: 6,
    weeksMask: 7,
    weeksRaw: '1-3周',
    room: '教三-301',
  });
  assert.equal(scheduleUpdated['day_of_week'], 4);
  assert.equal(scheduleUpdated['period_start'], 5);
  assert.equal(scheduleUpdated['period_end'], 6);
  assert.equal(scheduleUpdated['weeks_mask'], 7);
  assert.equal(scheduleUpdated['weeks_raw'], '1-3周');
  assert.equal(scheduleUpdated['room'], '教三-301');

  const event = await createEvent(storage, { userId: USER_ID, type: 'todo', title: '交作业' });
  const eventUpdated = await updateEvent(storage, String(event['id']), {
    done: 1,
    note: '周五前',
    priority: 2,
    dueAt: 1790000000000,
  });
  assert.equal(eventUpdated['done'], 1);
  assert.equal(eventUpdated['note'], '周五前');
  assert.equal(eventUpdated['priority'], 2);
  assert.equal(eventUpdated['due_at'], 1790000000000);

  const reminder = await setReminder(storage, {
    userId: USER_ID,
    targetType: 'course',
    targetId: String(course['id']),
    advanceMinutes: 15,
    skipHolidays: false,
    snoozeMinutes: 5,
  });
  assert.equal(reminder['advance_minutes'], 15);
  assert.equal(reminder['skip_holidays'], 0);
  assert.equal(reminder['snooze_minutes'], 5);

  // 写库之后不许留下任何驼峰键
  for (const store of STORE_NAMES) {
    const allowed = new Set(TABLE_COLUMNS[store]);
    for (const row of await storage.collection<Row>(store).getAll()) {
      for (const key of Object.keys(row)) {
        assert.ok(allowed.has(key), `${store} 里出现了非列名的键 ${key}`);
      }
    }
  }
});

test('sqliteStorage 直接 put 驼峰键也会落到真实列', async () => {
  const { storage, semesterId } = await sqliteStorageWithSemester();
  await storage.collection<Row>('courses').put({
    id: 'c-direct',
    semesterId,
    name: '数据库原理',
    shortName: '数据库',
    teacher: null,
    location: null,
    color: '#4F8DFD',
    credits: null,
    note: null,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    rev: 0,
    dirty: 1,
  });

  const row = await storage.collection<Row>('courses').get('c-direct');
  assert.equal(row?.['short_name'], '数据库');
  assert.equal(row?.['semester_id'], semesterId);
  assert.equal(row?.['name'], '数据库原理');
  assert.equal('shortName' in (row ?? {}), false);
});

test('未知列名抛出可读错误，而不是 SQLite 的 no column named', async () => {
  const { db, storage, semesterId } = await sqliteStorageWithSemester();
  const course = await createCourse(storage, { semesterId, name: '概率论' });

  await assert.rejects(
    () => updateCourse(storage, String(course['id']), { shortNam: '概率' }),
    (error: unknown) => error instanceof TypeError && /courses 没有列 "shortNam"/.test((error as Error).message),
  );
  await assert.rejects(
    () =>
      storage.collection<Row>('courses').put({
        id: 'c-bad',
        semester_id: semesterId,
        name: '错列',
        color: '#4F8DFD',
        typoColumn: 1,
        created_at: 1,
        updated_at: 1,
      }),
    TypeError,
  );
  // 报错的行没有被写进去
  assert.equal(await storage.collection<Row>('courses').get('c-bad'), undefined);

  // 直接跑原生 SQL 时才是原来的 SQLite 报错（对照）
  await assert.rejects(
    () => db.run('INSERT INTO courses (id, semester_id, name, shortName, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [
      'c-raw',
      semesterId,
      '原生',
      '原生',
      '#4F8DFD',
      1,
      1,
    ]),
    /no column named shortName/,
  );
});
