import test from 'node:test';
import assert from 'node:assert/strict';
import type { Storage } from '@dawn-tick/core';
import {
  LAN_CLIENT_IDLE,
  LAN_SCOPE_MODULES,
  LAN_SYNC_KIND,
  LAN_SYNC_PORT,
  MAX_REQUEST_BYTES,
  PAIR_CODE_TTL_MS,
  SESSION_TTL_MS,
  applyLanEnvelope,
  applyLanReply,
  buildLanEnvelope,
  createPairing,
  formatScope,
  handleLanRequest,
  isLanAddress,
  pairWithPeer,
  parseLanEnvelope,
  parsePeerAddress,
  parseScope,
  pullFromPeer,
  pushToPeer,
  reduceLanClient,
  scopeModules,
  sessionValid,
  verifyPairCode,
  type LanHttpReply,
  type LanHttpRequest,
  type LanServerContext,
  type LanSession,
  type Pairing,
  type SessionGrant,
} from '../src/lan-sync.ts';
import { createStorage, eventRow, seedStorage } from '../../../packages/core/test/helpers.ts';

const NOW = 1759900000000;

/** 模拟服务端：保存配对码与会话，等价于设备页里的 `LanRuntime` + 轮询循环。 */
function createFakeServer(storage: Storage, pairing: Pairing) {
  let currentPairing: Pairing | null = pairing;
  let session: SessionGrant | null = null;
  const handle = async (request: LanHttpRequest): Promise<LanHttpReply> => {
    const context: LanServerContext = { storage, pairing: currentPairing, session, now: NOW };
    const reply = await handleLanRequest(context, request);
    if (reply.consumePairing === true) currentPairing = null;
    if (reply.session !== undefined) session = reply.session;
    return reply;
  };
  return {
    handle,
    pairing: () => currentPairing,
    session: () => session,
  };
}

/** 把客户端 fetch 直接接到服务端处理函数：双端收发只差一个 socket。 */
function stubLanFetch(handle: (request: LanHttpRequest) => Promise<LanHttpReply>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : String(input));
    const headers = new Headers(init.headers ?? {});
    const reply = await handle({
      method: init.method ?? 'GET',
      path: url.pathname,
      query: url.search.replace(/^\?/, ''),
      authorization: headers.get('authorization'),
      body: typeof init.body === 'string' ? init.body : '',
    });
    return new Response(reply.body === '' ? null : reply.body, { status: reply.status });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function eventsOf(storage: Storage): Promise<Record<string, unknown>[]> {
  return storage.collection<Record<string, unknown>>('events').getAll();
}

test('配对码 6 位、5 分钟过期、用后一次性', () => {
  const random = createPairing(NOW);
  assert.match(random.code, /^\d{6}$/);
  assert.equal(random.expiresAt, NOW + PAIR_CODE_TTL_MS);

  const pairing = createPairing(NOW, '123456');
  assert.equal(verifyPairCode(pairing, '123456', NOW + PAIR_CODE_TTL_MS - 1).ok, true);
  assert.equal(verifyPairCode(pairing, '123456', NOW + PAIR_CODE_TTL_MS).ok, false);
  assert.equal(verifyPairCode(pairing, '12345a', NOW).error, '配对码应为 6 位数字');
  assert.equal(verifyPairCode(pairing, '654321', NOW).error, '配对码不正确');
  assert.equal(verifyPairCode(null, '123456', NOW).ok, false);
});

test('范围编解码与备份模块映射', () => {
  assert.deepEqual(parseScope('todos, timetable, unknown,,todos'), ['timetable', 'todos']);
  assert.deepEqual(parseScope(null), []);
  assert.equal(formatScope(['settings', 'timetable']), 'timetable,settings');
  assert.deepEqual(scopeModules(['timetable']), ['semesters', 'courses']);
  assert.deepEqual(scopeModules(['todos', 'settings']), ['events', 'settings']);
  assert.deepEqual(LAN_SCOPE_MODULES.todos, ['events']);
});

test('对方地址只接受局域网 IPv4 与端口', () => {
  assert.deepEqual(parsePeerAddress(' 192.168.1.5:8765 '), { host: '192.168.1.5', port: 8765 });
  assert.deepEqual(parsePeerAddress('http://10.0.0.2:9000/'), { host: '10.0.0.2', port: 9000 });
  assert.deepEqual(parsePeerAddress('172.20.1.1'), { host: '172.20.1.1', port: LAN_SYNC_PORT });
  assert.equal(parsePeerAddress('8.8.8.8:8765'), null);
  assert.equal(parsePeerAddress('example.com:8765'), null);
  assert.equal(parsePeerAddress('192.168.1.5:0'), null);
  assert.equal(parsePeerAddress(''), null);
  assert.equal(isLanAddress('127.0.0.1'), true);
  assert.equal(isLanAddress('169.254.1.1'), true);
  assert.equal(isLanAddress('172.32.0.1'), false);
});

