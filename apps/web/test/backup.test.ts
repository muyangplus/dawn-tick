import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, MemoryStorage, writeSettings, readSettings } from '@dawn-tick/core';
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
