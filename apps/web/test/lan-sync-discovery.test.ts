import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAN_DISCOVERY_KIND,
  LAN_DISCOVERY_SCHEMA_VERSION,
  LAN_DISCOVERY_TTL_MS,
  LAN_DISCOVERY_TIMEOUT_MS,
  canDiscoverLanPeers,
  dedupeDiscoveryPeers,
  encodeDiscoveryAnnounce,
  filterDiscoverySelf,
  formatDiscoveryPeer,
  parseDiscoveryAnnounce,
  pruneDiscoveryPeers,
  scanLanPeers,
  type LanDiscoveryPeer,
} from '../src/lan-sync-discovery.ts';

const NOW = 1759900000000;

function peer(name: string, host: string, port: number, seenAt = NOW): LanDiscoveryPeer {
  return { name, host, port, seenAt };
}

test('发现包编解码：字段、版本与局域网地址校验', () => {
  const packet = encodeDiscoveryAnnounce({ name: '  书房电脑  ', host: '192.168.1.5', port: 8765 });
  const parsed = parseDiscoveryAnnounce(packet);
  assert.deepEqual(parsed, {
    kind: LAN_DISCOVERY_KIND,
    schemaVersion: LAN_DISCOVERY_SCHEMA_VERSION,
    name: '书房电脑',
    host: '192.168.1.5',
    port: 8765,
  });
  assert.match(packet, /"kind":"dawn-tick-lan-discover"/);
  assert.match(packet, /"schemaVersion":1/);
  assert.equal(parseDiscoveryAnnounce('not json'), null);
  assert.equal(parseDiscoveryAnnounce(JSON.stringify({ ...parsed, kind: 'other' })), null);
  assert.equal(parseDiscoveryAnnounce(JSON.stringify({ ...parsed, schemaVersion: 2 })), null);
  assert.equal(parseDiscoveryAnnounce(JSON.stringify({ ...parsed, host: '8.8.8.8' })), null);
  assert.equal(parseDiscoveryAnnounce(JSON.stringify({ ...parsed, port: 0 })), null);
  assert.equal(parseDiscoveryAnnounce(JSON.stringify({ ...parsed, name: '   ' })), null);
  assert.throws(() => encodeDiscoveryAnnounce({ name: '', host: '192.168.1.5', port: 8765 }));
  assert.throws(() => encodeDiscoveryAnnounce({ name: '电脑', host: 'example.com', port: 8765 }));
  assert.throws(() => encodeDiscoveryAnnounce({ name: '电脑', host: '192.168.1.5', port: 70000 }));
});

test('发现包 deviceId：可选、非法值只丢字段、旧包缺省仍可解析', () => {
  const withId = encodeDiscoveryAnnounce({
    name: '手机',
    host: '192.168.1.8',
    port: 8765,
    deviceId: '123e4567-e89b-42d3-a456-426614174000',
  });
  assert.match(withId, /"deviceId":"123e4567-e89b-42d3-a456-426614174000"/);
  assert.equal(parseDiscoveryAnnounce(withId)?.deviceId, '123e4567-e89b-42d3-a456-426614174000');

  // 旧版本广播没有 deviceId：仍能解析，字段缺省
  const legacy = encodeDiscoveryAnnounce({ name: '旧电脑', host: '192.168.1.5', port: 8765 });
  assert.doesNotMatch(legacy, /deviceId/);
  assert.equal(parseDiscoveryAnnounce(legacy)?.deviceId, undefined);

  // 非法值只丢字段、保留整包（否则旧设备会被误判成「不是晓刻设备」）
  const invalid = JSON.stringify({
    kind: LAN_DISCOVERY_KIND,
    schemaVersion: LAN_DISCOVERY_SCHEMA_VERSION,
    name: '坏 id 设备',
    host: '192.168.1.5',
    port: 8765,
    deviceId: 'bad id!',
  });
  assert.equal(parseDiscoveryAnnounce(invalid)?.name, '坏 id 设备');
  assert.equal(parseDiscoveryAnnounce(invalid)?.deviceId, undefined);
  // 生成时非法 id 直接不写
  assert.doesNotMatch(
    encodeDiscoveryAnnounce({ name: '电脑', host: '192.168.1.5', port: 8765, deviceId: 'bad id!' }),
    /deviceId/,
  );
});

test('发现结果去重：同一地址留最后一条，按名称排序并限量', () => {
  const peers = [
    peer('旧名字', '192.168.1.5', 8765, NOW - 500),
    peer('新名字', '192.168.1.5', 8765, NOW),
    peer('手机', '192.168.1.8', 8765, NOW - 100),
    peer('平板', '10.0.0.2', 8765, NOW - 200),
  ];
  const deduped = dedupeDiscoveryPeers(peers);
  assert.deepEqual(
    deduped.map((item) => `${item.name}@${item.host}`),
    ['平板@10.0.0.2', '手机@192.168.1.8', '新名字@192.168.1.5'],
  );
  assert.equal(dedupeDiscoveryPeers(peers, 2).length, 2);
  assert.equal(dedupeDiscoveryPeers([]).length, 0);
});

test('发现结果去重：有 deviceId 时按 ID 合并同一台设备（优先局域网地址）', () => {
  const deviceId = '123e4567-e89b-42d3-a456-426614174000';
  const peers: LanDiscoveryPeer[] = [
    { name: '书房电脑', host: '127.0.0.1', port: 8765, deviceId, seenAt: NOW + 10 },
    { name: '书房电脑', host: '192.168.1.5', port: 8765, deviceId, seenAt: NOW },
    { name: '另一台', host: '192.168.1.5', port: 9000, deviceId: 'other-device-0001', seenAt: NOW },
  ];
  const deduped = dedupeDiscoveryPeers(peers);
  assert.equal(deduped.length, 2, '同 deviceId 只留一条');
  assert.equal(deduped.find((item) => item.deviceId === deviceId)?.host, '192.168.1.5', '优先非环回地址');
  assert.equal(deduped.find((item) => item.deviceId === 'other-device-0001')?.port, 9000);
});

test('发现结果超时：超过 TTL 移除，本机自己过滤掉', () => {
  const peers = [
    peer('书房电脑', '192.168.1.5', 8765, NOW - LAN_DISCOVERY_TTL_MS),
    peer('手机', '192.168.1.8', 8765, NOW - LAN_DISCOVERY_TTL_MS - 1),
    peer('平板', '10.0.0.2', 8765, NOW),
  ];
  assert.deepEqual(
    pruneDiscoveryPeers(peers, NOW).map((item) => item.name),
    ['书房电脑', '平板'],
  );
  assert.deepEqual(
    filterDiscoverySelf(peers, { host: '192.168.1.5', port: 8765 }).map((item) => item.name),
    ['手机', '平板'],
  );
  assert.equal(filterDiscoverySelf(peers, null).length, 3);
  assert.equal(formatDiscoveryPeer(peer('手机', '192.168.1.8', 8765)), '手机 · 192.168.1.8:8765');
});

test('Web 端不做发现：扫描直接返回空列表', async () => {
  assert.equal(canDiscoverLanPeers(), false);
  const started = Date.now();
  assert.deepEqual(await scanLanPeers(10), []);
  assert.ok(Date.now() - started < LAN_DISCOVERY_TIMEOUT_MS);
});
