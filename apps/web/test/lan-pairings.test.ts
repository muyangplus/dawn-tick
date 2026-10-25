import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../../../packages/core/test/helpers.ts';
import {
  LAN_PAIRING_OFFLINE_HINT,
  LAN_RECONNECT_INTERVAL_MS,
  applyLanPairProbes,
  createLanPairing,
  createLanPairingStore,
  formatLanPairingLabel,
  lanPairingStatusText,
  markLanPairingSynced,
  pairingSession,
  parseLanPairings,
  parseLanPairingsJson,
  probeLanPairing,
  reduceLanPairingStatuses,
  removeLanPairing,
  serializeLanPairings,
  shouldProbePairing,
  updateLanPairingToken,
  upsertLanPairing,
  type LanPairing,
} from '../src/lan-pairings.ts';

const NOW = 1759900000000;
const TOKEN = 'a'.repeat(32);
const PEER = { host: '192.168.1.5', port: 8765 };

function sample(overrides: Partial<LanPairing> = {}): LanPairing {
  return {
    id: '192.168.1.5:8765',
    name: '书房电脑',
    host: '192.168.1.5',
    port: 8765,
    token: TOKEN,
    pairedAt: NOW,
    lastSyncAt: null,
    ...overrides,
  };
}

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) =>
    handler(String(input), init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test('配对记录：新建、合并、移除、令牌与同步时间', () => {
  const pairing = createLanPairing({ peer: PEER, token: TOKEN, name: '书房电脑', now: NOW });
  assert.equal(pairing.id, '192.168.1.5:8765');
  assert.equal(pairing.name, '书房电脑');
  assert.equal(pairing.lastSyncAt, null);
  assert.equal(formatLanPairingLabel(pairing), '书房电脑 · 192.168.1.5:8765');

  const fallback = createLanPairing({ peer: PEER, token: TOKEN, now: NOW });
  assert.equal(fallback.name, '192.168.1.5:8765');

  const other = createLanPairing({ peer: { host: '10.0.0.8', port: 9000 }, token: 'b'.repeat(32), now: NOW + 1 });
  const both = upsertLanPairing([pairing], other);
  assert.deepEqual(both.map((item) => item.id), ['10.0.0.8:9000', '192.168.1.5:8765']);
  assert.equal(upsertLanPairing(both, { ...pairing, name: '改名' }).length, 2);
  assert.equal(upsertLanPairing(both, { ...pairing, name: '改名' }).find((item) => item.id === pairing.id)?.name, '改名');
  assert.deepEqual(removeLanPairing(both, pairing.id).map((item) => item.id), ['10.0.0.8:9000']);

  const synced = markLanPairingSynced(both, pairing.id, NOW + 500);
  assert.equal(synced.find((item) => item.id === pairing.id)?.lastSyncAt, NOW + 500);
  assert.equal(updateLanPairingToken(both, pairing.id, 'c'.repeat(32)).find((item) => item.id === pairing.id)?.token, 'c'.repeat(32));

  const session = pairingSession(pairing);
  assert.deepEqual(session.peer, PEER);
  assert.equal(session.token, TOKEN);
  assert.ok(session.expiresAt > NOW, '本地会话不因服务端到期时间提前失效');
});

test('序列化与解析：丢弃非法、按地址去重、容忍损坏 JSON', () => {
  const pairing = sample();
  const text = serializeLanPairings([pairing]);
  const parsed = parseLanPairings(JSON.parse(text));
  assert.deepEqual(parsed, [pairing]);
  assert.deepEqual(parseLanPairingsJson(text), [pairing]);
  assert.deepEqual(parseLanPairingsJson('not json'), []);
  assert.deepEqual(parseLanPairingsJson(null), []);

  const dirty = parseLanPairings([
    pairing,
    { ...pairing, name: '重复地址' },
    { ...pairing, id: 'x', host: '8.8.8.8' },
    { ...pairing, host: '192.168.1.9', token: 'plain' },
    { ...pairing, host: 'not-an-ip' },
    null,
  ]);
  assert.equal(dirty?.length, 1);
  assert.equal(dirty?.[0]?.name, '书房电脑');
  assert.equal(parseLanPairings({ not: 'array' }), null);
});

test('持久化出口：app_meta 与 localStorage 双通道', async () => {
  const storage = createStorage();
  const metaStore = createLanPairingStore(storage, { localStorage: null });
  assert.deepEqual(await metaStore.load(), []);
  const pairing = sample();
  await metaStore.save([pairing]);
  assert.deepEqual(await metaStore.load(), [pairing]);
  const raw = await storage.readMeta('lan_pairings_v1');
  assert.ok((raw ?? '').includes(TOKEN), '客户端需要保存明文令牌用于重连');

  const memory = new Map<string, string>();
  const localStore = createLanPairingStore(storage, {
    localStorage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
    },
  });
  await localStore.save([pairing]);
  assert.ok(memory.get('dt.lan.pairings.v1')?.includes(TOKEN));
  assert.deepEqual(await localStore.load(), [pairing]);
});

