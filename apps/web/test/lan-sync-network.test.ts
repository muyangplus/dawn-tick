import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAN_HOST_STORAGE_KEY,
  LAN_KIND_LABEL,
  compareLanNetworks,
  defaultLanNetwork,
  formatLanNetworkLabel,
  formatLanNetworkLine,
  isPreferredLanAddress,
  lanAddressRank,
  listLanNetworks,
  parseLanNetworks,
  readStoredLanHost,
  resolveLanHost,
  saveStoredLanHost,
  setLanNetworkListerForTests,
  sortLanNetworks,
  type LanHostStorage,
  type LanNetwork,
} from '../src/lan-sync-network.ts';

const WIFI: LanNetwork = {
  name: 'WLAN',
  address: '192.168.1.23',
  isLan: true,
  kind: 'wifi',
  preferred: 0,
};
const ETHERNET: LanNetwork = {
  name: '以太网',
  address: '10.0.0.8',
  isLan: true,
  kind: 'ethernet',
  preferred: 1,
};
const CAMPUS: LanNetwork = {
  name: '校园网',
  address: '172.20.1.2',
  isLan: true,
  kind: 'ethernet',
  preferred: 2,
};
const TAILSCALE: LanNetwork = {
  name: 'Tailscale',
  address: '192.168.9.9',
  isLan: true,
  kind: 'vpn',
  preferred: 0,
};
const VMNET: LanNetwork = {
  name: 'VMnet8',
  address: '172.20.9.1',
  isLan: true,
  kind: 'vpn',
  preferred: 2,
};
const PUBLIC: LanNetwork = {
  name: '公网',
  address: '203.0.113.9',
  isLan: false,
  kind: 'other',
  preferred: 9,
};

function memoryStorage(initial: Record<string, string> = {}): LanHostStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

test('网段优先级：192.168 > 10 > 172.16–31 > 100.64 > 169.254', () => {
  assert.equal(lanAddressRank('192.168.1.23'), 0);
  assert.equal(lanAddressRank('10.2.3.4'), 1);
  assert.equal(lanAddressRank('172.16.0.1'), 2);
  assert.equal(lanAddressRank('172.31.255.254'), 2);
  assert.equal(lanAddressRank('172.32.0.1'), 9);
  assert.equal(lanAddressRank('100.100.1.1'), 3);
  assert.equal(lanAddressRank('169.254.1.1'), 4);
  assert.equal(lanAddressRank('8.8.8.8'), 9);
  assert.equal(lanAddressRank('not-an-ip'), 9);
  assert.equal(isPreferredLanAddress('192.168.1.23'), true);
  assert.equal(isPreferredLanAddress('10.0.0.8'), true);
  assert.equal(isPreferredLanAddress('100.64.0.1'), false);
});

test('候选排序：局域网优先、VPN 降级、常见网段优先', () => {
  const sorted = sortLanNetworks([PUBLIC, VMNET, TAILSCALE, CAMPUS, ETHERNET, WIFI]);
  assert.deepEqual(
    sorted.map((item) => item.address),
    ['192.168.1.23', '10.0.0.8', '172.20.1.2', '192.168.9.9', '172.20.9.1', '203.0.113.9'],
  );
  // 比较函数与排序结果一致（可单独用于稳定比较）
  assert.ok(compareLanNetworks(WIFI, ETHERNET) < 0);
  assert.ok(compareLanNetworks(TAILSCALE, CAMPUS) > 0);
  assert.ok(compareLanNetworks(ETHERNET, PUBLIC) < 0);
  // 不改动入参
  assert.equal(PUBLIC.address, '203.0.113.9');
});

test('默认选择：第一条局域网地址，VPN-only 时仍可用', () => {
  assert.equal(defaultLanNetwork([PUBLIC, ETHERNET, WIFI])?.address, '192.168.1.23');
  assert.equal(defaultLanNetwork([PUBLIC, TAILSCALE])?.address, '192.168.9.9');
  assert.equal(defaultLanNetwork([PUBLIC]), null);
  assert.equal(defaultLanNetwork([]), null);
});

