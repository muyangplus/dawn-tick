import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, MemoryStorage, readSettings, writeSettings } from '@dawn-tick/core';
import {
  applyPackage,
  buildPackage,
  davConfigured,
  downloadAndApply,
  maybeAutoSync,
  normalizeDavUrl,
  remoteName,
  remoteStatus,
  testConnection,
  uploadPackage,
  type DavSettings,
} from '../src/webdav.ts';
import { readZipEntries } from '../src/zip-read.ts';
import { setSecretStoreForTests, type SecretStore } from '../src/lib/credentials.ts';

const settings: DavSettings = {
  webdavUrl: 'https://dav.example.com/DawnTick',
  webdavUser: '小明',
  webdavPassword: 'p@ss',
  webdavHistory: false,
};

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

function stubFetch(
  handler: (url: string, init: RequestInit) => Response,
): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : String(input);
    const headers = new Headers(init.headers ?? {});
    calls.push({
      url,
      method: init.method ?? 'GET',
      authorization: headers.get('authorization'),
      body: init.body,
    });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function zipResponse(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes), { status: 200 });
}

test('地址规范化与开关判定', () => {
  assert.equal(normalizeDavUrl('  dav.example.com/dt/  '), 'https://dav.example.com/dt');
  assert.equal(normalizeDavUrl('http://nas.local:5005/dav'), 'http://nas.local:5005/dav');
  assert.equal(normalizeDavUrl('   '), '');
  assert.equal(davConfigured({ webdavUrl: '' }), false);
  assert.equal(davConfigured({ webdavUrl: 'https://a/b' }), true);
});

test('远端文件名按是否保留历史命名', () => {
  const now = new Date(2026, 9, 14, 9, 5, 3).getTime();
  assert.equal(remoteName(now, false), 'DawnTick-backup.zip');
  assert.equal(remoteName(now, true), 'DawnTick-backup-20261014-090503.zip');
});

test('远端探测与鉴权失败提示', async () => {
  const head = stubFetch(
    () =>
      new Response(null, {
        status: 200,
        headers: { 'last-modified': 'Tue, 14 Oct 2026 01:05:03 GMT', 'content-length': '1234' },
      }),
  );
  try {
    const status = await remoteStatus(settings);
    assert.equal(status.ok, true);
    assert.equal(status.exists, true);
    assert.equal(status.size, 1234);
    assert.equal(status.lastModified, Date.parse('Tue, 14 Oct 2026 01:05:03 GMT'));
    assert.equal(head.calls[0]?.method, 'HEAD');
    assert.match(head.calls[0]?.authorization ?? '', /^Basic /);
  } finally {
    head.restore();
  }

  const denied = stubFetch(() => new Response(null, { status: 401 }));
  try {
    const status = await testConnection(settings);
    assert.equal(status.ok, false);
    assert.match(status.error ?? '', /鉴权失败/);
  } finally {
    denied.restore();
  }
});

test('未配置地址时直接拒绝', async () => {
  const empty = { ...settings, webdavUrl: '' };
  const status = await testConnection(empty);
  assert.equal(status.ok, false);
  assert.match(status.error ?? '', /请先填写 WebDAV 地址/);
  const upload = await uploadPackage(new MemoryStorage(), empty);
  assert.equal(upload.ok, false);
});

test('上传会把整包 PUT 到固定名', async () => {
  const storage = new MemoryStorage();
  await writeSettings(storage, { theme: 'dark' });
  const { calls, restore } = stubFetch(() => new Response(null, { status: 201 }));
  try {
    const result = await uploadPackage(storage, settings, 1_793_000_000_000);
    assert.equal(result.ok, true);
    assert.equal(result.name, 'DawnTick-backup.zip');
    assert.ok(result.bytes > 0);
    assert.equal(calls[0]?.method, 'PUT');
    assert.equal(calls[0]?.url, 'https://dav.example.com/DawnTick/DawnTick-backup.zip');
    assert.equal(await storage.readMeta('webdav_last_upload'), '1793000000000');
  } finally {
    restore();
  }
});

