import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, type Storage } from '@dawn-tick/core';
import {
  BUILTIN_PRESET_VERSION,
  PRESET_SCHEMA_VERSION,
  PRESET_SNAPSHOT_META_KEY,
  PRESET_SNAPSHOT_URL,
  PRESET_VERSION_URL,
  canonicalPresetJson,
  checkPresetUpdate,
  comparePresetVersions,
  fetchSnapshot,
  readCachedSnapshot,
  resolvePresetSource,
  sha256Hex,
  sha256HexSync,
  verifySnapshot,
  writeCachedSnapshot,
  type PresetSnapshot,
} from '../src/preset-update.ts';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** 用同一套规范化口径给快照签名，用于构造「结构合法」的测试数据。 */
function signed(snapshot: Omit<PresetSnapshot, 'hash'>): PresetSnapshot {
  return { ...snapshot, hash: `sha256:${sha256HexSync(canonicalPresetJson(snapshot))}` };
}

/**
 * 预设仓库 `dawn-tick-presets` 在 1.0.0 真实产出的快照（内容与 hash 都是生成器写的）。
 * 它是本模块哈希口径的**外部基准**：用自己的实现去签自己的数据是循环论证，
 * 只有这份「别人算出来的 hash」能证明规范化序列化与 sha256 都对齐了生成器。
 */
const REAL_1_0_0: PresetSnapshot = {
  version: '1.0.0',
  schemaVersion: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  sources: {
    timetables: [
      {
        id: 'default',
        path: 'presets/timetables/default.json',
        sha256: 'sha256:1dea538e8d0113060d63dee0c2ebd4068e515b7d77dce6e9446200343f3564b3',
      },
      {
        id: 'usts',
        path: 'presets/timetables/usts.json',
        sha256: 'sha256:7f60536005ef6bce600b4beff8bed52fe32f223f72cb8eb2ba3b1d90a80c58b0',
      },
    ],
    systems: [
      {
        id: 'jwglxt',
        path: 'presets/systems/jwglxt.json',
        sha256: 'sha256:1941bb2ba38310ddd806761b73bb8b6b8dbb88873588fdfa91459214d4b302f6',
      },
      {
        id: 'other',
        path: 'presets/systems/other.json',
        sha256: 'sha256:5267d69d0c21271af940fb68d84b011a0808154294fae2b9e92a3efe065e8669',
      },
      {
        id: 'qzdatasource',
        path: 'presets/systems/qzdatasource.json',
        sha256: 'sha256:4bcd4571220c4be38f4ae319b4eae3d641d1ea1bf655a82d8d65814d330b23e1',
      },
      {
        id: 'urp',
        path: 'presets/systems/urp.json',
        sha256: 'sha256:9e7c5f59be36d1bbf6909e8f27cd881c4beff0662732e2fd6881b8c2190cb961',
      },
    ],
    adapters: {
      'jwglxt.js': 'sha256:d408705908db8419c38a19299a7a491a0bb66387f7c70639a90c5f32cb70e1c6',
    },
  },
  hash: 'sha256:9b144c0ceaf56e50c0e3bfe2e8baf114ff4606288952f36e6078da643d931edf',
};

const DEMO_SNAPSHOT: PresetSnapshot = signed({
  version: '1.1.0',
  schemaVersion: 1,
  generatedAt: '2026-02-01T00:00:00.000Z',
  sources: { timetables: [{ id: 'default', path: 'presets/timetables/default.json' }], systems: [] },
});

async function storageWithMeta(): Promise<Storage> {
  return new MemoryStorage();
}

test('预设源地址与内置版本号是常量，且与预设仓库 1.0.0 对齐', () => {
  assert.match(PRESET_VERSION_URL, /^https:\/\/raw\.githubusercontent\.com\/muyangplus\/dawn-tick-presets\/main\/version\.json$/);
  assert.equal(
    PRESET_SNAPSHOT_URL('1.0.0'),
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-presets/main/snapshot/presets-1.0.0.json',
  );
  assert.equal(PRESET_SNAPSHOT_META_KEY, 'presets_snapshot_v1');
  assert.equal(PRESET_SCHEMA_VERSION, 1);
  assert.equal(BUILTIN_PRESET_VERSION, '1.0.0', '内置预设版本应等于预设仓库当前版本');
});

test('语义化版本比较：主次修订与预发布', () => {
  assert.ok(comparePresetVersions('1.1.0', '1.0.0') > 0);
  assert.ok(comparePresetVersions('1.0.1', '1.0.0') > 0);
  assert.equal(comparePresetVersions('1.0.0', '1.0.0'), 0);
  assert.ok(comparePresetVersions('1.0.0', '1.1.0') < 0);
  assert.ok(comparePresetVersions('1.0.0', '1.0.0-beta.1') > 0, '正式版高于同号预发布版');
  assert.ok(comparePresetVersions('1.0.0-beta.10', '1.0.0-beta.9') > 0, '预发布序号按数值比较');
});

