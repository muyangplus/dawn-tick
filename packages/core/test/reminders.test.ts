import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, nextReminder, snoozeUntil, type ReminderInput } from '../src/reminders.ts';
import { expand } from '../src/expand.ts';
import { loadExpandInput } from '../src/repository.ts';
import type { EventRow, ReminderRow } from '../src/types.ts';
import type { Storage } from '../src/storage.ts';
import { NOW, createStorage, eventRow, seedStorage } from './helpers.ts';

function reminder(overrides: Partial<ReminderRow> & Pick<ReminderRow, 'id' | 'target_id'>): ReminderRow {
  return {
    user_id: 'u1',
    target_type: 'course',
    advance_minutes: 10,
    enabled: 1,
    skip_holidays: 1,
    sound: 1,
    vibrate: 1,
    dnd: 0,
    snooze_minutes: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    rev: 0,
    dirty: 0,
    ...overrides,
  };
}

/** 2026-09-21 周一第 1 节 08:00（Asia/Shanghai）= 2026-09-21T00:00Z。 */
const MONDAY_0800 = Date.UTC(2026, 8, 21, 0, 0, 0);

async function buildInput(
  storage: Storage,
  reminders: ReminderRow[],
  events: EventRow[] = [],
  from = '2026-09-21',
  to = '2026-09-27',
): Promise<ReminderInput> {
  const expanded = await loadExpandInput(storage, 'sem-1', from, to);
  assert.ok(expanded !== undefined);
  return {
    occurrences: expand(expanded),
    reminders,
    events,
    dayKinds: expanded.dayKinds ?? [],
    now: MONDAY_0800 - 60 * 60 * 1000,
  };
}

test('课程级提醒按提前分钟计算触发时刻', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const items = computeReminders(await buildInput(storage, [reminder({ id: 'r-1', target_id: 'c-1', advance_minutes: 10 })]));

  const monday = items.filter((item) => item.startsAt === MONDAY_0800);
  assert.equal(monday.length, 1);
  assert.equal(monday[0]?.triggerAt, MONDAY_0800 - 10 * 60_000);
  assert.equal(monday[0]?.title, '高等数学');
  assert.equal(monday[0]?.source, 'course');
  assert.ok(monday[0]?.detail.includes('教三-201'));
});

test('排课级提醒优先于课程级', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const items = computeReminders(
    await buildInput(storage, [
      reminder({ id: 'r-course', target_id: 'c-1', advance_minutes: 10 }),
      reminder({ id: 'r-schedule', target_type: 'schedule', target_id: 's-1', advance_minutes: 30 }),
    ]),
  );
  const monday = items.filter((item) => item.startsAt === MONDAY_0800);
  assert.equal(monday.length, 1);
  assert.equal(monday[0]?.reminderId, 'r-schedule');
  assert.equal(monday[0]?.source, 'schedule');
  assert.equal(monday[0]?.triggerAt, MONDAY_0800 - 30 * 60_000);
});

test('未启用或无提醒时不产生条目', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  assert.deepEqual(computeReminders(await buildInput(storage, [])), []);
  assert.deepEqual(
    computeReminders(await buildInput(storage, [reminder({ id: 'r-off', target_id: 'c-1', enabled: 0 })])),
    [],
  );
});

test('超出前瞻窗口或已过时刻被忽略', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const base = await buildInput(storage, [reminder({ id: 'r-1', target_id: 'c-1', advance_minutes: 10 })]);

  const tooLate = computeReminders({ ...base, now: MONDAY_0800 + 60 * 60 * 1000 });
  assert.equal(tooLate.filter((item) => item.startsAt === MONDAY_0800).length, 0);

  const shortHorizon = computeReminders({ ...base, horizonMs: 60 * 1000 });
  assert.equal(shortHorizon.length, 0);
});

