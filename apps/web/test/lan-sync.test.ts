import test from 'node:test';
import assert from 'node:assert/strict';
import type { Storage } from '@dawn-tick/core';
import {
  LAN_CLIENT_IDLE,
  LAN_PAIRING_TTL_MS,
  LAN_SCOPE_MODULES,
  LAN_SYNC_KIND,
  LAN_SYNC_PORT,
  MAX_REQUEST_BYTES,
  PAIR_CODE_TTL_MS,
  applyLanEnvelope,
  applyLanReply,
  buildLanEnvelope,
  createPairing,
  findTrustedToken,
  formatScope,
  handleLanRequest,
  hashToken,
  isLanAddress,
  issueTrustedToken,
  pairWithPeer,
  parseLanEnvelope,
  parsePeerAddress,
  parseScope,
  parseTrustedTokens,
  pruneTrustedTokens,
  pullFromPeer,
  pushToPeer,
  reduceLanClient,
  revokeTrustedToken,
  rotateTrustedToken,
  scopeModules,
  touchTrustedToken,
  trustedTokensValue,
  verifyPairCode,
  type LanHttpReply,
  type LanHttpRequest,
  type LanServerContext,
  type LanSession,
  type Pairing,
  type TrustedToken,
} from '../src/lan-sync.ts';
import { createStorage, eventRow, seedStorage } from '../../../packages/core/test/helpers.ts';
import { loadTrustedTokens, sameTrustedTokens, saveTrustedTokens } from '../src/lan-trust-store.ts';

const NOW = 1759900000000;

