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
