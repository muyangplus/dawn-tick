import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryStorage, type Storage } from '@dawn-tick/core';
import {
  BUILTIN_PRESET_VERSION,
  PRESET_INDEX_URL,
  PRESET_SCHEMA_VERSION,
  PRESET_SNAPSHOT_META_KEY,
  PRESET_SNAPSHOT_URL,
  PRESET_VERSION_URL,
  canonicalPresetJson,
  checkPresetUpdate,
  comparePresetVersions,
  describePresetIndexProblem,
  fetchPresetIndex,
  fetchSnapshot,
  parsePresetIndex,
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
 * 预设仓库 `dawn-tick-presets` 在 0.1.0（结构重构后）真实产出的快照，内容与 hash 都是生成器写的
 * （可从 `<预设仓库>/snapshot/presets-0.1.0.json` 逐字核对）。
 * 它是本模块哈希口径的**外部基准**：用自己的实现去签自己的数据是循环论证，
 * 只有这份「别人算出来的 hash」能证明规范化序列化与 sha256 都对齐了生成器。
 *
 * 注意 `path` 的语义：作息表是**真实文件路径**，教务系统是**符号路径**
 * （`presets/systems/<id>/system.json` 在新结构下并不存在，它代表编译产物）。
 */
const REAL_PRESET_SNAPSHOT_0_1_0: PresetSnapshot = {
  version: '0.1.0',
  schemaVersion: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  sources: {
    timetables: [
      {
        id: 'default',
        path: 'presets/schools/_default/timetable.json',
        sha256: 'sha256:1dea538e8d0113060d63dee0c2ebd4068e515b7d77dce6e9446200343f3564b3',
      },
      {
        id: 'usts',
        path: 'presets/schools/usts/timetable.json',
        sha256: 'sha256:7f60536005ef6bce600b4beff8bed52fe32f223f72cb8eb2ba3b1d90a80c58b0',
      },
    ],
    systems: [
      {
        id: 'jwglxt',
        path: 'presets/systems/jwglxt/system.json',
        sha256: 'sha256:1941bb2ba38310ddd806761b73bb8b6b8dbb88873588fdfa91459214d4b302f6',
      },
      {
        id: 'other',
        path: 'presets/systems/other/system.json',
        sha256: 'sha256:5267d69d0c21271af940fb68d84b011a0808154294fae2b9e92a3efe065e8669',
      },
      {
        id: 'qzdatasource',
        path: 'presets/systems/qzdatasource/system.json',
        sha256: 'sha256:4bcd4571220c4be38f4ae319b4eae3d641d1ea1bf655a82d8d65814d330b23e1',
      },
      {
        id: 'urp',
        path: 'presets/systems/urp/system.json',
        sha256: 'sha256:9e7c5f59be36d1bbf6909e8f27cd881c4beff0662732e2fd6881b8c2190cb961',
      },
    ],
    adapters: {
      'jwglxt.js': 'sha256:070522737bf3d60b4f2fff8dd246c2664acef7ce9189e862a8934c40068fa4b0',
    },
  },
  hash: 'sha256:9e561d57adbfef0d4fe74a71f8958207e10d0ea0ff399e2011c033472d39fb63',
};

const DEMO_SNAPSHOT: PresetSnapshot = signed({
  version: '1.1.0',
  schemaVersion: 1,
  generatedAt: '2026-02-01T00:00:00.000Z',
  sources: {
    timetables: [{ id: 'default', path: 'presets/schools/_default/timetable.json' }],
    systems: [],
  },
});

async function storageWithMeta(): Promise<Storage> {
  return new MemoryStorage();
}

test('预设源地址与内置版本号是常量，且与预设仓库 0.1.0 对齐', () => {
  assert.match(PRESET_VERSION_URL, /^https:\/\/raw\.githubusercontent\.com\/muyangplus\/dawn-tick-presets\/main\/version\.json$/);
  assert.equal(
    PRESET_SNAPSHOT_URL('0.1.0'),
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-presets/main/snapshot/presets-0.1.0.json',
  );
  assert.equal(
    PRESET_INDEX_URL,
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-presets/main/presets/index.json',
  );
  assert.equal(PRESET_SNAPSHOT_META_KEY, 'presets_snapshot_v1');
  assert.equal(PRESET_SCHEMA_VERSION, 1);
  assert.equal(BUILTIN_PRESET_VERSION, '0.1.0', '内置预设版本应等于预设仓库当前版本');
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

test('verifySnapshot：真实生成器产出的 0.1.0 快照通过，内容被篡改则失败', () => {
  assert.equal(verifySnapshot(REAL_PRESET_SNAPSHOT_0_1_0), true, '预设仓库 0.1.0 的真实快照应通过校验');
  assert.equal(verifySnapshot({ ...REAL_PRESET_SNAPSHOT_0_1_0, version: '9.9.9' }), false, '改 version 必须被发现');
  assert.equal(
    verifySnapshot({ ...REAL_PRESET_SNAPSHOT_0_1_0, sources: { ...REAL_PRESET_SNAPSHOT_0_1_0.sources, systems: [] } }),
    false,
    '删掉一个系统清单一节必须被发现',
  );
  assert.equal(
    verifySnapshot({ ...REAL_PRESET_SNAPSHOT_0_1_0, generatedAt: '2030-01-01T00:00:00.000Z' }),
    false,
    '改生成时间必须被发现',
  );
  assert.equal(verifySnapshot({ ...REAL_PRESET_SNAPSHOT_0_1_0, hash: 'sha256:0000' }), false, 'hash 格式非法视为不通过');
  assert.equal(verifySnapshot({ ...REAL_PRESET_SNAPSHOT_0_1_0, hash: '' }), false);
  // 键序不同不应影响结果：规范化会排序
  const shuffled = {
    hash: REAL_PRESET_SNAPSHOT_0_1_0.hash,
    sources: REAL_PRESET_SNAPSHOT_0_1_0.sources,
    generatedAt: REAL_PRESET_SNAPSHOT_0_1_0.generatedAt,
    schemaVersion: REAL_PRESET_SNAPSHOT_0_1_0.schemaVersion,
    version: REAL_PRESET_SNAPSHOT_0_1_0.version,
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

  // 缓存不比内置新（例如装回旧包后残留的缓存）→ 仍然用内置。
  // 内置现在是 0.1.0，所以「更旧」要取 0.x 里比它小的版本。
  const staleStorage = await storageWithMeta();
  const stale = signed({
    version: '0.0.9',
    schemaVersion: 1,
    sources: { timetables: [], systems: [] },
  });
  await writeCachedSnapshot(staleStorage, stale);
  const resolvedStale = await resolvePresetSource(staleStorage);
  assert.equal(resolvedStale.kind, 'builtin');
  assert.equal(resolvedStale.version, BUILTIN_PRESET_VERSION);
});

// —— presets/index.json：只读接入（解析 + 校验），本步不做 UI ——

/** 只读参考：预设仓库（与 core 的快照测试同一套约定，可用环境变量覆盖）。 */
const PRESETS_DIR = process.env['DAWN_TICK_PRESETS_DIR'] ?? 'E:/work/dsh/dawn-tick-presets';

/**
 * 预设仓库 0.1.0 真实产出的 `presets/index.json`（可从 `<预设仓库>/presets/index.json` 逐字核对）。
 * 这里照**线上原文**的形状手抄，包含本模块暂时不消费的 `region` / `aliases` / `metaPath` 等字段，
 * 这样「多出来的字段不该被拒」这条也一并覆盖。
 */
const REAL_PRESET_INDEX: Record<string, unknown> = {
  _generated: true,
  version: '0.1.0',
  schemaVersion: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  schools: [
    {
      id: 'default',
      name: '通用作息',
      type: 'generic',
      system: null,
      aliases: ['默认作息'],
      generic: true,
      default: true,
      configPath: null,
      timetablePath: 'presets/schools/_default/timetable.json',
    },
    {
      id: 'usts',
      name: '苏州科技大学',
      region: '江苏',
      type: 'university',
      system: 'jwglxt',
      aliases: ['苏州科技大学', '苏科大', 'USTS'],
      generic: false,
      default: false,
      configPath: 'presets/schools/usts/config.json',
      timetablePath: 'presets/schools/usts/timetable.json',
    },
  ],
  systems: [
    {
      id: 'jwglxt',
      name: '正方教务',
      version: '1.0.0',
      aliases: ['jwglxt', '正方教务'],
      hasParser: true,
      parserPath: 'presets/systems/jwglxt/parse.js',
      metaPath: 'presets/systems/jwglxt/meta.json',
      loginPath: 'presets/systems/jwglxt/login.json',
      detect: {
        markers: ['jwglxt', 'xskb_list', 'timetable_con', 'kbgrid_table'],
        timetableTableIds: ['kbtable'],
        timetableTableClasses: ['kb', 'timetable', 'schedule', 'skb'],
        gridCellIdPatterns: ['\\d{1,2}[-_]\\d{1,2}'],
      },
      entryPath: '/jwglxt/xtgl/login_slogin.html',
      hint: '个人课表查询在「信息查询 → 学生课表查询」',
    },
    {
      id: 'other',
      name: '其他教务',
      version: '1.0.0',
      aliases: ['other', '其他教务'],
      hasParser: false,
      metaPath: 'presets/systems/other/meta.json',
      loginPath: 'presets/systems/other/login.json',
      detect: {
        markers: [],
        timetableTableIds: [],
        timetableTableClasses: [],
        gridCellIdPatterns: [],
      },
      entryPath: '/',
      hint: '自行登录后打开课表页',
    },
    {
      id: 'qzdatasource',
      name: '强智教务',
      version: '1.0.0',
      aliases: ['qzdatasource', '强智教务'],
      hasParser: false,
      metaPath: 'presets/systems/qzdatasource/meta.json',
      loginPath: 'presets/systems/qzdatasource/login.json',
      detect: {
        markers: ['qzdatasource', '强智', 'qzjw'],
        timetableTableIds: [],
        timetableTableClasses: [],
        gridCellIdPatterns: [],
      },
      entryPath: '/jsxsd/',
      hint: '课表在「培养管理 → 我的课表」',
    },
    {
      id: 'urp',
      name: 'URP 教务',
      version: '1.0.0',
      aliases: ['urp', 'URP 教务'],
      hasParser: false,
      metaPath: 'presets/systems/urp/meta.json',
      loginPath: 'presets/systems/urp/login.json',
      detect: {
        markers: ['urp', '教学信息服务平台', 'jwgl\\.urp'],
        timetableTableIds: [],
        timetableTableClasses: [],
        gridCellIdPatterns: [],
      },
      entryPath: '/',
      hint: '综合教务系统，课表在「课表查询」',
    },
  ],
};

/** 索引的可变形态（用例里会删/改字段）。 */
type MutableIndex = Record<string, unknown> & {
  schools: Array<Record<string, unknown>>;
  systems: Array<Record<string, unknown>>;
};

/** 深拷贝一份索引：用例之间互不污染。 */
function cloneIndex(): MutableIndex {
  return JSON.parse(JSON.stringify(REAL_PRESET_INDEX)) as MutableIndex;
}

test('index.json：真实生成物通过校验，学校与系统字段逐个可用', () => {
  assert.equal(describePresetIndexProblem(REAL_PRESET_INDEX), null, '真实索引应通过校验');

  const index = parsePresetIndex(REAL_PRESET_INDEX);
  assert.equal(index._generated, true);
  assert.equal(index.version, '0.1.0');
  assert.equal(index.schemaVersion, 1);

  assert.deepEqual(
    index.schools.map((school) => school.id),
    ['default', 'usts'],
  );
  const generic = index.schools[0];
  assert.equal(generic?.name, '通用作息');
  assert.equal(generic?.system, null, '通用作息不绑定教务系统');
  assert.equal(generic?.configPath, null, '通用作息没有 config.json');
  assert.equal(generic?.timetablePath, 'presets/schools/_default/timetable.json', '校目录名可以与作息 id 不同');
  const usts = index.schools[1];
  assert.equal(usts?.system, 'jwglxt');
  assert.equal(usts?.timetablePath, 'presets/schools/usts/timetable.json');
  assert.equal(usts?.configPath, 'presets/schools/usts/config.json');

  assert.deepEqual(
    index.systems.map((system) => system.id),
    ['jwglxt', 'other', 'qzdatasource', 'urp'],
  );
  const jwglxt = index.systems[0];
  assert.equal(jwglxt?.entryPath, '/jwglxt/xtgl/login_slogin.html');
  assert.ok((jwglxt?.detect.markers.length ?? 0) > 0, '正方教务应有页面标记');
  assert.ok((jwglxt?.hint.length ?? 0) > 0, '系统应带一句入口提示');
  assert.deepEqual(index.systems[1]?.detect.markers, [], '空标记是合法值，不是缺字段');
});

test('index.json：预设仓库只读参考在场时，外部基准与真实文件逐字段一致', (t) => {
  const indexPath = join(PRESETS_DIR, 'presets', 'index.json');
  if (!existsSync(indexPath)) {
    t.skip(`预设仓库不在 ${PRESETS_DIR}，跳过真实索引比对`);
    return;
  }
  const fromRepo = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(fromRepo, REAL_PRESET_INDEX, '外部基准应与预设仓库当前的 presets/index.json 逐字段一致');
  assert.deepEqual(parsePresetIndex(fromRepo), REAL_PRESET_INDEX);
});

test('index.json：_generated 缺失或不为 true 一律拒绝', () => {
  const missing = cloneIndex();
  delete missing['_generated'];
  assert.match(String(describePresetIndexProblem(missing)), /_generated/);
  assert.throws(() => parsePresetIndex(missing), /预设索引不可用/);

  for (const value of [false, 'true', 1, null]) {
    const broken = cloneIndex();
    broken['_generated'] = value;
    assert.match(
      String(describePresetIndexProblem(broken)),
      /_generated/,
      `_generated = ${JSON.stringify(value)} 应被拒绝`,
    );
  }
});

test('index.json：学校条目缺任一必填字段都拒绝', () => {
  for (const key of ['id', 'name', 'system', 'timetablePath', 'configPath']) {
    const index = cloneIndex();
    const school = index.schools[1];
    assert.ok(school !== undefined);
    delete school[key];

    const problem = describePresetIndexProblem(index);
    assert.ok(problem !== null, `学校缺 ${key} 应被拒绝`);
    assert.ok(problem.includes(key), `拒绝理由应点名 ${key}：${problem}`);
    assert.throws(() => parsePresetIndex(index), /预设索引不可用/);
  }

  // id / name 的类型不对同样拒绝
  const wrongTypes = cloneIndex();
  wrongTypes.schools[1]!['name'] = '   ';
  assert.match(String(describePresetIndexProblem(wrongTypes)), /name/);
});

test('index.json：系统引用缺任一必填字段都拒绝', () => {
  for (const key of ['id', 'name', 'detect', 'entryPath', 'hint']) {
    const index = cloneIndex();
    const system = index.systems[0];
    assert.ok(system !== undefined);
    delete system[key];

    const problem = describePresetIndexProblem(index);
    assert.ok(problem !== null, `系统缺 ${key} 应被拒绝`);
    assert.ok(problem.includes(key), `拒绝理由应点名 ${key}：${problem}`);
    assert.throws(() => parsePresetIndex(index), /预设索引不可用/);
  }
});

test('index.json：detect 的四个子键缺一不可，且必须是字符串数组', () => {
  for (const key of ['markers', 'timetableTableIds', 'timetableTableClasses', 'gridCellIdPatterns']) {
    const index = cloneIndex();
    const detect = index.systems[0]?.['detect'] as Record<string, unknown>;
    delete detect[key];
    const problem = describePresetIndexProblem(index);
    assert.ok(problem !== null, `缺 detect.${key} 应被拒绝`);
    assert.ok(problem.includes(`detect.${key}`), `拒绝理由应点名 detect.${key}：${problem}`);
  }

  const wrongType = cloneIndex();
  (wrongType.systems[0]?.['detect'] as Record<string, unknown>)['markers'] = 'jwglxt';
  assert.match(String(describePresetIndexProblem(wrongType)), /detect\.markers 应为字符串数组/);

  const badElement = cloneIndex();
  (badElement.systems[0]?.['detect'] as Record<string, unknown>)['markers'] = ['jwglxt', ''];
  assert.match(String(describePresetIndexProblem(badElement)), /detect\.markers\[1\]/);
});

test('index.json：entryPath 必须以 / 开头', () => {
  const index = cloneIndex();
  index.systems[0]!['entryPath'] = 'jwglxt/xtgl/login_slogin.html';
  assert.match(String(describePresetIndexProblem(index)), /entryPath 应以 \/ 开头/);
});

test('index.json：同一份索引里 id 不得重复', () => {
  const duplicatedSchools = cloneIndex();
  duplicatedSchools.schools[1]!['id'] = duplicatedSchools.schools[0]!['id'];
  assert.match(String(describePresetIndexProblem(duplicatedSchools)), /id 重复/);

  const duplicatedSystems = cloneIndex();
  duplicatedSystems.systems[1]!['id'] = duplicatedSystems.systems[0]!['id'];
  assert.match(String(describePresetIndexProblem(duplicatedSystems)), /id 重复/);
});

test('index.json：路径必须是安全的相对路径（不许越出仓库根）', () => {
  const cases: Array<[string, string]> = [
    ['timetablePath', '../outside.json'],
    ['timetablePath', 'presets/../../outside.json'],
    ['timetablePath', '/etc/passwd'],
    ['timetablePath', 'presets\\schools\\usts\\timetable.json'],
    ['timetablePath', 'E:/evil.json'],
    ['timetablePath', ''],
    ['configPath', '../../evil.json'],
    ['configPath', '/'],
  ];
  for (const [key, value] of cases) {
    const index = cloneIndex();
    index.schools[1]![key] = value;
    const problem = describePresetIndexProblem(index);
    assert.ok(problem !== null, `${key} = ${JSON.stringify(value)} 应被拒绝`);
    assert.ok(problem.includes(key), `拒绝理由应点名 ${key}：${problem}`);
  }

  // 系统的可选路径字段一旦出现，同样要过检查
  const systemIndex = cloneIndex();
  systemIndex.systems[0]!['metaPath'] = '../meta.json';
  assert.match(String(describePresetIndexProblem(systemIndex)), /metaPath/);
});

test('index.json：结构或类型异常都只被拒绝，绝不抛非预期异常', () => {
  const broken: unknown[] = [
    null,
    undefined,
    42,
    'not json',
    [1, 2],
    true,
    {},
    { _generated: true },
    { _generated: true, version: '0.1.0' },
    { _generated: true, version: '0.1.0', schemaVersion: 1 },
    { _generated: true, version: '', schemaVersion: 1, schools: [], systems: [] },
    { _generated: true, version: 1, schemaVersion: 1, schools: [], systems: [] },
    { _generated: true, version: '0.1.0', schemaVersion: '1', schools: [], systems: [] },
    { _generated: true, version: '0.1.0', schemaVersion: 99, schools: [], systems: [] },
    { _generated: true, version: '0.1.0', schemaVersion: 1, schools: 'nope', systems: [] },
    { _generated: true, version: '0.1.0', schemaVersion: 1, schools: [], systems: 'nope' },
    { _generated: true, version: '0.1.0', schemaVersion: 1, schools: [null], systems: [] },
    { _generated: true, version: '0.1.0', schemaVersion: 1, schools: ['x'], systems: [] },
    { _generated: true, version: '0.1.0', schemaVersion: 1, schools: [], systems: [42] },
    { _generated: true, version: '0.1.0', schemaVersion: 1, schools: [{}], systems: [] },
    { _generated: true, version: '0.1.0', schemaVersion: 1, schools: [], systems: [{ detect: null }] },
    { _generated: true, version: '0.1.0', schemaVersion: 1, schools: [], systems: [{ id: 'x', detect: {} }] },
  ];

  for (const value of broken) {
    const problem = describePresetIndexProblem(value);
    assert.equal(typeof problem, 'string', `应给出一条可读理由：${JSON.stringify(value) ?? 'undefined'}`);
    assert.ok((problem ?? '').length > 0);
    assert.throws(() => parsePresetIndex(value), /预设索引不可用/, `parsePresetIndex 应抛出可读错误：${String(problem)}`);
  }
});

test('index.json：schemaVersion 高于本版能消费的版本时提示升级', () => {
  const index = cloneIndex();
  index['schemaVersion'] = PRESET_SCHEMA_VERSION + 1;
  assert.match(String(describePresetIndexProblem(index)), /schemaVersion 2.*请升级应用/);
});

test('fetchPresetIndex：正常下载并通过校验，请求的就是索引地址', async () => {
  const seen: string[] = [];
  const index = await fetchPresetIndex(async (input) => {
    seen.push(String(input));
    return jsonResponse(REAL_PRESET_INDEX);
  });
  assert.deepEqual(seen, [PRESET_INDEX_URL]);
  assert.equal(index.version, '0.1.0');
  assert.deepEqual(
    index.schools.map((school) => school.id),
    ['default', 'usts'],
  );
});

test('fetchPresetIndex：HTTP 失败、JSON 非法、结构不对、断网都抛可读错误', async () => {
  await assert.rejects(
    () => fetchPresetIndex(async () => jsonResponse({}, false, 404)),
    /预设索引下载失败：预设源返回 404/,
  );
  await assert.rejects(
    () =>
      fetchPresetIndex(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('Unexpected token <');
            },
          }) as unknown as Response,
      ),
    /Unexpected token/,
  );
  await assert.rejects(
    () => fetchPresetIndex(async () => jsonResponse({ _generated: false })),
    /预设索引不可用.*_generated/,
  );
  await assert.rejects(
    () =>
      fetchPresetIndex(async () => {
        throw new Error('fetch failed');
      }),
    /无法连接预设源/,
  );
});