test('sha256：纯 TS 实现与 WebCrypto 结果一致，且等于已知向量', async () => {
  const known = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(sha256HexSync('abc'), known, '同步实现必须等于 sha256("abc") 的标准向量');
  assert.equal(await sha256Hex('abc'), known, '异步实现（WebCrypto）必须给出同一结果');
  const long = '晓刻 DawnTick 预设快照 · '.repeat(200);
  assert.equal(await sha256Hex(long), sha256HexSync(long), '长文本（多分块）两端也必须一致');
});

test('规范化 JSON：键序稳定，与生成器同口径', () => {
  assert.equal(canonicalPresetJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  assert.equal(canonicalPresetJson('中文'), '"中文"');
  assert.equal(canonicalPresetJson([1, null, true]), '[1,null,true]');
});

test('verifySnapshot：真实生成器产出的 1.0.0 快照通过，内容被篡改则失败', () => {
  assert.equal(verifySnapshot(REAL_1_0_0), true, '预设仓库 1.0.0 的真实快照应通过校验');
  assert.equal(verifySnapshot({ ...REAL_1_0_0, version: '9.9.9' }), false, '改 version 必须被发现');
  assert.equal(
    verifySnapshot({ ...REAL_1_0_0, sources: { ...REAL_1_0_0.sources, systems: [] } }),
    false,
    '删掉一个系统清单一节必须被发现',
  );
  assert.equal(
    verifySnapshot({ ...REAL_1_0_0, generatedAt: '2030-01-01T00:00:00.000Z' }),
    false,
    '改生成时间必须被发现',
  );
  assert.equal(verifySnapshot({ ...REAL_1_0_0, hash: 'sha256:0000' }), false, 'hash 格式非法视为不通过');
  assert.equal(verifySnapshot({ ...REAL_1_0_0, hash: '' }), false);
  // 键序不同不应影响结果：规范化会排序
  const shuffled = {
    hash: REAL_1_0_0.hash,
    sources: REAL_1_0_0.sources,
    generatedAt: REAL_1_0_0.generatedAt,
    schemaVersion: REAL_1_0_0.schemaVersion,
    version: REAL_1_0_0.version,
  };
  assert.equal(verifySnapshot(shuffled), true, '键序不影响哈希');
});

test('checkPresetUpdate：远端更高版本算有更新', async () => {
  const status = await checkPresetUpdate({
    cachedVersion: '1.0.0',
    fetchImpl: async () => jsonResponse({ version: '1.1.0', schemaVersion: 1 }),
  });
  assert.equal(status.available, true);
  assert.equal(status.version, '1.1.0');
  assert.equal(status.error, null);
});

test('checkPresetUpdate：同版本或更旧版本不算更新', async () => {
  const same = await checkPresetUpdate({
    cachedVersion: '1.0.0',
    fetchImpl: async () => jsonResponse({ version: '1.0.0' }),
  });
  assert.equal(same.available, false);
  assert.equal(same.version, '1.0.0', '成功时仍给出远端最新版本，方便界面显示「已是最新」');
  assert.equal(same.error, null);

  const older = await checkPresetUpdate({
    cachedVersion: '1.2.0',
    fetchImpl: async () => jsonResponse({ version: '1.0.0' }),
  });
  assert.equal(older.available, false, '不允许降级');
});

test('checkPresetUpdate：离线、404、JSON 非法都收敛成可读错误', async () => {
  const offline = await checkPresetUpdate({
    cachedVersion: '1.0.0',
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(offline.available, false);
  assert.equal(offline.version, null);
  assert.match(String(offline.error), /无法连接预设源/);

  const notFound = await checkPresetUpdate({
    cachedVersion: '1.0.0',
    fetchImpl: async () => jsonResponse({}, false, 404),
  });
  assert.match(String(notFound.error), /404/);

  const badShape = await checkPresetUpdate({
    cachedVersion: '1.0.0',
    fetchImpl: async () => jsonResponse({ version: 123 }),
  });
  assert.match(String(badShape.error), /格式/);

  const brokenJson = await checkPresetUpdate({
    cachedVersion: '1.0.0',
    fetchImpl: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token <');
        },
      }) as unknown as Response,
  });
  assert.match(String(brokenJson.error), /Unexpected token/);
});

test('checkPresetUpdate：远端格式比本版新时提示升级而不是当成可用更新', async () => {
  const status = await checkPresetUpdate({
    cachedVersion: '1.0.0',
    fetchImpl: async () => jsonResponse({ version: '2.0.0', schemaVersion: 99 }),
  });
  assert.equal(status.available, false);
  assert.match(String(status.error), /schemaVersion 99/);
});

