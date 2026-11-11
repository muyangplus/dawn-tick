import test from 'node:test';
import assert from 'node:assert/strict';
import { setLanDiscoveryScannerForTests, type LanDiscoveryPeer } from '../src/lan-sync-discovery.ts';
import {
  LAN_PAIRING_OFFLINE_HINT,
  LAN_RECONNECT_INTERVAL_MS,
  LAN_RECONNECT_MAX_MS,
  applyDiscoveryAddress,
  discoverPairingAddresses,
  formatLanPairingRetry,
  lanPairingStatusText,
  matchDiscoveryPeer,
  nextRetryDelayMs,
  reduceLanPairingStatuses,
  shouldProbePairing,
} from '../src/lan-sync-reconnect.ts';
import { createLanPairing, type LanPairing, type LanPairProbe } from '../src/lan-pairings.ts';

const NOW = 1759900000000;
const TOKEN = 'a'.repeat(32);

function sample(overrides: Partial<LanPairing> = {}): LanPairing {
  return {
    id: 'peer-a',
    deviceId: 'book-pc',
    name: '书房电脑',
    discoveryName: null,
    host: '192.168.1.5',
    port: 37993,
    token: TOKEN,
    pairedAt: NOW,
    lastSyncAt: null,
    lastSeen: NOW,
    ...overrides,
  };
}

function peer(overrides: Partial<LanDiscoveryPeer> = {}): LanDiscoveryPeer {
  return { name: '书房电脑', host: '10.0.0.8', port: 38739, seenAt: NOW, ...overrides };
}

function offlineProbe(id = 'peer-a'): LanPairProbe {
  return { id, state: 'offline', error: 'ECONNREFUSED 192.168.1.5:37993' };
}

test('重连退避：30 秒起步、每次翻倍、5 分钟封顶', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((failures) => nextRetryDelayMs(failures)),
    [30_000, 60_000, 120_000, 240_000, LAN_RECONNECT_MAX_MS, LAN_RECONNECT_MAX_MS],
  );
  assert.equal(LAN_RECONNECT_MAX_MS, 5 * 60_000);
});

test('离线累计失败并退避；在线归零；失效停止自动重试', () => {
  let statuses = reduceLanPairingStatuses({}, [offlineProbe()], NOW);
  assert.equal(statuses['peer-a']?.state, 'offline');
  assert.equal(statuses['peer-a']?.failures, 1);
  assert.equal(statuses['peer-a']?.nextRetryAt, NOW + LAN_RECONNECT_INTERVAL_MS);
  assert.equal(shouldProbePairing(statuses['peer-a'], NOW + 1), false);
  assert.equal(shouldProbePairing(statuses['peer-a'], NOW + LAN_RECONNECT_INTERVAL_MS), true);
  assert.match(lanPairingStatusText(statuses['peer-a']), /离线（端口可能已变化）/);
  assert.match(lanPairingStatusText(statuses['peer-a']), /重新开启配对/);
  assert.match(formatLanPairingRetry(statuses['peer-a'], NOW), /下次重试：30 秒后/);

  statuses = reduceLanPairingStatuses(statuses, [offlineProbe()], NOW + 60_000);
  assert.equal(statuses['peer-a']?.failures, 2);
  assert.equal(statuses['peer-a']?.nextRetryAt, NOW + 60_000 + 60_000, '第二次失败退避 60 秒');
  assert.equal(shouldProbePairing(statuses['peer-a'], NOW + 119_000), false);

  // 一直失败：退避封顶 5 分钟，但状态仍是离线、不会无限打旧地址
  let at = NOW + 60_000;
  for (let attempt = 3; attempt <= 8; attempt += 1) {
    at += LAN_RECONNECT_MAX_MS;
    statuses = reduceLanPairingStatuses(statuses, [offlineProbe()], at);
  }
  assert.equal(statuses['peer-a']?.failures, 8);
  assert.ok(
    (statuses['peer-a']?.nextRetryAt ?? 0) - at <= LAN_RECONNECT_MAX_MS,
    '退避不超过 5 分钟',
  );

  const online = reduceLanPairingStatuses(
    statuses,
    [{ id: 'peer-a', state: 'online', error: null, token: 'b'.repeat(32), expiresAt: NOW + 1000 }],
    at + 1,
  );
  assert.equal(online['peer-a']?.state, 'online');
  assert.equal(online['peer-a']?.failures, 0);
  assert.equal(lanPairingStatusText(online['peer-a']), '在线');

  const expired = reduceLanPairingStatuses(
    online,
    [{ id: 'peer-a', state: 'expired', error: '配对已失效' }],
    at + 2,
  );
  assert.equal(expired['peer-a']?.state, 'expired');
  assert.equal(expired['peer-a']?.nextRetryAt, Number.POSITIVE_INFINITY);
  assert.equal(shouldProbePairing(expired['peer-a'], at + 10 * LAN_RECONNECT_MAX_MS), false);
  assert.match(lanPairingStatusText(expired['peer-a']), /重新配对/);
  assert.equal(lanPairingStatusText(undefined), '未检测');
});

