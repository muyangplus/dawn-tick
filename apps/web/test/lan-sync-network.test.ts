import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAN_HOST_STORAGE_KEY,
  LAN_KIND_LABEL,
  LAN_NETWORK_EMPTY_HINT,
  LAN_NETWORK_MOBILE_HINT,
  LAN_NETWORK_WIFI_IPV6_HINT,
  compareLanNetworks,
  defaultLanNetwork,
  formatLanNetworkDiagnostics,
  formatLanNetworkLabel,
  formatLanNetworkLine,
  isPreferredLanAddress,
  lanAddressRank,
  lanNetworkEmptyHint,
  listLanNetworks,
  parseLanNetworkResult,
  parseLanNetworkStatus,
  parseLanNetworks,
  readLanNetworks,
  readStoredLanHost,
  resolveLanHost,
  saveStoredLanHost,
  setLanNetworkListerForTests,
  shouldShowLanNetworkDiagnostics,
  sortLanNetworks,
  type LanHostStorage,
  type LanNetwork,
  type LanNetworkStatus,
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
    const failed = await readLanNetworks();
    assert.deepEqual(failed.networks, []);
    assert.equal(failed.status, null);
    assert.equal(failed.error, '枚举失败');
  } finally {
    setLanNetworkListerForTests(null);
  }
  setLanNetworkListerForTests(async () => [WIFI]);
  try {
    const ok = await readLanNetworks();
    assert.equal(ok.error, null);
    assert.equal(ok.status, null);
    assert.equal(ok.networks[0]?.address, '192.168.1.23');
  } finally {
    setLanNetworkListerForTests(null);
  }
});

const WIFI_NO_IPV4: LanNetworkStatus = {
  wifi: true,
  ethernet: false,
  mobile: false,
  vpn: false,
  ipv4Count: 0,
  interfaceSummary: 'wlan0(up,1 个地址); rmnet0(up,2 个地址)',
};

test('原生 status 归一：缺字段按 false/0/空串，非对象按未提供', () => {
  assert.deepEqual(parseLanNetworkStatus(WIFI_NO_IPV4), WIFI_NO_IPV4);
  assert.deepEqual(parseLanNetworkStatus({ wifi: true, ipv4Count: 3 }), {
    wifi: true,
    ethernet: false,
    mobile: false,
    vpn: false,
    ipv4Count: 3,
    interfaceSummary: '',
  });
  // 坏值不放大：负数 / 非数字归 0，字符串只有是字符串才保留
  assert.deepEqual(parseLanNetworkStatus({ wifi: 'yes', ipv4Count: -5, interfaceSummary: 42 }), {
    wifi: false,
    ethernet: false,
    mobile: false,
    vpn: false,
    ipv4Count: 0,
    interfaceSummary: '',
  });
  assert.equal(parseLanNetworkStatus(null), null);
  assert.equal(parseLanNetworkStatus(undefined), null);
  assert.equal(parseLanNetworkStatus('wifi'), null);
  assert.equal(parseLanNetworkStatus([]), null);
});

test('原生结果归一：兼容桌面数组与 Android {networks, status}', () => {
  const android = parseLanNetworkResult({
    networks: [{ name: 'WLAN', address: '192.168.1.23', isLan: true, kind: 'wifi', preferred: 0 }],
    status: WIFI_NO_IPV4,
  });
  assert.equal(android.networks[0]?.address, '192.168.1.23');
  assert.deepEqual(android.status, WIFI_NO_IPV4);
  // 桌面：直接数组，没有 status
  const desktop = parseLanNetworkResult([WIFI]);
  assert.equal(desktop.networks[0]?.address, '192.168.1.23');
  assert.equal(desktop.status, null);
  assert.deepEqual(parseLanNetworkResult(null), { networks: [], status: null });
  assert.deepEqual(parseLanNetworkResult({}), { networks: [], status: null });
});