test('自动同步：远端更新时提示下载，否则上传', async () => {
  const storage = new MemoryStorage();
  const on = { ...DEFAULT_SETTINGS, webdavUrl: settings.webdavUrl, webdavUser: 'u', webdavPassword: 'p', webdavAuto: true };
  const now = Date.parse('Tue, 14 Oct 2026 02:00:00 GMT');

  // 远端比上次上传新（远端 01:59:30，上次上传 01:59:00）
  await storage.writeMeta('webdav_last_upload', String(now - 60_000));
  const remoteNewer = stubFetch(
    () => new Response(null, { status: 200, headers: { 'last-modified': 'Tue, 14 Oct 2026 01:59:30 GMT' } }),
  );
  try {
    const outcome = await maybeAutoSync(storage, on, { startup: true, now });
    assert.equal(outcome.action, 'remote-newer');
  } finally {
    remoteNewer.restore();
  }

  // 本机上传更新：应上传
  await storage.writeMeta('webdav_last_sync', '');
  await storage.writeMeta('webdav_last_upload', String(now + 60_000));
  const uploads: string[] = [];
  const stale = stubFetch((url, init) => {
    if ((init.method ?? 'GET') === 'PUT') {
      uploads.push(url);
      return new Response(null, { status: 201 });
    }
    return new Response(null, { status: 404 });
  });
  try {
    const outcome = await maybeAutoSync(storage, on, { startup: false, now });
    assert.equal(outcome.action, 'uploaded');
    assert.equal(uploads.length, 1);
  } finally {
    stale.restore();
  }

  // 关掉自动同步后什么都不做
  const off = { ...on, webdavAuto: false };
  const outcome = await maybeAutoSync(storage, off, { startup: true, now });
  assert.equal(outcome.action, 'skipped');
});

test('下载并只应用设置与预设', async () => {
  const source = new MemoryStorage();
  await writeSettings(source, { theme: 'dark', themePreset: 'mono', viewDays: 6 });
  const { bytes } = await buildPackage(source, 1_793_000_000_000);
  const entries = await readZipEntries(bytes);
  assert.ok(entries.has('backup.json'));

  const target = new MemoryStorage();
  await writeSettings(target, { theme: 'light', viewDays: 5 });
  await target.collection('courses').put({
    id: 'c-local',
    semester_id: 's-1',
    name: '本机课程',
    color: '#4F8DFD',
    created_at: 1,
    updated_at: 1,
  });

  const { restore } = stubFetch(() => zipResponse(bytes));
  try {
    const result = await downloadAndApply(target, settings, 'settings');
    assert.equal(result.ok, true);
    assert.equal(result.outcome?.full, null);
    assert.ok((result.outcome?.settings?.imported ?? 0) > 0);
  } finally {
    restore();
  }
  assert.equal((await readSettings(target)).themePreset, 'mono');
  assert.equal((await readSettings(target)).viewDays, 6);
  assert.ok(
    (await target.collection('courses').get('c-local')) !== undefined,
    '只应用设置时不动业务数据',
  );
});

test('下载整库会清掉快照之后的数据', async () => {
  const source = new MemoryStorage();
  await writeSettings(source, { theme: 'dark' });
  const { bytes } = await buildPackage(source, 1_793_000_000_000);

  const target = new MemoryStorage();
  await target.collection('courses').put({
    id: 'c-only-local',
    semester_id: 's-1',
    name: '只在本机',
    color: '#4F8DFD',
    created_at: 1,
    updated_at: 1,
  });
  const outcome = await applyPackage(target, bytes, 'all');
  assert.equal(outcome.ok, true);
  assert.equal((await target.collection('courses').getAll()).length, 0, '整库恢复清掉本机多出来的行');
  assert.equal((await readSettings(target)).theme, 'dark');
});

test('坏包给出可读错误且不改数据', async () => {
  const target = new MemoryStorage();
  await writeSettings(target, { theme: 'light' });
  const outcome = await applyPackage(target, new TextEncoder().encode('不是 zip'), 'all');
  assert.equal(outcome.ok, false);
  assert.ok((outcome.error ?? '').length > 0);
  assert.equal((await readSettings(target)).theme, 'light');
});