test('切换网络：存储的地址仍在本机候选里就生效，否则退回首选', () => {
  const networks = [WIFI, ETHERNET, TAILSCALE];
  assert.equal(resolveLanHost(networks, '10.0.0.8'), '10.0.0.8');
  assert.equal(resolveLanHost(networks, '192.168.1.23'), '192.168.1.23');
  // 上次存的网卡已经拔掉 / 不在本机：退回默认首选
  assert.equal(resolveLanHost(networks, '192.168.50.1'), '192.168.1.23');
  // 存储值非法：同样退回默认
  assert.equal(resolveLanHost(networks, '8.8.8.8'), '192.168.1.23');
  assert.equal(resolveLanHost(networks, null), '192.168.1.23');
  assert.equal(resolveLanHost([PUBLIC], null), null);
});

test('地址文案：「网络：192.168.1.23 · Wi-Fi」', () => {
  assert.equal(formatLanNetworkLabel(WIFI), '192.168.1.23 · Wi-Fi');
  assert.equal(formatLanNetworkLine(WIFI), '网络：192.168.1.23 · Wi-Fi');
  assert.equal(formatLanNetworkLabel(ETHERNET), '10.0.0.8 · 有线网络');
  assert.equal(formatLanNetworkLabel(TAILSCALE), '192.168.9.9 · VPN');
  assert.equal(LAN_KIND_LABEL.other, '其他');
});

test('选中地址存 localStorage 的 dt.lan.host，只存地址', () => {
  const storage = memoryStorage();
  saveStoredLanHost('10.0.0.8', storage);
  assert.equal(storage.values.get(LAN_HOST_STORAGE_KEY), '10.0.0.8');
  assert.equal(readStoredLanHost(storage), '10.0.0.8');
  saveStoredLanHost('', storage);
  assert.equal(readStoredLanHost(storage), null);
  // 非局域网地址不记忆
  storage.setItem(LAN_HOST_STORAGE_KEY, '8.8.8.8');
  assert.equal(readStoredLanHost(storage), null);
  // 存储不可用时不抛
  assert.equal(readStoredLanHost(null), null);
  saveStoredLanHost('192.168.1.23', null);
});

test('原生候选归一：丢非法字段、去重并排序', () => {
  const parsed = parseLanNetworks([
    { name: 'WLAN', address: '192.168.1.23', isLan: true, kind: 'wifi', preferred: 0 },
    { name: 'WLAN 副本', address: '192.168.1.23', isLan: true, kind: 'wifi', preferred: 0 },
    { name: '公网', address: '8.8.8.8', isLan: false, kind: 'other', preferred: 9 },
    { name: '', address: '10.0.0.8', isLan: true, kind: 'ethernet', preferred: 1 },
    { name: '未知分类', address: '172.20.1.2', isLan: true, kind: 'bluetooth', preferred: 2 },
    { name: '无字段' },
    'garbage',
    { name: 'Tailscale', address: '100.100.1.1', isLan: true, kind: 'vpn', preferred: 3 },
  ]);
  assert.deepEqual(
    parsed.map((item) => item.address),
    ['192.168.1.23', '100.100.1.1'],
  );
  assert.deepEqual(parseLanNetworks(null), []);
  assert.deepEqual(parseLanNetworks({}), []);
});

test('原生列表读取：桌面调 lan_network_list（本例用测试桩覆盖）', async () => {
  setLanNetworkListerForTests(async () => [PUBLIC, ETHERNET, WIFI]);
  try {
    const networks = await listLanNetworks();
    assert.equal(networks[0]?.address, '192.168.1.23');
    assert.equal(networks.at(-1)?.address, '10.0.0.8');
  } finally {
    setLanNetworkListerForTests(null);
  }
  setLanNetworkListerForTests(async () => {
    throw new Error('枚举失败');
  });
  try {
    assert.deepEqual(await listLanNetworks(), []);
  } finally {
    setLanNetworkListerForTests(null);
  }
});
