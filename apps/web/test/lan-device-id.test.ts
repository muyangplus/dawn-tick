import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAN_DEVICE_ID_STORAGE_KEY,
  getOrCreateLanDeviceId,
  normalizeLanDeviceId,
  setLanDeviceIdForTests,
} from '../src/lib/lan-device-id.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function installStorage(storage: Storage | undefined): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      if (storage === undefined) throw new Error('localStorage 不可用');
      return storage;
    },
  });
  return () => {
    if (descriptor === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else Object.defineProperty(globalThis, 'localStorage', descriptor);
    setLanDeviceIdForTests(null);
  };
}

function memoryStorage(): { storage: Storage; values: Map<string, string> } {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return { storage, values };
}

test('首次生成 UUID 并写入 localStorage，之后读到同一个 id', () => {
  const { storage, values } = memoryStorage();
  const restore = installStorage(storage);
  try {
    setLanDeviceIdForTests(null);
    const first = getOrCreateLanDeviceId();
    assert.match(first, UUID_V4, '应为标准 UUID v4');
    assert.equal(values.get(LAN_DEVICE_ID_STORAGE_KEY), first, '生成后立即持久化');
    assert.equal(getOrCreateLanDeviceId(), first, '本会话内稳定');

    // 模拟重启应用：忘记内存缓存，从 localStorage 读回同一个 id
    setLanDeviceIdForTests(null);
    assert.equal(getOrCreateLanDeviceId(), first, '重启后仍认同一台设备');
    assert.equal(values.size, 1, '不会重复写多条');
  } finally {
    restore();
  }
});

test('localStorage 已有合法 id 时直接复用，不重新生成', () => {
  const { storage } = memoryStorage();
  storage.setItem(LAN_DEVICE_ID_STORAGE_KEY, 'existing-device-0001');
  const restore = installStorage(storage);
  try {
    setLanDeviceIdForTests(null);
    assert.equal(getOrCreateLanDeviceId(), 'existing-device-0001');
  } finally {
    restore();
  }
});

test('localStorage 不可用：回退内存，本次会话内稳定且不抛错', () => {
  const restore = installStorage(undefined);
  try {
    setLanDeviceIdForTests(null);
    const first = getOrCreateLanDeviceId();
    assert.match(first, UUID_V4);
    assert.equal(getOrCreateLanDeviceId(), first, '同一会话内复用内存值');
  } finally {
    restore();
  }
});

test('测试注入与归一：非法值不会成为设备 id', () => {
  const { storage } = memoryStorage();
  const restore = installStorage(storage);
  try {
    setLanDeviceIdForTests('test-device-1234');
    assert.equal(getOrCreateLanDeviceId(), 'test-device-1234');

    setLanDeviceIdForTests('非法 id 😀');
    assert.match(getOrCreateLanDeviceId(), UUID_V4, '非法注入按清除处理');

    assert.equal(normalizeLanDeviceId('  abc-123_45.6:78  '), 'abc-123_45.6:78');
    assert.equal(normalizeLanDeviceId('abc'), 'abc', '1 位安全字符也合法');
    assert.equal(normalizeLanDeviceId(''), null, '空串不合法');
    assert.equal(normalizeLanDeviceId('   '), null, '全空白不合法');
    assert.equal(normalizeLanDeviceId('a'.repeat(65)), null, '超过 64 位不合法');
    assert.equal(normalizeLanDeviceId('bad id'), null);
    assert.equal(normalizeLanDeviceId(123), null);
  } finally {
    restore();
  }
});