test('会话令牌：Bearer 解析与过期判定', () => {
  const session: SessionGrant = { token: 'abc123', expiresAt: NOW + SESSION_TTL_MS };
  assert.equal(sessionValid(session, 'Bearer abc123', NOW), true);
  assert.equal(sessionValid(session, 'bearer abc123', NOW), true);
  assert.equal(sessionValid(session, 'Basic abc123', NOW), false);
  assert.equal(sessionValid(session, null, NOW), false);
  assert.equal(sessionValid(session, 'Bearer abc123', NOW + SESSION_TTL_MS), false);
  assert.equal(sessionValid(null, 'Bearer abc123', NOW), false);
});

test('客户端状态机：配对 → 已配对 → 过期 / 失败', () => {
  const session: LanSession = {
    peer: { host: '192.168.1.5', port: 8765 },
    token: 'token',
    expiresAt: NOW + 1000,
  };
  const pairing = reduceLanClient(LAN_CLIENT_IDLE, { type: 'pairing' });
  assert.equal(pairing.phase, 'pairing');
  const paired = reduceLanClient(pairing, { type: 'paired', session });
  assert.equal(paired.phase, 'paired');
  assert.equal(paired.session?.token, 'token');
  const still = reduceLanClient(paired, { type: 'expire', now: NOW });
  assert.equal(still.phase, 'paired');
  const expired = reduceLanClient(paired, { type: 'expire', now: NOW + 1000 });
  assert.equal(expired.phase, 'idle');
  assert.equal(expired.session, null);
  assert.equal(expired.error, '配对已过期，请重新配对');
  const failed = reduceLanClient(pairing, { type: 'failed', error: '配对码不正确' });
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.error, '配对码不正确');
  assert.deepEqual(reduceLanClient(failed, { type: 'reset' }), LAN_CLIENT_IDLE);
});

test('服务端处理：鉴权、范围、错误体与体积上限', async () => {
  const storage = createStorage();
  await seedStorage(storage);
  await storage.collection('events').put(eventRow('e-1', 'todo', { title: '交作业' }));
  const pairing = createPairing(NOW, '123456');
  const server = createFakeServer(storage, pairing);

  const wrong = await server.handle({
    method: 'POST',
    path: '/pair',
    query: '',
    authorization: null,
    body: JSON.stringify({ code: '000000' }),
  });
  assert.equal(wrong.status, 401);
  assert.match(wrong.body, /配对码不正确/);

  const paired = await server.handle({
    method: 'POST',
    path: '/pair',
    query: '',
    authorization: null,
    body: JSON.stringify({ code: '123456' }),
  });
  assert.equal(paired.status, 200);
  const session = server.session();
  assert.ok(session !== null);
  assert.equal(server.pairing(), null);

  const reuse = await server.handle({
    method: 'POST',
    path: '/pair',
    query: '',
    authorization: null,
    body: JSON.stringify({ code: '123456' }),
  });
  assert.equal(reuse.status, 409);

  const noAuth = await server.handle({
    method: 'GET',
    path: '/export',
    query: 'scope=todos',
    authorization: null,
    body: '',
  });
  assert.equal(noAuth.status, 401);
  assert.match(noAuth.body, /"unauthorized"/);

  const exported = await server.handle({
    method: 'GET',
    path: '/export',
    query: 'scope=todos',
    authorization: `Bearer ${session?.token ?? ''}`,
    body: '',
  });
  assert.equal(exported.status, 200);
  const envelope = parseLanEnvelope(exported.body);
  assert.equal(envelope.kind, LAN_SYNC_KIND);
  assert.deepEqual(envelope.scope, ['todos']);
  assert.equal(envelope.backup.stores.events?.length, 1);

  const emptyScope = await server.handle({
    method: 'GET',
    path: '/export',
    query: '',
    authorization: `Bearer ${session?.token ?? ''}`,
    body: '',
  });
  assert.equal(emptyScope.status, 400);

  const missing = await server.handle({
    method: 'GET',
    path: '/nope',
    query: '',
    authorization: null,
    body: '',
  });
  assert.equal(missing.status, 404);
  assert.match(missing.body, /"not_found"/);

  const wrongMethod = await server.handle({
    method: 'POST',
    path: '/export',
    query: 'scope=todos',
    authorization: `Bearer ${session?.token ?? ''}`,
    body: '',
  });
  assert.equal(wrongMethod.status, 405);

  const tooBig = await server.handle({
    method: 'POST',
    path: '/import',
    query: 'scope=todos&mode=merge',
    authorization: `Bearer ${session?.token ?? ''}`,
    body: 'x'.repeat(MAX_REQUEST_BYTES + 1),
  });
  assert.equal(tooBig.status, 413);

  const expired = await handleLanRequest(
    { storage, pairing: null, session, now: (session?.expiresAt ?? NOW) + 1 },
    { method: 'GET', path: '/export', query: 'scope=todos', authorization: `Bearer ${session?.token ?? ''}`, body: '' },
  );
  assert.equal(expired.status, 401);
});

