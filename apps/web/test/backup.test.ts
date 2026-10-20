import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  MemoryStorage,
  writeSettings,
  readSettings,
  type Collection,
  type Storage,
  type StoreName,
} from '@dawn-tick/core';
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  maybeAutoBackup,
  pruneSnapshots,
  restoreSnapshot,
  snapshotKind,
  snapshotsToday,
} from '../src/backup.ts';
import { dayStampLocal } from '../src/lib/dates.ts';

function course(id: string, name: string): Record<string, unknown> {
  return {
    id,
    semester_id: 's-1',
    name,
    short_name: null,
    teacher: null,
    location: null,
    color: '#4F8DFD',
    credits: 4,
    note: null,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    rev: 0,
    dirty: 0,
  };
}

async function seeded(): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  await storage.collection('courses').put(course('c-1', '高等数学'));
  await writeSettings(storage, { theme: 'dark' });
  return storage;
}

interface MetaRead {
  key: string;
  bytes: number;
}

/** 量读放大的包装：记录 readMeta 的键与体积，以及 app_meta 的全表扫描次数。 */
function metered(inner: Storage): { storage: Storage; reads: MetaRead[]; getAllCalls: () => number } {
  const reads: MetaRead[] = [];
  let getAllCalls = 0;
  const storage: Storage = {
    kind: inner.kind,
    collection<T>(name: StoreName): Collection<T> {
      const real = inner.collection<T>(name);
      if (name !== 'app_meta') return real;
      return {
        name: real.name,
        get: (key) => real.get(key),
        getAll: async () => {
          getAllCalls += 1;
          return real.getAll();
        },
        put: (value) => real.put(value),
        putMany: (values) => real.putMany(values),
        delete: (key) => real.delete(key),
        clear: () => real.clear(),
      };
    },
    async readMeta(key: string): Promise<string | undefined> {
      const value = await inner.readMeta(key);
      reads.push({ key, bytes: value?.length ?? 0 });
      return value;
    },
    writeMeta: (key, value) => inner.writeMeta(key, value),
    close: () => inner.close(),
  };
  return { storage, reads, getAllCalls: () => getAllCalls };
}

test('非原生端用库内 JSON 快照', async () => {
  assert.equal(snapshotKind(), 'json');
  const storage = await seeded();
  const entry = await createSnapshot(storage, 1_793_000_000_000);
  assert.equal(entry?.kind, 'json');
  const listed = await listSnapshots(storage);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, entry?.id);
  assert.ok((listed[0]?.bytes ?? 0) > 0);

  const stored = await storage.readMeta(`backup:1793000000000`);
  assert.ok(stored?.includes('dawn-tick-backup'));
});

test('快照按时间倒序并按保留份数清理', async () => {
  const storage = await seeded();
  for (let index = 0; index < 5; index += 1) {
    await createSnapshot(storage, 1_793_000_000_000 + index * 1000);
  }
  const listed = await listSnapshots(storage);
  assert.equal(listed.length, 5);
  assert.deepEqual(
    listed.map((entry) => entry.createdAt),
    [1_793_000_004_000, 1_793_000_003_000, 1_793_000_002_000, 1_793_000_001_000, 1_793_000_000_000],
    '最新在前',
  );

  const removed = await pruneSnapshots(storage, 2);
  assert.equal(removed, 3);
  assert.deepEqual(
    (await listSnapshots(storage)).map((entry) => entry.createdAt),
    [1_793_000_004_000, 1_793_000_003_000],
  );
});

test('删除快照', async () => {
  const storage = await seeded();
  const entry = await createSnapshot(storage, 1_793_000_000_000);
  assert.ok(entry !== null);
  assert.equal(await deleteSnapshot(storage, entry), true);
  assert.deepEqual(await listSnapshots(storage), []);
});

test('恢复快照把数据放回去', async () => {
  const storage = await seeded();
  const entry = await createSnapshot(storage, 1_793_000_000_000);
  assert.ok(entry !== null);

  // 快照之后又改了数据：加课程、换主题
  await storage.collection('courses').put(course('c-2', '大学物理'));
  await writeSettings(storage, { theme: 'light' });

  const outcome = await restoreSnapshot(storage, entry);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.needsRestart, false);
  assert.equal((await readSettings(storage)).theme, 'dark');
  const ids = (await storage.collection<Record<string, unknown>>('courses').getAll()).map((row) => row['id']);
  assert.deepEqual(ids, ['c-1'], '快照之后新增的课程被清掉');
});