test('对方换 IP / 整网切换：同 deviceId 发现后原地更新地址并重连', async () => {
  const pairing = sample();
  const other = sample({ id: 'peer-b', deviceId: 'phone', name: '手机', host: '192.168.1.6', port: 40000 });
  const found = peer({ deviceId: 'book-pc', host: '10.0.0.8', port: 38739 });

  const updated = applyDiscoveryAddress(pairing, [found], NOW + 10);
  assert.ok(updated !== null);
  assert.equal(updated?.id, 'peer-a', '记录 id 不变，列表不会新增一条');
  assert.equal(updated?.deviceId, 'book-pc');
  assert.equal(updated?.host, '10.0.0.8');
  assert.equal(updated?.port, 38739);
  assert.equal(updated?.token, TOKEN, '令牌随记录保留');
  assert.equal(updated?.pairedAt, NOW);
  assert.equal(updated?.lastSeen, NOW + 10);

  // 两台设备一起换到 10.0.0.0/24：UDP 发现仍按 deviceId 找回
  setLanDiscoveryScannerForTests(async () => [
    found,
    peer({ name: '手机', host: '10.0.0.9', port: 40100, deviceId: 'phone' }),
  ]);
  try {
    const result = await discoverPairingAddresses([pairing, other], [pairing, other], NOW + 20);
    assert.equal(result.scanned, 2);
    assert.equal(result.updated.length, 2);
    assert.equal(result.pairings.length, 2, '地址变化不新增记录');
    assert.equal(result.pairings.find((item) => item.id === 'peer-a')?.host, '10.0.0.8');
    assert.equal(result.pairings.find((item) => item.id === 'peer-b')?.port, 40100);
  } finally {
    setLanDiscoveryScannerForTests(null);
  }
});

test('发现不到新地址：不修改记录，离线后按退避重试而不是无限打旧端口', async () => {
  const pairing = sample();
  setLanDiscoveryScannerForTests(async () => []);
  try {
    const result = await discoverPairingAddresses([pairing], [pairing], NOW);
    assert.equal(result.updated.length, 0);
    assert.deepEqual(result.pairings, [pairing]);
  } finally {
    setLanDiscoveryScannerForTests(null);
  }

  const statuses = reduceLanPairingStatuses({}, [offlineProbe()], NOW);
  assert.equal(shouldProbePairing(statuses['peer-a'], NOW + 1_000), false, '退避期间不再打旧地址');
  assert.equal(shouldProbePairing(statuses['peer-a'], NOW + LAN_RECONNECT_INTERVAL_MS), true);
  assert.match(LAN_PAIRING_OFFLINE_HINT, /端口可能已变化/);
});

test('没有对端 deviceId 时按设备名兜底，首次发现补上真实 deviceId', () => {
  const localPairing = sample({ deviceId: 'peer-local' });
  const found = peer({ deviceId: 'pc-real', host: '172.20.1.2', port: 41000 });
  const updated = applyDiscoveryAddress(localPairing, [found], NOW + 5);
  assert.equal(updated?.id, 'peer-a');
  assert.equal(updated?.deviceId, 'pc-real');
  assert.equal(updated?.host, '172.20.1.2');
  assert.equal(updated?.port, 41000);
  assert.equal(matchDiscoveryPeer(localPairing, [found])?.deviceId, 'pc-real');

  // 已知真实 id 后，同名但 id 不同的设备不会被误认成同一台
  const trusted = sample({ deviceId: 'pc-real' });
  assert.equal(matchDiscoveryPeer(trusted, [peer({ deviceId: 'another-pc' })]), null);
});

test('二维码展示名与 UDP 广播名不同：记下广播名后换 IP 仍能认回同一台', () => {
  const pairing = sample({ name: 'Windows 电脑', discoveryName: 'DESKTOP-ABC' });
  const found = peer({ name: 'DESKTOP-ABC', host: '10.0.0.8', port: 41000, deviceId: undefined });
  const updated = applyDiscoveryAddress(pairing, [found], NOW + 1);
  assert.equal(updated?.host, '10.0.0.8');
  assert.equal(updated?.port, 41000);
  assert.equal(updated?.discoveryName, 'DESKTOP-ABC');
  assert.equal(updated?.name, 'Windows 电脑', '展示名保持不变');

  // 同名展示名的另一台设备不会被误认
  const wrong = peer({ name: 'Windows 电脑', host: '10.0.0.9', port: 42000, deviceId: undefined });
  assert.equal(applyDiscoveryAddress(pairing, [wrong], NOW + 1), null);
});

test('新建记录时可用给定 deviceId 作为稳定主键', () => {
  const created = createLanPairing({
    peer: { host: '192.168.1.5', port: 37993 },
    token: TOKEN,
    deviceId: 'book-pc',
    now: NOW,
  });
  assert.equal(created.deviceId, 'book-pc');
  assert.equal(created.id, 'book-pc');
});
