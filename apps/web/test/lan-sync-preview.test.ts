import test from 'node:test';
import assert from 'node:assert/strict';
import type { Storage } from '@dawn-tick/core';
import {
  EMPTY_LAN_CHANGE_STATS,
  applyLanPreview,
  countLanChanges,
  previewPullFromPeer,
} from '../src/lan-sync-preview.ts';
import { buildLanEnvelope } from '../src/lan-sync-payload.ts';
import { createStorage, eventRow, seedStorage } from '../../../packages/core/test/helpers.ts';

const NOW = 1759900000000;

async function eventsOf(storage: Storage): Promise<Record<string, unknown>[]> {
  return storage.collection<Record<string, unknown>>('events').getAll();
}

test('预览统计：按课表 / 待办 / 设置分组，与 merge 的 updated_at 规则一致', async () => {
  const source = createStorage();
  await seedStorage(source);
  await source.collection('events').put(eventRow('e-remote', 'todo', { title: '对方新增', updated_at: NOW + 1000 }));
  await source.collection('events').put(eventRow('e-shared', 'todo', { title: '对方较旧', updated_at: NOW - 1000 }));
  await source.writeMeta('time_zone', 'UTC');

  const target = createStorage();
  await seedStorage(target);
  await target.collection('events').put(eventRow('e-local', 'todo', { title: '本机独有', updated_at: NOW }));
  await target.collection('events').put(eventRow('e-shared', 'todo', { title: '本机较新', updated_at: NOW }));
  await target.writeMeta('time_zone', 'UTC');

  const todos = await buildLanEnvelope(source, ['todos'], NOW);
  const todoStats = await countLanChanges(target, todos, ['todos']);
  assert.deepEqual(todoStats, { timetable: 0, todos: 1, settings: 0, total: 1 });
  // 只统计勾选范围：没勾设置就不数 meta
  assert.equal((await countLanChanges(target, todos, [])).total, 0);

  const all = await buildLanEnvelope(source, ['timetable', 'todos', 'settings'], NOW);
  const stats = await countLanChanges(target, all, ['timetable', 'todos', 'settings']);
  assert.equal(stats.total, 1);
  assert.deepEqual(stats, { timetable: 0, todos: 1, settings: 0, total: 1 });

  await target.writeMeta('time_zone', 'Asia/Tokyo');
  const settingsStats = await countLanChanges(target, all, ['settings']);
  assert.equal(settingsStats.settings, 1);
  assert.equal(settingsStats.total, 1);

  const noTimetableChange = await countLanChanges(target, all, ['timetable']);
  assert.equal(noTimetableChange.total, 0);
  assert.deepEqual(EMPTY_LAN_CHANGE_STATS, { timetable: 0, todos: 0, settings: 0, total: 0 });
});

test('预览只读不写：统计后本机数据不变，确认后才合并', async () => {
  const source = createStorage();
  await seedStorage(source);
  await source.collection('events').put(eventRow('e-new', 'todo', { title: '对方新增', updated_at: NOW - 1000 }));
  const envelope = await buildLanEnvelope(source, ['todos'], NOW);

  const target = createStorage();
  await seedStorage(target);
  const before = await eventsOf(target);
  const stats = await countLanChanges(target, envelope, ['todos']);
  assert.equal(stats.todos, 1);
  assert.deepEqual(await eventsOf(target), before);

  const applied = await applyLanPreview(target, envelope, ['todos'], NOW);
  assert.equal(applied.ok, true);
  assert.equal(applied.imported, 1);
  const after = await eventsOf(target);
  assert.equal(after.length, 1);
  assert.equal(after[0]?.['title'], '对方新增');
  assert.equal((await countLanChanges(target, envelope, ['todos'])).total, 0, '合并后同一份信封不再产生变更');
});

test('预览请求：空范围、过期会话直接返回错误，不做网络请求', async () => {
  const storage = createStorage();
  const session = { peer: { host: '192.168.1.5', port: 8765 }, token: 'tok', expiresAt: NOW - 1 };
  const empty = await previewPullFromPeer(storage, { ...session, expiresAt: NOW + 1000 }, []);
  assert.equal(empty.ok, false);
  assert.match(empty.error ?? '', /至少勾选/);
  const expired = await previewPullFromPeer(storage, session, ['todos'], NOW);
  assert.equal(expired.ok, false);
  assert.match(expired.error ?? '', /重新配对/);
  assert.equal(expired.envelope, null);
  assert.equal(expired.stats.total, 0);
});

test('预览请求：拉取同一份信封并返回分组统计', async () => {
  const source = createStorage();
  await seedStorage(source);
  await source.collection('events').put(eventRow('e-preview', 'todo', { title: '预览新增', updated_at: NOW - 1000 }));
  const envelope = await buildLanEnvelope(source, ['todos'], NOW);
  const target = createStorage();
  await seedStorage(target);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(envelope), { status: 200 })) as typeof fetch;
  try {
    const session = { peer: { host: '192.168.1.5', port: 8765 }, token: 'tok', expiresAt: NOW + 1000 };
    const preview = await previewPullFromPeer(target, session, ['todos'], NOW);
    assert.equal(preview.ok, true);
    assert.equal(preview.stats.todos, 1);
    assert.equal(preview.stats.total, 1);
    assert.equal(preview.envelope?.kind, envelope.kind);
    assert.equal((await eventsOf(target)).length, 0, '预览不写本机');
  } finally {
    globalThis.fetch = original;
  }
});
