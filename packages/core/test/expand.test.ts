import test from 'node:test';
import assert from 'node:assert/strict';
import { currentOccurrence, expand, nextOccurrence, resolveDayKind, type ExpandDayKind, type ExpandInput } from '../src/expand.ts';
import { loadExpandInput } from '../src/repository.ts';
import type { Storage } from '../src/storage.ts';
import { SEMESTER_ID, createStorage, eventRow, seedStorage } from './kit/index.ts';

async function buildInput(storage: Storage, from: string, to: string): Promise<ExpandInput> {
  const input = await loadExpandInput(storage, SEMESTER_ID, from, to);
  assert.ok(input !== undefined);
  return input;
}

test('连续周次与节次时间换算为 UTC', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const items = expand(await buildInput(storage, '2026-09-21', '2026-09-21'));
  assert.equal(items.length, 1);
  const first = items[0];
  assert.ok(first !== undefined);
  assert.equal(first.courseName, '高等数学');
  assert.equal(first.periodStart, 1);
  assert.equal(first.periodEnd, 2);
  assert.equal(first.startAt, Date.UTC(2026, 8, 21, 0, 0, 0));
  assert.equal(first.endAt, Date.UTC(2026, 8, 21, 1, 40, 0));
  assert.equal(first.room, '教三-201');
});

test('单双周按周次集合过滤', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  assert.deepEqual(expand(await buildInput(storage, '2026-09-23', '2026-09-23')), []);
  const even = expand(await buildInput(storage, '2026-09-30', '2026-09-30'));
  assert.equal(even.length, 1);
  assert.equal(even[0]?.courseName, '大学物理');
});

test('碎片周次', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const counts: number[] = [];
  for (const date of ['2026-10-09', '2026-10-16', '2026-10-23']) {
    counts.push(expand(await buildInput(storage, date, date)).length);
  }
  assert.deepEqual(counts, [1, 0, 1]);
});

test('超出总周数不产生课次', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  assert.deepEqual(expand(await buildInput(storage, '2027-01-04', '2027-01-10')), []);
});

test('放假当天不排课', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage.collection('events').put(eventRow('e-h', 'holiday', { on_date: '2026-09-21', source: 'builtin' }));
  assert.deepEqual(expand(await buildInput(storage, '2026-09-21', '2026-09-21')), []);
});

test('调休补课按指定星期上课', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage
    .collection('events')
    .put(eventRow('e-m', 'makeup', { on_date: '2026-10-10', as_day_of_week: 1, source: 'from_school' }));
  const items = expand(await buildInput(storage, '2026-10-10', '2026-10-10'));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.courseName, '高等数学');
  assert.equal(items[0]?.date, '2026-10-10');
});

test('调课取消与改期', async () => {
  const cancelStorage = createStorage();
  await seedStorage(cancelStorage);
  await cancelStorage
    .collection('events')
    .put(eventRow('e-c', 'reschedule', { on_date: '2026-09-21', ref_schedule_id: 's-1', action: 'cancel' }));
  assert.deepEqual(expand(await buildInput(cancelStorage, '2026-09-21', '2026-09-21')), []);
  const withCancelled = expand({
    ...(await buildInput(cancelStorage, '2026-09-21', '2026-09-21')),
    includeCancelled: true,
  });
  assert.equal(withCancelled.length, 1);
  assert.equal(withCancelled[0]?.cancelled, true);

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
  const moved = expand(await buildInput(moveStorage, '2026-09-21', '2026-09-22'));
  assert.equal(moved.length, 1);
  assert.equal(moved[0]?.date, '2026-09-22');
  assert.equal(moved[0]?.periodStart, 3);
  assert.equal(moved[0]?.startAt, Date.UTC(2026, 8, 22, 2, 0, 0));
});

test('调课换教室', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage.collection('events').put(
    eventRow('e-r', 'reschedule', {
      on_date: '2026-09-21',
      ref_schedule_id: 's-1',
      action: 'room_change',
      new_room: '教三-305',
    }),
  );
  const items = expand(await buildInput(storage, '2026-09-21', '2026-09-21'));
  assert.equal(items[0]?.room, '教三-305');
});

test('下一节课取当前时刻之后的最近一次', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const items = expand(await buildInput(storage, '2026-09-14', '2026-10-30'));
  const next = nextOccurrence(items, Date.UTC(2026, 8, 21, 0, 30, 0));
  assert.ok(next !== undefined);
  // 09-25（周五）是内置中秋假期：大学英语停上，下一节顺延到下周一
  assert.equal(next.date, '2026-09-28');
  assert.equal(next.courseName, '高等数学');
});