test('空态文案：按 Wi-Fi / 有线 / 移动数据 / 未知状态分支', () => {
  assert.equal(lanNetworkEmptyHint(WIFI_NO_IPV4), LAN_NETWORK_WIFI_IPV6_HINT);
  assert.match(LAN_NETWORK_WIFI_IPV6_HINT, /已连接 Wi-Fi，但没有拿到 IPv4 地址/);
  assert.equal(
    lanNetworkEmptyHint({ ...WIFI_NO_IPV4, wifi: false, ethernet: true }),
    '已连接有线网络，但没有拿到 IPv4 地址（可能是仅 IPv6 网络），请检查网线或路由器的 DHCP',
  );
  assert.equal(
    lanNetworkEmptyHint({ ...WIFI_NO_IPV4, wifi: false, mobile: true }),
    LAN_NETWORK_MOBILE_HINT,
  );
  assert.match(LAN_NETWORK_MOBILE_HINT, /当前没有 Wi-Fi\/有线连接/);
  // 什么传输都没有 / 未知状态：保留原文案
  assert.equal(
    lanNetworkEmptyHint({ ...WIFI_NO_IPV4, wifi: false, mobile: false }),
    LAN_NETWORK_EMPTY_HINT,
  );
  assert.equal(lanNetworkEmptyHint(null), LAN_NETWORK_EMPTY_HINT);
  // 只有「什么传输都没有」时才展开网卡摘要
  assert.equal(shouldShowLanNetworkDiagnostics(WIFI_NO_IPV4), false);
  assert.equal(shouldShowLanNetworkDiagnostics({ ...WIFI_NO_IPV4, wifi: false, mobile: true }), false);
  assert.equal(shouldShowLanNetworkDiagnostics({ ...WIFI_NO_IPV4, wifi: false }), true);
  assert.equal(
    shouldShowLanNetworkDiagnostics({ ...WIFI_NO_IPV4, wifi: false, interfaceSummary: '  ' }),
    false,
  );
  assert.equal(shouldShowLanNetworkDiagnostics(null), false);
});

test('复制诊断信息：含候选 / 状态 / 网卡摘要 / 读取错误，不含凭据', () => {
  const text = formatLanNetworkDiagnostics({
    networks: [WIFI, TAILSCALE],
    status: WIFI_NO_IPV4,
    error: 'SecurityException: 读取网卡失败',
  });
  assert.match(text, /晓刻局域网诊断/);
  assert.match(text, /候选 IPv4：2 个/);
  assert.match(text, /- 192\.168\.1\.23 \/ WLAN \/ wifi/);
  assert.match(text, /- 192\.168\.9\.9 \/ Tailscale \/ vpn/);
  assert.match(text, /Wi-Fi=是/);
  assert.match(text, /移动数据=否/);
  assert.match(text, /IPv4=0/);
  assert.match(text, /网卡摘要：wlan0\(up,1 个地址\)/);
  assert.match(text, /读取错误：SecurityException: 读取网卡失败/);
  // 没有状态与错误时也给出可读文本，不出现 undefined
  const bare = formatLanNetworkDiagnostics({ networks: [], status: null });
  assert.match(bare, /候选列表：（空）/);
  assert.match(bare, /网络状态：（原生层未返回）/);
  assert.doesNotMatch(bare, /undefined/);
});

test('readLanNetworks：解析 Android 新字段 status，空候选仍保留状态', async () => {
  setLanNetworkListerForTests(async () => ({
    networks: [],
    status: {
      wifi: true,
      ethernet: false,
      mobile: false,
      vpn: false,
      ipv4Count: 0,
      interfaceSummary: 'wlan0(up,1 个地址)',
    },
  }));
  try {
    const result = await readLanNetworks();
    assert.deepEqual(result.networks, []);
    assert.equal(result.error, null);
    assert.equal(result.status?.wifi, true);
    assert.equal(result.status?.ipv4Count, 0);
    assert.equal(result.status?.interfaceSummary, 'wlan0(up,1 个地址)');
  } finally {
    setLanNetworkListerForTests(null);
  }
  // 原生 reject：错误原因透传，status 为 null，界面保留原文案
  setLanNetworkListerForTests(async () => {
    throw new Error('SecurityException: 网卡枚举被 ROM 拦截');
  });
  try {
    const failed = await readLanNetworks();
    assert.deepEqual(failed.networks, []);
    assert.equal(failed.status, null);
    assert.equal(failed.error, 'SecurityException: 网卡枚举被 ROM 拦截');
  } finally {
    setLanNetworkListerForTests(null);
  }
});