test('自动重连状态机：在线/离线/失效、探测间隔与令牌换新', () => {
  const online = { id: 'a', state: 'online' as const, error: null, token: 'b'.repeat(32), expiresAt: NOW + 1000 };
  const offline = { id: 'b', state: 'offline' as const, error: '网络不可达' };
  const expired = { id: 'c', state: 'expired' as const, error: '配对已失效' };
  const statuses = reduceLanPairingStatuses({}, [online, offline, expired], NOW);
  assert.equal(statuses.a?.state, 'online');
  assert.equal(statuses.b?.state, 'offline');
  assert.equal(statuses.c?.state, 'expired');
  assert.equal(statuses.a?.checkedAt, NOW);
  assert.equal(lanPairingStatusText(statuses.a), '在线');
  assert.equal(lanPairingStatusText(statuses.b), LAN_PAIRING_OFFLINE_HINT);
  assert.match(lanPairingStatusText(statuses.c) ?? '', /配对已失效/);
  assert.equal(lanPairingStatusText(undefined), '未检测');

  assert.equal(shouldProbePairing(undefined, NOW), true);
  assert.equal(shouldProbePairing({ state: 'offline', checkedAt: NOW, error: null }, NOW + 1000), false);
  assert.equal(
    shouldProbePairing({ state: 'offline', checkedAt: NOW, error: null }, NOW + LAN_RECONNECT_INTERVAL_MS),
    true,
  );

  const list = [sample(), sample({ id: '10.0.0.8:9000', host: '10.0.0.8', port: 9000, token: 'b'.repeat(32) })];
  const applied = applyLanPairProbes(list, [
    { ...online, id: list[0]!.id },
    { ...offline, id: list[1]!.id },
  ]);
  assert.equal(applied[0]?.token, 'b'.repeat(32));
  assert.equal(applied[1]?.token, 'b'.repeat(32), '离线不删除也不改令牌');
  assert.deepEqual(applyLanPairProbes(list, [{ ...offline, id: list[0]!.id }]), list);
});

test('探测：成功换新令牌、401 标记失效、断网标记离线', async () => {
  const pairing = sample();
  let mode: 'ok' | 'unauthorized' | 'offline' = 'ok';
  const restore = stubFetch(async (url, init) => {
    assert.match(url, /\/pair\/refresh$/);
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${TOKEN}`);
    if (mode === 'offline') throw new Error('fetch failed');
    if (mode === 'unauthorized') {
      return new Response(JSON.stringify({ error: { code: 'unauthorized', message: '配对已失效，请重新配对' } }), {
        status: 401,
      });
    }
    return new Response(JSON.stringify({ token: 'd'.repeat(32), expiresAt: NOW + 1000 }), { status: 200 });
  });
  try {
    const online = await probeLanPairing(pairing, NOW);
    assert.equal(online.state, 'online');
    assert.equal(online.token, 'd'.repeat(32));
    assert.equal(online.expiresAt, NOW + 1000);

    mode = 'unauthorized';
    const expired = await probeLanPairing(pairing, NOW);
    assert.equal(expired.state, 'expired');
    assert.match(expired.error ?? '', /配对已失效/);

    mode = 'offline';
    const offline = await probeLanPairing(pairing, NOW);
    assert.equal(offline.state, 'offline');
    assert.match(offline.error ?? '', /fetch failed/);
  } finally {
    restore();
  }
});
