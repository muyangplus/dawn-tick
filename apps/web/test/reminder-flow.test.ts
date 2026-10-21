import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  addDays,
  computeReminders,
  createCourse,
  createEvent,
  createSchedule,
  createSemester,
  dayOfWeek,
  formatDate,
  loadReminderData,
  setReminder,
  updateEvent,
  validatedStorage,
  weekOfDate,
  weekStart,
  type Storage,
} from '@dawn-tick/core';
import { openIndexedDbStorage } from '../src/db/idb-storage.ts';
import { collect } from '../src/reminder-collect.ts';

const USER_ID = 'u1';
const TIME_ZONE = 'Asia/Shanghai';

async function open(name: string): Promise<Storage> {
  return validatedStorage(await openIndexedDbStorage(name));
}

async function seedTodayLesson(storage: Storage): Promise<void> {
  const today = formatDate(Date.now(), TIME_ZONE);
  const start = weekStart(today);
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
    location: '教三-201',
  });
  await createSchedule(storage, {
    courseId: String(course['id']),
    dayOfWeek: dayOfWeek(today),
    periodStart: 1,
    periodEnd: 2,
    weeks: Array.from({ length: 20 }, (_, index) => index + 1),
  });
  return undefined;
}

async function remindersFor(storage: Storage): Promise<ReturnType<typeof computeReminders>> {
  const semester = await storage.collection<Record<string, unknown>>('semesters').getAll();
  const semesterId = String(semester[0]?.['id']);
  const today = formatDate(Date.now(), TIME_ZONE);
  const data = await loadReminderData(storage, semesterId, today, addDays(today, 7));
  assert.ok(data !== undefined);
  return computeReminders({
    occurrences: data.occurrences,
    reminders: data.reminders,
    events: data.events,
    dayKinds: data.dayKinds,
    timeZone: data.timeZone,
    now: Date.now(),
    horizonMs: 8 * 24 * 60 * 60 * 1000,
  });
}

test('未设置提醒时没有待触发提醒', async () => {
  const storage = await open('reminder-none');
  await seedTodayLesson(storage);
  const items = await remindersFor(storage);
  assert.equal(items.filter((item) => item.startsAt > Date.now()).length, 0);
});

test('通过接口设置提醒后能算出待触发提醒', async () => {
  const storage = await open('reminder-set');
  await seedTodayLesson(storage);
  const courses = await storage.collection<Record<string, unknown>>('courses').getAll();
  const courseId = String(courses[0]?.['id']);

  await setReminder(storage, {
    userId: USER_ID,
    targetType: 'course',
    targetId: courseId,
    advanceMinutes: 15,
    skipHolidays: true,
    snoozeMinutes: 5,
  });

  const items = await remindersFor(storage);
  const upcoming = items.filter((item) => item.startsAt > Date.now());
  assert.ok(upcoming.length >= 1, '本周同一节次应产生提醒');
  const first = upcoming[0];
  assert.equal(first?.advanceMinutes, 15);
  assert.equal(first?.snoozeMinutes, 5);
  assert.equal(first?.startsAt - (first?.triggerAt ?? 0), 15 * 60_000);
});

test('重复设置同一目标只保留一条提醒', async () => {
  const storage = await open('reminder-cover');
  await seedTodayLesson(storage);
  const courses = await storage.collection<Record<string, unknown>>('courses').getAll();
  const courseId = String(courses[0]?.['id']);

  await setReminder(storage, { userId: USER_ID, targetType: 'course', targetId: courseId, advanceMinutes: 5 });
  await setReminder(storage, { userId: USER_ID, targetType: 'course', targetId: courseId, advanceMinutes: 30 });

  const rows = await storage.collection<Record<string, unknown>>('reminders').getAll();
  const active = rows.filter((row) => row['deleted_at'] === null);
  assert.equal(active.length, 1);
  assert.equal(active[0]?.['advance_minutes'], 30);
});

test('默认设置仍可用于提醒计算', async () => {
  const storage = await open('reminder-defaults');
  await seedTodayLesson(storage);
  const items = await remindersFor(storage);
  assert.ok(Array.isArray(items));
  assert.equal(DEFAULT_SETTINGS.timeZone, TIME_ZONE);
});

test('已完成的日程不再进入投递队列', async () => {
  const storage = await open('reminder-done');
  await seedTodayLesson(storage);
  const semesters = await storage.collection<Record<string, unknown>>('semesters').getAll();
  const semesterId = String(semesters[0]?.['id']);
  const today = formatDate(Date.now(), TIME_ZONE);
  const exam = await createEvent(storage, {
    userId: USER_ID,
    semesterId,
    type: 'exam',
    title: '期末模拟考',
    onDate: today,
    startAt: Date.now() + 2 * 60 * 60 * 1000,
  });
  await setReminder(storage, {
    userId: USER_ID,
    targetType: 'event',
    targetId: String(exam['id']),
    advanceMinutes: 30,
    skipHolidays: true,
  });

  const before = await collect(storage, semesterId, TIME_ZONE, { enabled: false, minutes: 10 });
  const hit = before.find((item) => item.targetId === String(exam['id']));
  assert.ok(hit !== undefined, '未完成的考试应在投递队列里');
  assert.equal(hit?.kind, 'exam');

  await updateEvent(storage, String(exam['id']), { done: 1 });
  const after = await collect(storage, semesterId, TIME_ZONE, { enabled: false, minutes: 10 });
  assert.equal(
    after.some((item) => item.targetId === String(exam['id'])),
    false,
    '已完成条目不应再次提醒',
  );
});
