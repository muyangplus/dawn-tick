import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../../../packages/core/test/helpers.ts';
import {
  createLanPairing,
  findLanPairingByPeer,
  formatLanPairingLabel,
  formatLanPairingLastSeen,
  formatLanPairingLastSync,
  markLanPairingDiscoveryName,
  markLanPairingSeen,
  markLanPairingSynced,
  pairingSession,
  parseLanPairings,
  parseLanPairingsJson,
  removeLanPairing,
  serializeLanPairings,
  updateLanPairingAddress,
  updateLanPairingToken,
  upsertLanPairing,
  type LanPairing,
} from '../src/lan-pairings.ts';
import { applyLanPairProbes, probeLanPairing } from '../src/lan-sync-reconnect.ts';
import { createLanPairingStore, rememberLanPairing } from '../src/lan-sync-pairing-store.ts';
import { setLanDiscoveryScannerForTests } from '../src/lan-sync-discovery.ts';

const NOW = 1759900000000;
const TOKEN = 'a'.repeat(32);
const PEER = { host: '192.168.1.5', port: 8765 };

function sample(overrides: Partial<LanPairing> = {}): LanPairing {
  return {
    id: 'peer-a',
    deviceId: 'peer-a',
    name: '书房电脑',
    discoveryName: null,
    host: PEER.host,
    port: PEER.port,
    token: TOKEN,
    pairedAt: NOW,
    lastSyncAt: null,
    lastSeen: NOW,
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

test('配对记录：新建、按 deviceId / 名称去重、端口覆盖、移除', () => {
  const pairing = createLanPairing({
    peer: PEER,
    token: TOKEN,
    name: '书房电脑',
    deviceId: 'peer-a',
    now: NOW,
  });
  assert.equal(pairing.id, 'peer-a');
  assert.equal(pairing.deviceId, 'peer-a');
  assert.equal(pairing.name, '书房电脑');
  assert.equal(pairing.lastSyncAt, null);
  assert.equal(pairing.lastSeen, NOW);
  assert.equal(formatLanPairingLabel(pairing), '书房电脑 · 192.168.1.5:8765');
  assert.equal(formatLanPairingLastSync(pairing), '尚未同步');
  assert.match(formatLanPairingLastSeen(pairing), /最近在线/);

  const fallback = createLanPairing({ peer: PEER, token: TOKEN, now: NOW });
  assert.equal(fallback.name, '192.168.1.5:8765');
  assert.match(fallback.deviceId, /^peer-/);

  // 同一 deviceId 换端口：覆盖旧地址，不新增记录，保留首次配对时间
  const moved = createLanPairing({
    peer: { host: '10.0.0.8', port: 38739 },
    token: 'b'.repeat(32),
    name: '书房电脑',
    deviceId: 'peer-a',
    now: NOW + 1000,
  });
  const movedList = upsertLanPairing([pairing], moved);
  assert.equal(movedList.length, 1);
  assert.equal(movedList[0]?.id, 'peer-a');
  assert.equal(movedList[0]?.host, '10.0.0.8');
  assert.equal(movedList[0]?.port, 38739);
  assert.equal(movedList[0]?.token, 'b'.repeat(32));
  assert.equal(movedList[0]?.pairedAt, NOW, '重新配对不重置首次配对时间');

  // 只按设备名认（没有对端 deviceId）时同样原地覆盖
  const named = createLanPairing({
    peer: { host: '10.0.0.9', port: 40000 },
    token: 'c'.repeat(32),
    name: '书房电脑',
    now: NOW + 2000,
  });
  const namedList = upsertLanPairing([pairing], named);
  assert.equal(namedList.length, 1);
  assert.equal(namedList[0]?.id, 'peer-a');
  assert.equal(namedList[0]?.port, 40000);

  const other = createLanPairing({
    peer: { host: '10.0.0.20', port: 9000 },
    token: 'd'.repeat(32),
    name: '手机',
    deviceId: 'peer-b',
    now: NOW - 1,
  });
  const both = upsertLanPairing([pairing], other);
  assert.deepEqual(both.map((item) => item.id), ['peer-a', 'peer-b']);
  assert.equal(upsertLanPairing(both, { ...pairing, name: '改名' }).length, 2);
  assert.equal(removeLanPairing(both, pairing.id).length, 1);

  const addressed = updateLanPairingAddress(both, 'peer-a', { host: '172.20.1.2', port: 41000 }, NOW + 500);
  assert.equal(addressed.find((item) => item.id === 'peer-a')?.host, '172.20.1.2');
  assert.equal(addressed.length, 2);
  assert.equal(findLanPairingByPeer(addressed, { host: '172.20.1.2', port: 41000 })?.id, 'peer-a');

  const synced = markLanPairingSynced(both, pairing.id, NOW + 600);
  assert.equal(synced.find((item) => item.id === pairing.id)?.lastSyncAt, NOW + 600);
  assert.equal(synced.find((item) => item.id === pairing.id)?.lastSeen, NOW + 600);
  assert.equal(markLanPairingSeen(both, pairing.id, NOW + 700).find((item) => item.id === pairing.id)?.lastSeen, NOW + 700);
  assert.equal(
    markLanPairingDiscoveryName(both, pairing.id, 'DESKTOP-ABC').find((item) => item.id === pairing.id)
      ?.discoveryName,
    'DESKTOP-ABC',
  );
  assert.equal(updateLanPairingToken(both, pairing.id, 'e'.repeat(32)).find((item) => item.id === pairing.id)?.token, 'e'.repeat(32));

  const session = pairingSession(pairing);
  assert.deepEqual(session.peer, PEER);
  assert.equal(session.token, TOKEN);
  assert.ok(session.expiresAt > NOW, '本地会话不因服务端到期时间提前失效');
});

test('序列化与解析：保留设备 id/最近地址/令牌，按 id 与 deviceId 去重', () => {
  const pairing = sample();
  const text = serializeLanPairings([pairing]);
  const parsed = parseLanPairings(JSON.parse(text));
  assert.deepEqual(parsed, [pairing]);
  assert.deepEqual(parseLanPairingsJson(text), [pairing]);
  assert.deepEqual(parseLanPairingsJson('not json'), []);
  assert.deepEqual(parseLanPairingsJson(null), []);

  // 旧记录没有 deviceId：沿用 host:port 作为设备身份，仍能读出来
  const legacy = parseLanPairings([
    { id: '192.168.1.5:8765', name: '旧电脑', host: '192.168.1.5', port: 8765, token: TOKEN, pairedAt: NOW, lastSyncAt: null },
  ]);
  assert.equal(legacy?.[0]?.id, '192.168.1.5:8765');
  assert.equal(legacy?.[0]?.deviceId, '192.168.1.5:8765');
  assert.equal(legacy?.[0]?.lastSeen, null);

  const dirty = parseLanPairings([
    pairing,
    { ...pairing, name: '重复设备' },
    { ...pairing, id: 'x', deviceId: 'peer-a', host: '8.8.8.8' },
    { ...pairing, id: 'y', deviceId: 'peer-y', host: '192.168.1.9', token: 'plain' },
    { ...pairing, id: 'z', deviceId: 'peer-z', host: 'not-an-ip' },
    null,
  ]);
  assert.equal(dirty?.length, 1);
  assert.equal(dirty?.[0]?.name, '书房电脑');
  assert.equal(parseLanPairings({ not: 'array' }), null);
});

test('持久化出口：app_meta 与 localStorage 双通道都保存设备元信息', async () => {
  const storage = createStorage();
  const metaStore = createLanPairingStore(storage, { localStorage: null });
  assert.deepEqual(await metaStore.load(), []);
  const pairing = sample();
  await metaStore.save([pairing]);
  assert.deepEqual(await metaStore.load(), [pairing]);
  const raw = await storage.readMeta('lan_pairings_v1');
  assert.ok((raw ?? '').includes(TOKEN), '客户端需要保存明文令牌用于重连');
  assert.ok((raw ?? '').includes('"deviceId":"peer-a"'));
  assert.ok((raw ?? '').includes('"host":"192.168.1.5"'));

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
  assert.ok(memory.get('dt.lan.pairings.v1')?.includes('"deviceId":"peer-a"'));
  assert.deepEqual(await localStore.load(), [pairing]);
});

test('探测：先快速 /ping，再刷新令牌；401 失效、连不上离线', async () => {
  const pairing = sample();
  let mode: 'ok' | 'unauthorized' | 'offline' = 'ok';
  const calls: string[] = [];
  const restore = stubFetch(async (url, init) => {
    if (url.endsWith('/ping')) {
      calls.push('ping');
      if (mode === 'offline') throw new Error('fetch failed: ECONNREFUSED 192.168.1.5:8765');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    assert.match(url, /\/pair\/refresh$/);
    calls.push('refresh');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${TOKEN}`);
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
    assert.deepEqual(calls, ['ping', 'refresh']);

    calls.length = 0;
    mode = 'unauthorized';
    const expired = await probeLanPairing(pairing, NOW);
    assert.equal(expired.state, 'expired');
    assert.match(expired.error ?? '', /配对已失效/);
    assert.deepEqual(calls, ['ping', 'refresh']);

    calls.length = 0;
    mode = 'offline';
    const offline = await probeLanPairing(pairing, NOW);
    assert.equal(offline.state, 'offline');
    assert.match(offline.error ?? '', /ECONNREFUSED/);
    assert.deepEqual(calls, ['ping'], '旧地址连不上时不再等完整的刷新超时');
  } finally {
    restore();
  }
});

test('探测结果：在线换新令牌与 lastSeen，离线/失效不动记录', () => {
  const list = [sample(), sample({ id: 'peer-b', deviceId: 'peer-b', host: '10.0.0.8', port: 9000, token: 'b'.repeat(32) })];
  const online = { id: 'peer-a', state: 'online' as const, error: null, token: 'c'.repeat(32), expiresAt: NOW + 1000 };
  const offline = { id: 'peer-b', state: 'offline' as const, error: '网络不可达' };
  const applied = applyLanPairProbes(list, [online, offline], NOW + 50);
  assert.equal(applied[0]?.token, 'c'.repeat(32));
  assert.equal(applied[0]?.lastSeen, NOW + 50);
  assert.equal(applied[1]?.token, 'b'.repeat(32), '离线不删除也不改令牌');
  assert.equal(applied[1]?.lastSeen, NOW);
  assert.deepEqual(applyLanPairProbes(list, [{ ...offline, id: 'peer-a' }], NOW + 50), list);
});

test('真实 deviceId：同地址旧记录原地升级，同 deviceId 换 IP 只留一条', () => {
  const realId = '123e4567-e89b-42d3-a456-426614174000';
  // 旧记录只有本机临时 id（不知道对端真实身份）
  const legacy = createLanPairing({ peer: PEER, token: TOKEN, name: '书房电脑', now: NOW });
  assert.match(legacy.deviceId, /^peer-/);

  // 重新配对 / 扫码拿到真实 deviceId：同地址合并成一条，id 保持本地记录键
  const upgraded = upsertLanPairing([legacy], {
    ...legacy,
    deviceId: realId,
    token: 'b'.repeat(32),
    pairedAt: NOW + 100,
  });
  assert.equal(upgraded.length, 1);
  assert.equal(upgraded[0]?.id, legacy.id);
  assert.equal(upgraded[0]?.deviceId, realId);

  // 同 deviceId 换 IP / 端口：原地更新，不新增
  const moved = upsertLanPairing(upgraded, {
    ...upgraded[0]!,
    host: '10.0.0.8',
    port: 38739,
    name: '书房电脑改名',
    pairedAt: NOW + 200,
  });
  assert.equal(moved.length, 1);
  assert.equal(moved[0]?.host, '10.0.0.8');
  assert.equal(moved[0]?.port, 38739);

  // 同名但真实 id 不同的另一台设备：不按名字误合并
  const other = createLanPairing({
    peer: { host: '10.0.0.9', port: 40000 },
    token: 'c'.repeat(32),
    name: '书房电脑',
    deviceId: 'other-device-0001',
    now: NOW + 300,
  });
  assert.equal(upsertLanPairing(moved, other).length, 2);
});

test('配对成功写回：payload 的 deviceId 优先，扫描结果兜底并记广播名', async () => {
  const storage = createStorage();
  const store = createLanPairingStore(storage, { localStorage: null });
  const qrId = '123e4567-e89b-42d3-a456-426614174000';
  const scanId = 'scan-device-0001';
  setLanDiscoveryScannerForTests(async () => [
    { name: 'DESKTOP-ABC', host: PEER.host, port: PEER.port, deviceId: scanId, seenAt: NOW },
  ]);
  try {
    // 扫码 / 粘贴带了 deviceId：直接写对端身份，同时记下 UDP 广播名
    await rememberLanPairing(
      store,
      { peer: PEER, token: TOKEN, expiresAt: NOW + 1000 },
      { name: 'Windows 电脑', deviceId: qrId, now: NOW },
    );
    let list = await store.load();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.deviceId, qrId, '优先使用二维码里的对端 deviceId');
    assert.equal(list[0]?.id, qrId);
    assert.equal(list[0]?.discoveryName, 'DESKTOP-ABC');

    // 没有 payload deviceId（手输地址 / 旧二维码）：用同一地址的扫描结果兜底
    await store.save([]);
    await rememberLanPairing(
      store,
      { peer: PEER, token: TOKEN, expiresAt: NOW + 1000 },
      { name: 'Windows 电脑', now: NOW + 10 },
    );
    list = await store.load();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.deviceId, scanId, '扫描到的真实 deviceId 兜底');
  } finally {
    setLanDiscoveryScannerForTests(null);
  }
});