test('信封版本与导入合并/覆盖规则', async () => {
  const source = createStorage();
  await seedStorage(source);
  await source.collection('events').put(eventRow('e-1', 'todo', { title: '对方版本', updated_at: NOW - 1000 }));
  const target = createStorage();
  await seedStorage(target);
  await target.collection('events').put(eventRow('e-1', 'todo', { title: '本机版本', updated_at: NOW }));

  const envelope = await buildLanEnvelope(source, ['todos'], NOW);
  assert.equal(envelope.schemaVersion, 1);

  const merged = await applyLanEnvelope(target, envelope, { scopes: ['todos'], mode: 'merge', now: NOW });
  assert.equal(merged.imported, 0);
  assert.ok(merged.skipped >= 1);
  const afterMerge = await target.collection<Record<string, unknown>>('events').get('e-1');
  assert.equal(afterMerge?.title, '本机版本');

  const overwritten = await applyLanEnvelope(target, envelope, {
    scopes: ['todos'],
    mode: 'overwrite',
    now: NOW,
  });
  assert.equal(overwritten.imported, 1);
  const afterOverwrite = await target.collection<Record<string, unknown>>('events').get('e-1');
  assert.equal(afterOverwrite?.title, '对方版本');

  const future = { ...envelope, schemaVersion: 2 };
  assert.throws(() => parseLanEnvelope(JSON.stringify(future)), /不受支持/);
  assert.throws(() => parseLanEnvelope('not json'), /合法 JSON/);
  assert.throws(() => parseLanEnvelope(JSON.stringify({ kind: 'other' })), /不是晓刻局域网同步数据/);
});

test('双端收发模拟：配对 → 拉取 → 推送（含较旧一份跳过）', async () => {
  const serverStorage = createStorage();
  await seedStorage(serverStorage);
  await serverStorage.collection('events').put(eventRow('e-1', 'todo', { title: '交作业' }));
  const pairing = createPairing(NOW, '123456');
  const server = createFakeServer(serverStorage, pairing);
  const restore = stubLanFetch(server.handle);
  try {
    const peer = parsePeerAddress('192.168.1.5:8765');
    assert.ok(peer !== null);

    const paired = await pairWithPeer(peer, '123456', NOW);
    assert.equal(paired.ok, true);
    assert.ok(paired.session !== null);
    assert.equal(paired.session?.expiresAt, NOW + SESSION_TTL_MS);

    const again = await pairWithPeer(peer, '123456', NOW);
    assert.equal(again.ok, false);

    const clientStorage = createStorage();
    const pulled = await pullFromPeer(clientStorage, paired.session, ['timetable', 'todos'], NOW);
    assert.equal(pulled.ok, true);
    assert.equal(pulled.imported, 15);
    assert.equal((await clientStorage.collection('courses').getAll()).length, 3);
    assert.equal((await clientStorage.collection('semesters').getAll()).length, 1);
    const events = await eventsOf(clientStorage);
    assert.equal(events.length, 1);

    const row = events[0] as Record<string, unknown>;
    await clientStorage
      .collection('events')
      .put({ ...row, title: '交作业（已改）', updated_at: NOW + 10_000 });
    const pushed = await pushToPeer(clientStorage, paired.session, ['todos'], NOW);
    assert.equal(pushed.ok, true);
    assert.ok(pushed.imported >= 1);
    const updated = await serverStorage.collection<Record<string, unknown>>('events').get('e-1');
    assert.equal(updated?.title, '交作业（已改）');

    await clientStorage
      .collection('events')
      .put({ ...row, title: '交作业（更旧）', updated_at: NOW - 10_000 });
    const stale = await pushToPeer(clientStorage, paired.session, ['todos'], NOW);
    assert.equal(stale.ok, true);
    assert.equal(stale.imported, 0);
    assert.ok(stale.skipped >= 1);
    const kept = await serverStorage.collection<Record<string, unknown>>('events').get('e-1');
    assert.equal(kept?.title, '交作业（已改）');
  } finally {
    restore();
  }
});

test('回复会消耗配对码并保留会话（applyLanReply 语义）', () => {
  const pairing = createPairing(NOW, '123456');
  const session: SessionGrant = { token: 'tok', expiresAt: NOW + SESSION_TTL_MS };
  const afterPair = applyLanReply(
    { pairing, session: null },
    { status: 200, body: '{}', session, consumePairing: true },
  );
  assert.equal(afterPair.pairing, null);
  assert.equal(afterPair.session?.token, 'tok');
  const afterOrdinary = applyLanReply(afterPair, { status: 200, body: '{}' });
  assert.equal(afterOrdinary.pairing, null);
  assert.equal(afterOrdinary.session?.token, 'tok');
});