test('恢复不存在的 JSON 快照会报错', async () => {
  const storage = await seeded();
  const outcome = await restoreSnapshot(storage, {
    id: 'backup:1',
    createdAt: 1,
    bytes: 10,
    kind: 'json',
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? '', /快照内容不存在/);
});

test('自动备份按开关与当天份数决定', async () => {
  const storage = await seeded();
  const now = Date.UTC(2026, 9, 14, 4, 0, 0);
  const off = { ...DEFAULT_SETTINGS, autoBackup: false };
  assert.equal(await maybeAutoBackup(storage, off, { startup: true, now }), null);

  // 启动时备份关、每天备份开且今天还没有份：补一份
  const dailyOnly = { ...DEFAULT_SETTINGS, backupOnStart: false, backupDaily: true };
  const created = await maybeAutoBackup(storage, dailyOnly, { startup: true, now });
  assert.ok(created !== null);
  assert.equal(await maybeAutoBackup(storage, dailyOnly, { startup: true, now: now + 1000 }), null, '当天已有一份就不再补');

  // 第二天再补
  const tomorrow = now + 24 * 60 * 60 * 1000;
  assert.ok((await maybeAutoBackup(storage, dailyOnly, { startup: false, now: tomorrow })) !== null);

  // 启动时备份开：每次都做（一分钟内不重复）
  const storage2 = await seeded();
  const onStart = { ...DEFAULT_SETTINGS, backupOnStart: true, backupDaily: true, backupKeep: 2 };
  assert.ok((await maybeAutoBackup(storage2, onStart, { startup: true, now })) !== null);
  assert.equal(
    await maybeAutoBackup(storage2, onStart, { startup: true, now: now + 1000 }),
    null,
    '一分钟内不重复',
  );
  assert.ok((await maybeAutoBackup(storage2, onStart, { startup: true, now: now + 120_000 })) !== null);
  assert.equal((await listSnapshots(storage2)).length, 2, '保留份数生效');
});

test('当天判定用本地日期', () => {
  const now = Date.UTC(2026, 9, 14, 4, 0, 0);
  assert.equal(dayStampLocal(now), dayStampLocal(now + 1000));
  const entries = [
    { id: 'a', createdAt: now, bytes: 1, kind: 'json' as const },
    { id: 'b', createdAt: now - 3 * 24 * 60 * 60 * 1000, bytes: 1, kind: 'json' as const },
  ];
  assert.deepEqual(snapshotsToday(entries, now).map((entry) => entry.id), ['a']);
});

test('有索引后列表只读索引，不再读快照正文', async () => {
  const base = 1_793_000_000_000;
  const inner = await seeded();
  for (let index = 0; index < 3; index += 1) {
    await createSnapshot(inner, base + index * 1000);
  }
  const rows = await inner.collection<{ key: string; value: string }>('app_meta').getAll();
  const bodyBytes = rows
    .filter((row) => row.key.startsWith('backup:'))
    .reduce((total, row) => total + row.value.length, 0);
  assert.ok(bodyBytes > 0);

  const probe = metered(inner);
  const listed = await listSnapshots(probe.storage);
  assert.equal(listed.length, 3);
  assert.deepEqual(
    probe.reads.map((read) => read.key),
    ['backup_index'],
    '列表只读索引',
  );
  assert.equal(probe.getAllCalls(), 0, '不再全表扫描 app_meta');
  const readBytes = probe.reads.reduce((total, read) => total + read.bytes, 0);
  assert.ok(readBytes * 2 < bodyBytes, `索引读取 ${readBytes}B 应远小于正文 ${bodyBytes}B`);
});

test('无索引旧库回退全表一次并写入索引', async () => {
  const inner = await seeded();
  // 模拟升级前的库：只有快照正文，没有 backup_index
  await inner.writeMeta('backup:1793000000000', '{"format":"x"}');
  await inner.writeMeta('backup:1793000001000', '{"format":"y"}');

  const probe = metered(inner);
  const first = await listSnapshots(probe.storage);
  assert.deepEqual(
    first.map((entry) => entry.createdAt),
    [1_793_000_001_000, 1_793_000_000_000],
    '最新在前',
  );
  assert.deepEqual(
    first.map((entry) => entry.bytes),
    ['{"format":"y"}'.length, '{"format":"x"}'.length],
    '体积取自正文长度',
  );
  assert.equal(probe.getAllCalls(), 1, '旧库只全表扫描一次');
  assert.ok((await inner.readMeta('backup_index'))?.includes('1793000001000'), '扫描后补写索引');

  probe.reads.length = 0;
  const second = await listSnapshots(probe.storage);
  assert.equal(second.length, 2);
  assert.deepEqual(probe.reads.map((read) => read.key), ['backup_index']);
  assert.equal(probe.getAllCalls(), 1, '第二次不再扫描');
});

test('索引随快照创建与删除同步更新', async () => {
  const base = 1_793_000_000_000;
  const storage = await seeded();
  const older = await createSnapshot(storage, base);
  const newer = await createSnapshot(storage, base + 1000);
  assert.ok(older !== null && newer !== null);

  const readIndex = async (): Promise<Array<{ id: string }>> =>
    JSON.parse((await storage.readMeta('backup_index')) ?? '[]') as Array<{ id: string }>;
  assert.deepEqual(
    (await readIndex()).map((entry) => entry.id),
    [newer.id, older.id],
    '按时间倒序登记',
  );

  await deleteSnapshot(storage, older);
  assert.deepEqual(
    (await readIndex()).map((entry) => entry.id),
    [newer.id],
    '删除同步移除索引行',
  );
  assert.deepEqual(
    (await listSnapshots(storage)).map((entry) => entry.id),
    [newer.id],
  );
});

test('索引损坏时按旧库处理并重建', async () => {
  const storage = await seeded();
  const entry = await createSnapshot(storage, 1_793_000_000_000);
  assert.ok(entry !== null);
  await storage.writeMeta('backup_index', '{ 坏掉的索引');

  const listed = await listSnapshots(storage);
  assert.deepEqual(
    listed.map((item) => item.id),
    [entry.id],
  );
  const rebuilt = await storage.readMeta('backup_index');
  assert.ok(rebuilt?.includes(entry.id), '坏索引被全表扫描结果覆盖');
});