/** 模拟服务端：保存配对码与可信令牌，等价于设备页里的 `LanRuntime` + 轮询循环。 */
function createFakeServer(storage: Storage, pairing: Pairing) {
  let currentPairing: Pairing | null = pairing;
  let tokens: TrustedToken[] = [];
  const handle = async (request: LanHttpRequest): Promise<LanHttpReply> => {
    const context: LanServerContext = { storage, pairing: currentPairing, tokens, now: NOW };
    const reply = await handleLanRequest(context, request);
    if (reply.consumePairing === true) currentPairing = null;
    if (reply.tokens !== undefined) tokens = reply.tokens;
    return reply;
  };
  return {
    handle,
    pairing: () => currentPairing,
    tokens: () => tokens,
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

test('长期令牌：只存哈希、180 天有效、刷新换新、吊销幂等', () => {
  const issued = issueTrustedToken('书房电脑', NOW, 'a'.repeat(32));
  assert.equal(issued.record.tokenHash, hashToken('a'.repeat(32)));
  assert.notEqual(issued.record.tokenHash, 'a'.repeat(32));
  assert.match(issued.record.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(issued.record.expiresAt, NOW + LAN_PAIRING_TTL_MS);
  assert.equal(LAN_PAIRING_TTL_MS, 180 * 24 * 60 * 60_000);
  assert.equal(issued.record.name, '书房电脑');

  const tokens = [issued.record];
  assert.equal(findTrustedToken(tokens, `Bearer ${issued.token}`, NOW).ok, true);
  assert.equal(findTrustedToken(tokens, `bearer ${issued.token}`, NOW).ok, true);
  assert.equal(findTrustedToken(tokens, `Basic ${issued.token}`, NOW).ok, false);
  assert.equal(findTrustedToken(tokens, null, NOW).ok, false);
  assert.equal(findTrustedToken(tokens, 'Bearer 不存在的令牌', NOW).ok, false);
  assert.equal(findTrustedToken(tokens, `Bearer ${issued.token}`, NOW + LAN_PAIRING_TTL_MS).ok, false);

  const touched = touchTrustedToken(tokens, issued.record.tokenHash, NOW + 5_000);
  assert.equal(touched[0]?.lastUsedAt, NOW + 5_000);
  assert.equal(touched[0]?.createdAt, NOW);

  const rotated = rotateTrustedToken(touched, touched[0]!, NOW + 10_000, 'b'.repeat(32));
  assert.equal(rotated.record.tokenHash, hashToken('b'.repeat(32)));
  assert.equal(rotated.record.createdAt, NOW, '刷新不重置创建时间');
  assert.equal(rotated.record.expiresAt, NOW + 10_000 + LAN_PAIRING_TTL_MS);
  assert.equal(rotated.tokens.length, 1);
  assert.equal(findTrustedToken(rotated.tokens, `Bearer ${issued.token}`, NOW + 10_000).ok, false, '旧令牌立即失效');
  assert.equal(findTrustedToken(rotated.tokens, `Bearer ${rotated.token}`, NOW + 10_000).ok, true);

  assert.deepEqual(revokeTrustedToken(rotated.tokens, rotated.record.tokenHash), []);
  assert.deepEqual(revokeTrustedToken([], rotated.record.tokenHash), [], '吊销幂等');

  assert.deepEqual(pruneTrustedTokens([issued.record], NOW + LAN_PAIRING_TTL_MS), []);
  assert.equal(pruneTrustedTokens([issued.record], NOW).length, 1);

  const value = trustedTokensValue([issued.record]);
  const parsed = parseTrustedTokens(value);
  assert.equal(parsed?.length, 1);
  assert.equal(parsed?.[0]?.tokenHash, issued.record.tokenHash);
  assert.equal(parseTrustedTokens([{ tokenHash: 'not-a-hash' }]), null);
  assert.equal(parseTrustedTokens([{ ...issued.record, tokenHash: 'plain-token' }]), null);
  assert.equal(parseTrustedTokens('nope'), null);
});

test('服务端可信令牌持久化：app_meta 只落哈希，可重新加载', async () => {
  const storage = createStorage();
  const issued = issueTrustedToken('手机', NOW, 'e'.repeat(32));
  await saveTrustedTokens(storage, [issued.record]);
  const raw = (await storage.readMeta('lan_trusted_tokens_v1')) ?? '';
  assert.ok(raw.includes(issued.record.tokenHash), '落盘包含哈希');
  assert.ok(!raw.includes(issued.token), '落盘不能包含明文令牌');
  const loaded = await loadTrustedTokens(storage);
  assert.deepEqual(loaded, [issued.record]);
  assert.equal(sameTrustedTokens(loaded, [issued.record]), true);
  assert.equal(sameTrustedTokens(loaded, []), false);
  assert.equal((await loadTrustedTokens(createStorage())).length, 0, '缺失时回退空列表');
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

test('服务端处理：长期令牌、刷新/吊销、鉴权、范围、错误体与体积上限', async () => {
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
    body: JSON.stringify({ code: '123456', name: '书房电脑' }),
  });
  assert.equal(paired.status, 200);
  const pairedBody = JSON.parse(paired.body) as { token?: string; expiresAt?: number };
  const token = pairedBody.token ?? '';
  assert.ok(token.length > 0);
  assert.equal(pairedBody.expiresAt, NOW + LAN_PAIRING_TTL_MS);
  assert.equal(server.pairing(), null);
  assert.equal(server.tokens().length, 1);
  assert.equal(server.tokens()[0]?.name, '书房电脑');
  assert.notEqual(server.tokens()[0]?.tokenHash, token, '服务端只保存哈希');

  const reuse = await server.handle({
    method: 'POST',
    path: '/pair',
    query: '',
    authorization: null,
    body: JSON.stringify({ code: '123456' }),
  });
  assert.equal(reuse.status, 401);

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
    authorization: `Bearer ${token}`,
    body: '',
  });
  assert.equal(exported.status, 200);
  const envelope = parseLanEnvelope(exported.body);
  assert.equal(envelope.kind, LAN_SYNC_KIND);
  assert.deepEqual(envelope.scope, ['todos']);
  assert.equal(envelope.backup.stores.events?.length, 1);
  assert.equal(server.tokens()[0]?.lastUsedAt, NOW);

  const emptyScope = await server.handle({
    method: 'GET',
    path: '/export',
    query: '',
    authorization: `Bearer ${token}`,
    body: '',
  });
  assert.equal(emptyScope.status, 400);

  // 刷新：换新令牌并顺延，旧令牌立即失效
  const refreshed = await server.handle({
    method: 'POST',
    path: '/pair/refresh',
    query: '',
    authorization: `Bearer ${token}`,
    body: '{}',
  });
  assert.equal(refreshed.status, 200);
  const refreshedBody = JSON.parse(refreshed.body) as { token?: string; expiresAt?: number };
  const nextToken = refreshedBody.token ?? '';
  assert.ok(nextToken.length > 0);
  assert.notEqual(nextToken, token);
  assert.equal(refreshedBody.expiresAt, NOW + LAN_PAIRING_TTL_MS);
  assert.equal(server.tokens().length, 1, '刷新是换新而不是新增');
  const staleAfterRefresh = await server.handle({
    method: 'GET',
    path: '/export',
    query: 'scope=todos',
    authorization: `Bearer ${token}`,
    body: '',
  });
  assert.equal(staleAfterRefresh.status, 401);
  const currentAfterRefresh = await server.handle({
    method: 'GET',
    path: '/export',
    query: 'scope=todos',
    authorization: `Bearer ${nextToken}`,
    body: '',
  });
  assert.equal(currentAfterRefresh.status, 200);

  // 多设备：重新生成配对码后允许再配对一台，各自持有独立令牌（不再返回 409）
  const firstPairing = createPairing(NOW, '654321');
  const first = await handleLanRequest(
    { storage, pairing: firstPairing, tokens: [], now: NOW },
    { method: 'POST', path: '/pair', query: '', authorization: null, body: JSON.stringify({ code: '654321', name: '手机' }) },
  );
  assert.equal(first.status, 200);
  const secondPairing = createPairing(NOW, '111111');
  const second = await handleLanRequest(
    { storage, pairing: secondPairing, tokens: first.tokens ?? [], now: NOW },
    { method: 'POST', path: '/pair', query: '', authorization: null, body: JSON.stringify({ code: '111111', name: '平板' }) },
  );
  assert.equal(second.status, 200, '已有设备配对时仍允许新设备配对');
  assert.equal(second.tokens?.length, 2);
  assert.deepEqual(second.tokens?.map((item) => item.name), ['手机', '平板']);

  const expiredToken = issueTrustedToken('过期设备', NOW - LAN_PAIRING_TTL_MS - 1, 'c'.repeat(32));
  const expired = await handleLanRequest(
    { storage, pairing: null, tokens: [expiredToken.record], now: NOW },
    { method: 'GET', path: '/export', query: 'scope=todos', authorization: `Bearer ${expiredToken.token}`, body: '' },
  );
  assert.equal(expired.status, 401);
  assert.match(expired.body, /配对已过期/);

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
    authorization: `Bearer ${nextToken}`,
    body: '',
  });
  assert.equal(wrongMethod.status, 405);

  const tooBig = await server.handle({
    method: 'POST',
    path: '/import',
    query: 'scope=todos&mode=merge',
    authorization: `Bearer ${nextToken}`,
    body: 'x'.repeat(MAX_REQUEST_BYTES + 1),
  });
  assert.equal(tooBig.status, 413);

  // 吊销：服务端列表移除，令牌立即失效（放在最后，前面的 405/413 仍用有效令牌）
  const revoked = await server.handle({
    method: 'POST',
    path: '/pair/revoke',
    query: '',
    authorization: `Bearer ${nextToken}`,
    body: '{}',
  });
  assert.equal(revoked.status, 200);
  assert.equal(server.tokens().length, 0);
  const afterRevoke = await server.handle({
    method: 'GET',
    path: '/export',
    query: 'scope=todos',
    authorization: `Bearer ${nextToken}`,
    body: '',
  });
  assert.equal(afterRevoke.status, 401);
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

    const paired = await pairWithPeer(peer, '123456', NOW, '手机');
    assert.equal(paired.ok, true);
    assert.ok(paired.session !== null);
    assert.equal(paired.session?.expiresAt, NOW + LAN_PAIRING_TTL_MS);

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

test('回复会消耗配对码并保留/替换可信令牌（applyLanReply 语义）', () => {
  const pairing = createPairing(NOW, '123456');
  const issued = issueTrustedToken('手机', NOW, 'd'.repeat(32));
  const afterPair = applyLanReply(
    { pairing, tokens: [] },
    { status: 200, body: '{}', consumePairing: true, tokens: [issued.record] },
  );
  assert.equal(afterPair.pairing, null);
  assert.equal(afterPair.tokens.length, 1);
  assert.equal(afterPair.tokens[0]?.tokenHash, issued.record.tokenHash);
  const afterOrdinary = applyLanReply(afterPair, { status: 200, body: '{}' });
  assert.equal(afterOrdinary.pairing, null);
  assert.equal(afterOrdinary.tokens.length, 1);
  assert.equal(afterOrdinary.tokens[0]?.tokenHash, issued.record.tokenHash);
  const afterRevoke = applyLanReply(afterPair, { status: 200, body: '{}', tokens: [] });
  assert.equal(afterRevoke.tokens.length, 0);
});
