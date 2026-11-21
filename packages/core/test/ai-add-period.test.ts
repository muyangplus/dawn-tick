import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_QUERY_ACTIONS, AI_TIMETABLE_ACTIONS, executePlan, findAction, type AiArgs, type AiCoreContext, type AiPlanStep } from '../src/ai/index.ts';
import type { Storage, Collection, StoreName } from '../src/storage.ts';
import type { SemesterRow, TimeSlotRow } from '../src/types.ts';
import { NOW, SEMESTER_ID, createStorage, seedStorage, semesterRow, timeSlotRow } from './kit/index.ts';

const ACTIONS = [...AI_QUERY_ACTIONS, ...AI_TIMETABLE_ACTIONS];

async function seeded(): Promise<AiCoreContext> {
  const storage = createStorage();
  await seedStorage(storage);
  return { storage, userId: 'u1', now: () => NOW, timeZone: 'Asia/Shanghai' };
}

/** 按助手的顺序跑一遍 add_period：parse → preview → run。 */
async function addPeriod(context: AiCoreContext, args: AiArgs): Promise<{ preview: string; result: unknown }> {
  const action = findAction(ACTIONS, 'add_period');
  assert.ok(action !== undefined);
  const params = await action.parse(args, context);
  const preview = await action.preview(params, context);
  return { preview, result: await action.run(params, context) };
}

async function slotsOf(context: AiCoreContext, semesterId = SEMESTER_ID): Promise<Array<[number, string, string]>> {
  const rows = await context.storage.collection<TimeSlotRow>('time_slots').getAll();
  return rows
    .filter((slot) => slot.semester_id === semesterId && slot.deleted_at === null)
    .sort((a, b) => a.period_no - b.period_no)
    .map((slot) => [slot.period_no, slot.start_time, slot.end_time]);
}

/** 把种子里的作息延到晚上：第 7 节 22:35-23:20。 */
async function withLatePeriod(context: AiCoreContext): Promise<void> {
  await context.storage.collection<TimeSlotRow>('time_slots').put(timeSlotRow(7, '22:35', '23:20'));
}

test('add_period：最后一节 23:20 下课，追加 23:30-23:50 成功且时间正好是目标时间', async () => {
  const context = await seeded();
  await withLatePeriod(context);
  const { preview, result } = await addPeriod(context, { start: '23:30', end: '23:50' });
  assert.equal(preview, '追加第 8 节 23:30-23:50');
  assert.equal(result, '已追加第 8 节');
  const slots = await slotsOf(context);
  assert.equal(slots.length, 8);
  assert.deepEqual(slots.at(-1), [8, '23:30', '23:50']);
  assert.deepEqual(slots.at(-2), [7, '22:35', '23:20'], '原有节次不动');
});

/** 记下写进 time_slots 的每一行：看追加过程中有没有落过跨午夜的中间态。 */
function recordSlotWrites(storage: Storage): { storage: Storage; writes: TimeSlotRow[] } {
  const writes: TimeSlotRow[] = [];
  const wrap = <T,>(collection: Collection<T>): Collection<T> => ({
    name: collection.name,
    get: (key) => collection.get(key),
    getAll: () => collection.getAll(),
    put: async (value) => {
      writes.push(structuredClone(value) as unknown as TimeSlotRow);
      await collection.put(value);
    },
    putMany: async (values) => {
      for (const value of values) writes.push(structuredClone(value) as unknown as TimeSlotRow);
      await collection.putMany(values);
    },
    delete: (key) => collection.delete(key),
    clear: () => collection.clear(),
  });
  const recorded: Storage = {
    kind: storage.kind,
    collection: <T,>(name: StoreName) => (name === 'time_slots' ? wrap(storage.collection<T>(name)) : storage.collection<T>(name)),
    readMeta: (key) => storage.readMeta(key),
    writeMeta: (key, value) => storage.writeMeta(key, value),
    close: () => storage.close(),
  };
  return { storage: recorded, writes };
}

test('add_period：晚间追加一次写成目标时间，不落 45+10 分钟推算出的跨午夜中间态', async () => {
  const base = await seeded();
  await withLatePeriod(base);
  const { storage, writes } = recordSlotWrites(base.storage);
  await addPeriod({ ...base, storage }, { start: '23:30', end: '23:50' });
  assert.deepEqual(
    writes.map((row) => [row.period_no, row.start_time, row.end_time]),
    [[8, '23:30', '23:50']],
    '只写一次，且就是目标时间',
  );
  assert.ok(writes.every((row) => row.end_time > row.start_time), '没有下课早于上课的行');
});

test('add_period：晚间紧接上一节下课（间隔 0）追加到 23:59', async () => {
  const context = await seeded();
  await withLatePeriod(context);
  await addPeriod(context, { start: '23:20', end: '23:59' });
  assert.deepEqual((await slotsOf(context)).at(-1), [8, '23:20', '23:59']);
});

test('add_period：白天追加非 45 分钟的一节，时间与间隔都按目标时间', async () => {
  const context = await seeded();
  // 种子最后一节 14:55-15:40；隔 20 分钟追加 90 分钟的一节
  const { preview } = await addPeriod(context, { start: '16:00', end: '17:30' });
  assert.equal(preview, '追加第 7 节 16:00-17:30');
  assert.deepEqual((await slotsOf(context)).at(-1), [7, '16:00', '17:30']);
});

test('add_period：空学期的第一节直接放在晚上', async () => {
  const context = await seeded();
  await context.storage.collection<SemesterRow>('semesters').put(semesterRow({ id: 'sem-night', name: '夜校', is_active: 0 }));
  await addPeriod(context, { semesterId: 'sem-night', start: '23:30', end: '23:50' });
  assert.deepEqual(await slotsOf(context, 'sem-night'), [[1, '23:30', '23:50']]);
});

test('add_period：计划里连续两次晚间追加，执行时各自接在当时的最后一节后', async () => {
  const context = await seeded();
  await withLatePeriod(context);
  const action = findAction(ACTIONS, 'add_period');
  assert.ok(action !== undefined);
  const plan: AiPlanStep[] = [];
  for (const args of [{ start: '23:25', end: '23:40' }, { start: '23:45', end: '23:58' }]) {
    const params = await action.parse(args, context);
    plan.push({ id: `step-${plan.length + 1}`, action: 'add_period', args, params, preview: await action.preview(params, context), risk: 'write' });
  }
  const execution = await executePlan(plan, ACTIONS, context);
  assert.equal(execution.failed, null);
  assert.deepEqual(execution.done.map((done) => done.summary), ['已追加第 8 节', '已追加第 9 节']);
  assert.deepEqual((await slotsOf(context)).slice(-2), [
    [8, '23:25', '23:40'],
    [9, '23:45', '23:58'],
  ]);
});

test('add_period：晚间追加不足 10 分钟的一节', async () => {
  const context = await seeded();
  await withLatePeriod(context);
  await addPeriod(context, { start: '23:50', end: '23:55' });
  assert.deepEqual((await slotsOf(context)).at(-1), [8, '23:50', '23:55']);
});