test('fetchSnapshot：正常下载并通过哈希校验', async () => {
  const seen: string[] = [];
  const snapshot = await fetchSnapshot('1.1.0', async (input) => {
    seen.push(String(input));
    return jsonResponse(DEMO_SNAPSHOT);
  });
  assert.deepEqual(seen, [PRESET_SNAPSHOT_URL('1.1.0')]);
  assert.equal(snapshot.version, '1.1.0');
  assert.equal(snapshot.hash, DEMO_SNAPSHOT.hash);
});

test('fetchSnapshot：哈希不符、结构不对、HTTP 失败、版本号非法都抛可读错误', async () => {
  await assert.rejects(
    () => fetchSnapshot('1.1.0', async () => jsonResponse({ ...DEMO_SNAPSHOT, version: '9.9.9' })),
    /哈希校验未通过/,
  );
  await assert.rejects(
    () => fetchSnapshot('1.1.0', async () => jsonResponse({ version: '1.1.0' })),
    /预设快照不可用/,
  );
  await assert.rejects(
    () => fetchSnapshot('1.1.0', async () => jsonResponse({}, false, 500)),
    /预设快照下载失败：预设源返回 500/,
  );
  await assert.rejects(
    () =>
      fetchSnapshot('1.1.0', async () => {
        throw new Error('fetch failed');
      }),
    /无法连接预设源/,
  );
  await assert.rejects(() => fetchSnapshot('../evil', async () => jsonResponse(DEMO_SNAPSHOT)), /版本号不合法/);
});

test('缓存：写回后能读回，缺失时返回 null', async () => {
  const storage = await storageWithMeta();
  assert.equal(await readCachedSnapshot(storage), null, '未缓存时返回 null（回退内置）');

  await writeCachedSnapshot(storage, DEMO_SNAPSHOT);
  const cached = await readCachedSnapshot(storage);
  assert.equal(cached?.version, '1.1.0');
  assert.equal(cached?.hash, DEMO_SNAPSHOT.hash);
  assert.equal(
    await storage.readMeta(PRESET_SNAPSHOT_META_KEY),
    JSON.stringify(DEMO_SNAPSHOT),
    '缓存键与内容口径',
  );
});

test('缓存损坏（JSON 非法 / 结构不对 / 哈希不符）一律忽略并回退内置', async () => {
  const broken = await storageWithMeta();
  await broken.writeMeta(PRESET_SNAPSHOT_META_KEY, '{ 不是 JSON');
  assert.equal(await readCachedSnapshot(broken), null);

  const wrongShape = await storageWithMeta();
  await wrongShape.writeMeta(PRESET_SNAPSHOT_META_KEY, JSON.stringify({ version: '1.1.0' }));
  assert.equal(await readCachedSnapshot(wrongShape), null);

  const tampered = await storageWithMeta();
  await tampered.writeMeta(
    PRESET_SNAPSHOT_META_KEY,
    JSON.stringify({ ...DEMO_SNAPSHOT, sources: { timetables: [], systems: [] } }),
  );
  assert.equal(await readCachedSnapshot(tampered), null, '内容与 hash 不符的缓存必须被忽略');

  const fallback = await resolvePresetSource(tampered);
  assert.equal(fallback.kind, 'builtin', '缓存不可用时必须回退内置预设');
  assert.equal(fallback.version, BUILTIN_PRESET_VERSION);
});

test('resolvePresetSource：缓存更新且可信时用缓存，否则回退内置', async () => {
  const empty = await storageWithMeta();
  const builtin = await resolvePresetSource(empty);
  assert.equal(builtin.kind, 'builtin');
  assert.equal(builtin.version, BUILTIN_PRESET_VERSION);
  assert.equal(builtin.snapshot, null);

  const updated = await storageWithMeta();
  await writeCachedSnapshot(updated, DEMO_SNAPSHOT);
  const cached = await resolvePresetSource(updated);
  assert.equal(cached.kind, 'cached');
  assert.equal(cached.version, '1.1.0');
  assert.equal(cached.snapshot?.hash, DEMO_SNAPSHOT.hash);

  // 缓存不比内置新（例如装回旧包后残留的缓存）→ 仍然用内置
  const staleStorage = await storageWithMeta();
  const stale = signed({
    version: '0.9.0',
    schemaVersion: 1,
    sources: { timetables: [], systems: [] },
  });
  await writeCachedSnapshot(staleStorage, stale);
  const resolvedStale = await resolvePresetSource(staleStorage);
  assert.equal(resolvedStale.kind, 'builtin');
  assert.equal(resolvedStale.version, BUILTIN_PRESET_VERSION);
});