test('调课取消的课次不提醒，改期后按新时间提醒', async () => {
  const cancelStorage = createStorage();
  await seedStorage(cancelStorage);
  await cancelStorage
    .collection('events')
    .put(eventRow('e-c', 'reschedule', { on_date: '2026-09-21', ref_schedule_id: 's-1', action: 'cancel' }));
  const cancelled = computeReminders(
    await buildInput(cancelStorage, [reminder({ id: 'r-1', target_id: 'c-1' })]),
  );
  assert.equal(cancelled.filter((item) => item.startsAt === MONDAY_0800).length, 0);

  const moveStorage = createStorage();
  await seedStorage(moveStorage);
  await moveStorage.collection('events').put(
    eventRow('e-mv', 'reschedule', {
      on_date: '2026-09-21',
      ref_schedule_id: 's-1',
      action: 'move',
      new_date: '2026-09-22',
      new_period_start: 3,
      new_period_end: 4,
    }),
  );
  const moved = computeReminders(
    await buildInput(moveStorage, [reminder({ id: 'r-1', target_id: 'c-1', advance_minutes: 5 })], [], '2026-09-21', '2026-09-22'),
  );
  assert.equal(moved.length, 1);
  assert.equal(moved[0]?.startsAt, Date.UTC(2026, 8, 22, 2, 0, 0));
  assert.equal(moved[0]?.triggerAt, Date.UTC(2026, 8, 22, 2, 0, 0) - 5 * 60_000);
});

test('放假当天不提醒（调课与放假都经展开生效）', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage
    .collection('events')
    .put(eventRow('e-h', 'holiday', { on_date: '2026-09-21', source: 'builtin' }));
  const items = computeReminders(await buildInput(storage, [reminder({ id: 'r-1', target_id: 'c-1' })]));
  assert.equal(items.filter((item) => item.startsAt === MONDAY_0800).length, 0);
});

test('考试日程提醒与节假日跳过', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const exam = eventRow('e-exam', 'exam', {
    title: '高等数学期末',
    start_at: Date.UTC(2026, 8, 23, 1, 0, 0),
    location: '教三-201',
    subject: '高等数学',
  });
  const items = computeReminders(
    await buildInput(storage, [reminder({ id: 'r-exam', target_type: 'event', target_id: 'e-exam', advance_minutes: 30 })], [exam]),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.source, 'event');
  assert.equal(items[0]?.triggerAt, Date.UTC(2026, 8, 23, 1, 0, 0) - 30 * 60_000);

  const holidayStorage = createStorage();
  await seedStorage(holidayStorage);
  await holidayStorage
    .collection('events')
    .put(eventRow('e-h', 'holiday', { on_date: '2026-09-23', source: 'manual' }));
  const skipped = computeReminders(
    await buildInput(
      holidayStorage,
      [reminder({ id: 'r-exam', target_type: 'event', target_id: 'e-exam', advance_minutes: 30 })],
      [exam],
    ),
  );
  assert.equal(skipped.length, 0);
});

test('结果按触发时刻排序并可取最近一条', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const input = await buildInput(
    storage,
    [
      reminder({ id: 'r-1', target_id: 'c-1', advance_minutes: 10 }),
      reminder({ id: 'r-2', target_id: 'c-2', advance_minutes: 10 }),
      reminder({ id: 'r-3', target_id: 'c-3', advance_minutes: 10 }),
    ],
    [],
    '2026-09-21',
    '2026-09-30',
  );
  const items = computeReminders({ ...input, horizonMs: 14 * 24 * 60 * 60 * 1000 });
  assert.ok(items.length >= 3);
  for (let index = 1; index < items.length; index += 1) {
    assert.ok((items[index]?.triggerAt ?? 0) >= (items[index - 1]?.triggerAt ?? 0));
  }
  assert.equal(nextReminder(items, input.now)?.triggerAt, items[0]?.triggerAt);
});

test('贪睡时刻计算', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const items = computeReminders(
    await buildInput(storage, [reminder({ id: 'r-1', target_id: 'c-1', snooze_minutes: 5 })]),
  );
  const first = items[0];
  assert.ok(first !== undefined);
  assert.equal(snoozeUntil(first, 1000), 1000 + 5 * 60_000);
  assert.equal(snoozeUntil({ ...first, snoozeMinutes: null }, 1000), null);
});
