import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  createCourse,
  createSchedule,
  createSemester,
  dayOfWeek,
  formatDate,
  readSettings,
  validatedStorage,
  weekOfDate,
  weekStart,
  writeSettings,
  type Storage,
} from '@dawn-tick/core';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';
import { loadAppData } from '../src/data.ts';

const USER_ID = 'u1';
const TIME_ZONE = 'Asia/Shanghai';

async function open(name: string): Promise<Storage> {
  return validatedStorage(await openIndexedDbStorage(name));
}

test('首次启动：没有学期时返回空数据', async () => {
  const storage = await open('flow-empty');
  const data = await loadAppData(storage, DEFAULT_SETTINGS);
  assert.equal(data.semester, null);
  assert.deepEqual(data.todayLessons, []);
  assert.equal(data.nextLesson, undefined);
});

test('新建学期并加课后，周视图与今日视图都能看到', async () => {
  const storage = await open('flow-full');
  const today = formatDate(Date.now(), TIME_ZONE);
  const start = weekStart(today);
  const dow = dayOfWeek(today);
  const week = weekOfDate(today, start);

  const semester = await createSemester(storage, {
    userId: USER_ID,
    name: '测试学期',
    startDate: start,
    totalWeeks: 20,
    timeZone: TIME_ZONE,
  });
  const course = await createCourse(storage, {
    semesterId: String(semester['id']),
    name: '高等数学',
    shortName: '高数',
    location: '教三-201',
    color: '#4F8DFD',
  });
  await createSchedule(storage, {
    courseId: String(course['id']),
    dayOfWeek: dow,
    periodStart: 1,
    periodEnd: 2,
    weeks: [week],
  });

  const data = await loadAppData(storage, DEFAULT_SETTINGS);
  assert.notEqual(data.semester, null);
  assert.equal(data.week, week);
  assert.equal(data.todayOfWeek, dow);

  const cells = data.grid.get(`${dow}:1`) ?? [];
  assert.equal(cells.length, 1);
  assert.equal(cells[0]?.name, '高数');
  assert.equal(cells[0]?.room, '教三-201');

  assert.equal(data.todayLessons.length, 1);
  assert.equal(data.todayLessons[0]?.courseName, '高等数学');
  assert.ok(
    data.nextLesson === undefined || data.nextLesson.startAt > Date.now(),
    '下一节课要么不存在，要么在将来',
  );
});

test('设置可持久化并影响加载结果', async () => {
  const storage = await open('flow-settings');
  const saved = await writeSettings(storage, { viewDays: 7, theme: 'dark', themePreset: 'mono' });
  assert.equal(saved.viewDays, 7);
  assert.equal((await readSettings(storage)).themePreset, 'mono');

  await writeSettings(storage, { autoTimeZone: true });
  assert.equal((await readSettings(storage)).autoTimeZone, true);
});

test('软删除的课程不再出现在周视图', async () => {
  const storage = await open('flow-delete');
  const today = formatDate(Date.now(), TIME_ZONE);
  const start = weekStart(today);
  const dow = dayOfWeek(today);

  const semester = await createSemester(storage, {
    userId: USER_ID,
    name: '测试学期',
    startDate: start,
    timeZone: TIME_ZONE,
  });
  const course = await createCourse(storage, { semesterId: String(semester['id']), name: '大学物理' });
  await createSchedule(storage, {
    courseId: String(course['id']),
    dayOfWeek: dow,
    periodStart: 3,
    periodEnd: 4,
    weeks: [weekOfDate(today, start)],
  });

  assert.equal((await loadAppData(storage, DEFAULT_SETTINGS)).todayLessons.length, 1);

  const { deleteCourse } = await import('@dawn-tick/core');
  await deleteCourse(storage, String(course['id']));
  assert.equal((await loadAppData(storage, DEFAULT_SETTINGS)).todayLessons.length, 0);
});