test('正在上的课取开始已到、结束未到的那一节', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const items = expand(await buildInput(storage, '2026-09-14', '2026-10-30'));

  // 周一 08:00–09:40（Asia/Shanghai）＝ UTC 00:00–01:40
  const during = currentOccurrence(items, Date.UTC(2026, 8, 21, 0, 30, 0));
  assert.equal(during?.courseName, '高等数学');
  assert.equal(during?.date, '2026-09-21');

  // 开始时刻算「已在课上」
  assert.equal(currentOccurrence(items, Date.UTC(2026, 8, 21, 0, 0, 0))?.courseName, '高等数学');
  // 结束时刻算「已下课」
  assert.equal(currentOccurrence(items, Date.UTC(2026, 8, 21, 1, 40, 0)), undefined);
  // 课间没有课
  assert.equal(currentOccurrence(items, Date.UTC(2026, 8, 21, 3, 0, 0)), undefined);
});

test('停课的课次不算正在上的课', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage
    .collection('events')
    .put(
      eventRow('e-cancel', 'reschedule', {
        on_date: '2026-09-21',
        ref_schedule_id: 's-1',
        action: 'cancel',
      }),
    );
  const items = expand({
    ...(await buildInput(storage, '2026-09-21', '2026-09-21')),
    includeCancelled: true,
  });
  assert.equal(currentOccurrence(items, Date.UTC(2026, 8, 21, 0, 30, 0)), undefined);
});

test('同一天多来源按优先级取一条', () => {
  const kinds: ExpandDayKind[] = [
    { on_date: '2026-10-01', type: 'holiday', as_day_of_week: null, source: 'builtin' },
    { on_date: '2026-10-01', type: 'workday', as_day_of_week: null, source: 'manual' },
    { on_date: '2026-10-01', type: 'holiday', as_day_of_week: null, source: 'from_school' },
  ];
  assert.equal(resolveDayKind(kinds).get('2026-10-01')?.source, 'manual');
});

test('A6 排课自定义时间优先于节次时间；调课改了节次则按新节次', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  const schedule = await storage.collection<Record<string, unknown>>('course_schedules').get('s-1');
  await storage.collection('course_schedules').put({ ...schedule, start_time: '19:00', end_time: '20:30' });
  const [item] = expand(await buildInput(storage, '2026-09-21', '2026-09-21'));
  assert.equal(item?.startAt, Date.UTC(2026, 8, 21, 11, 0, 0));
  assert.equal(item?.endAt, Date.UTC(2026, 8, 21, 12, 30, 0));

  await storage.collection('events').put(
    eventRow('e-p', 'reschedule', {
      on_date: '2026-09-28',
      ref_schedule_id: 's-1',
      action: 'move',
      new_date: '2026-09-28',
      new_period_start: 3,
      new_period_end: 4,
    }),
  );
  const [moved] = expand(await buildInput(storage, '2026-09-28', '2026-09-28'));
  assert.equal(moved?.startAt, Date.UTC(2026, 8, 28, 2, 0, 0), '第 3 节 10:00');
});

test('A7 内置法定节假日进入展开：国庆当天的课不出现', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  // 2026-10-05 周一（国庆假期内），高数原本每周一上
  const items = expand(await buildInput(storage, '2026-10-05', '2026-10-05'));
  assert.deepEqual(items, []);
});

test('A7 用户「设为非假日」覆盖内置假期', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage.collection('events').put(eventRow('e-w', 'workday', { on_date: '2026-10-05' }));
  const items = expand(await buildInput(storage, '2026-10-05', '2026-10-05'));
  assert.equal(items.length, 1);
});

test('A8 调课：移入窗口的课出现、移出窗口的课不出现', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage.collection('events').put(
    eventRow('e-mv', 'reschedule', {
      on_date: '2026-09-14',
      ref_schedule_id: 's-1',
      action: 'move',
      new_date: '2026-09-23',
    }),
  );
  const thisWeek = expand(await buildInput(storage, '2026-09-21', '2026-09-27'));
  assert.ok(thisWeek.some((item) => item.date === '2026-09-23' && item.courseId === 'c-1'), '从上周调进来的课');
  const lastWeek = expand(await buildInput(storage, '2026-09-14', '2026-09-20'));
  assert.ok(
    lastWeek.every((item) => item.date >= '2026-09-14' && item.date <= '2026-09-20'),
    '调出去的课不再以窗口外日期出现',
  );
  assert.ok(!lastWeek.some((item) => item.courseId === 'c-1' && item.date === '2026-09-14'));
});

test('A8 假期里的课调到补课日后照常出现', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage.collection('events').put(
    eventRow('e-mk', 'reschedule', {
      on_date: '2026-10-05',
      ref_schedule_id: 's-1',
      action: 'move',
      new_date: '2026-10-10',
    }),
  );
  const items = expand(await buildInput(storage, '2026-10-05', '2026-10-11'));
  assert.ok(items.some((item) => item.courseId === 'c-1' && item.date === '2026-10-10'));
});