test('整包带上预设并在应用时恢复', async () => {
  const source = new MemoryStorage();
  await writeSettings(source, { theme: 'dark' });
  await source.writeMeta('presets_snapshot_v1', '{"version":"1"}');
  await source.writeMeta('presets_content_v1', '{"schools":[]}');
  const { bytes } = await buildPackage(source, 1_793_000_000_000);
  const entries = await readZipEntries(bytes);
  assert.ok(entries.has('presets/snapshot.json'));
  assert.ok(entries.has('presets/content.json'));

  const target = new MemoryStorage();
  const outcome = await applyPackage(target, bytes, 'all');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.presets, true);
  assert.equal(await target.readMeta('presets_snapshot_v1'), '{"version":"1"}');
  assert.equal(await target.readMeta('presets_content_v1'), '{"schools":[]}');
});

/** 统一假密钥库：密文是 `cipher(明文)`，只用于验证请求前的透明解密。 */
function fakeSecretStore(): SecretStore {
  return {
    encrypt: async (value: string) => `cipher(${value})`,
    decrypt: async (ciphertext: string) => {
      const matched = /^cipher\((.*)\)$/s.exec(ciphertext);
      if (matched === null) throw new Error('密文损坏');
      return matched[1] as string;
    },
    isAvailable: async () => true,
  };
}

test('密码是 enc:v1 信封时先解密再用于鉴权', async () => {
  setSecretStoreForTests(fakeSecretStore());
  const { calls, restore } = stubFetch(() => new Response(null, { status: 200 }));
  try {
    await remoteStatus({ ...settings, webdavPassword: 'enc:v1:cipher(p@ss)' });
    const expected = Buffer.from('小明:p@ss', 'utf8').toString('base64');
    assert.equal(calls[0]?.authorization, `Basic ${expected}`, '发出的应是解密后的密码');
  } finally {
    restore();
    setSecretStoreForTests(undefined);
  }
});

test('密码解不开时不发请求并给出可读错误', async () => {
  setSecretStoreForTests({
    encrypt: async () => 'cipher(x)',
    decrypt: async () => {
      throw new Error('key lost');
    },
    isAvailable: async () => true,
  });
  const { calls, restore } = stubFetch(() => new Response(null, { status: 200 }));
  try {
    const status = await remoteStatus({ ...settings, webdavPassword: 'enc:v1:broken' });
    assert.equal(status.ok, false);
    assert.match(status.error ?? '', /无法解密/);
    assert.equal(calls.length, 0, '解不开的密码不能当 Basic 凭据发出去');
  } finally {
    restore();
    setSecretStoreForTests(undefined);
  }
});

test('自动同步用存储里的当前密码，而不是内存中的旧信封', async () => {
  const storage = new MemoryStorage();
  await storage.writeMeta('webdav_password', 'stored-secret');
  const on = {
    ...DEFAULT_SETTINGS,
    webdavUrl: settings.webdavUrl,
    webdavUser: 'u',
    webdavPassword: 'enc:v1:cipher(stale)',
    webdavAuto: true,
  };
  const { calls, restore } = stubFetch(() => new Response(null, { status: 201 }));
  try {
    const outcome = await maybeAutoSync(storage, on, {
      startup: true,
      now: Date.parse('Tue, 14 Oct 2026 02:00:00 GMT'),
    });
    assert.equal(outcome.action, 'uploaded');
    const expected = Buffer.from('u:stored-secret', 'utf8').toString('base64');
    assert.ok(
      calls.some((call) => call.authorization === `Basic ${expected}`),
      '请求头应使用存储里的密码',
    );
  } finally {
    restore();
  }
});

test('自动同步遇到解不开的密码直接报错', async () => {
  setSecretStoreForTests({
    encrypt: async () => 'cipher(x)',
    decrypt: async () => {
      throw new Error('key lost');
    },
    isAvailable: async () => true,
  });
  const storage = new MemoryStorage();
  await storage.writeMeta('webdav_password', 'enc:v1:broken');
  const on = { ...DEFAULT_SETTINGS, webdavUrl: settings.webdavUrl, webdavUser: 'u', webdavAuto: true };
  const { calls, restore } = stubFetch(() => new Response(null, { status: 201 }));
  try {
    const outcome = await maybeAutoSync(storage, on, { startup: true, now: Date.now() });
    assert.equal(outcome.action, 'error');
    assert.match(outcome.detail ?? '', /无法解密/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
    setSecretStoreForTests(undefined);
  }
});
