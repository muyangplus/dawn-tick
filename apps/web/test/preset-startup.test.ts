/**
 * 启动套用预设的测试：`applyCachedPreset` 是「启动套用、运行时绝不热替换」的落点。
 *
 * 用 `MemoryStorage` + 直接写 `app_meta` 造缓存（不联网、不启动界面），逐条验证：
 *   - 缓存版本 > 内置，且正文合法 → 套用，读取函数换成缓存内容；
 *   - 缓存版本 ≤ 内置 → 不套用（不允许降级）；
 *   - 缓存损坏 / 缺正文 / 正文与快照版本不一致 → 回退内置；
 *   - 正文不合法（作息时间非法）→ 回退内置，内置一个字段都不受影响。
 *
 * 覆盖层是模块级状态，每个用例前后都清一次。
 */
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_PRESET_VERSION,
  BUILTIN_TIMETABLES,
  MemoryStorage,
  effectivePresetVersion,
  effectiveTimetables,
  findTimetable,
  readSystemsConfig,
  setPresetOverride,
  type Storage,
} from '@dawn-tick/core';
import {
  PRESET_CONTENT_META_KEY,
  PRESET_SNAPSHOT_META_KEY,
  applyCachedPreset,
  canonicalPresetJson,
  readCachedSnapshot,
  resolveCachedPresetContent,
  resolvePresetSource,
  sha256HexSync,
  writeCachedPresetContent,
  writeCachedSnapshot,
  type CachedPresetContent,
  type PresetSnapshot,
} from '../src/preset-update.ts';

/** 缓存正文：覆盖掉内置 `default`，并新增一个内置里没有的 `cached-demo`。 */
const CACHED_CONTENT: CachedPresetContent = {
  version: '1.1.0',
  timetables: [
    {
      id: 'default',
      name: '缓存通用作息',
      periods: [
        { periodNo: 1, start: '08:30', end: '09:15' },
        { periodNo: 2, start: '09:25', end: '10:10' },
      ],
    },
    {
      id: 'cached-demo',
      name: '仅缓存作息',
      periods: [{ periodNo: 1, start: '07:00', end: '07:45' }],
    },
  ],
  systems: [
    {
      id: 'jwglxt',
      name: '正方教务（缓存）',
      entryPath: '/jwglxt/xtgl/login_slogin.html',
      hint: '缓存正文',
      detect: { markers: ['jwglxt'] },
    },
  ],
};

/** 造一份哈希自洽、结构合法的快照（清单条目只带 id/path/sha256，另带内嵌索引）。 */
function signedSnapshot(version: string): PresetSnapshot {
  const unsigned = {
    version,
    schemaVersion: 1,
    generatedAt: '2026-02-01T00:00:00.000Z',
    sources: {
      timetables: [
        // 照合并后的结构：作息表的 path 是历史契约符号路径（timetable.json 已并入 school.json）
        { id: 'default', path: 'presets/schools/_default/timetable.json', sha256: `sha256:${'0'.repeat(64)}` },
      ],
      systems: [
        { id: 'jwglxt', path: 'presets/systems/jwglxt/system.json', sha256: `sha256:${'1'.repeat(64)}` },
      ],
      adapters: {},
    },
    // 新结构的快照一定内嵌 index（原 presets/index.json）：假快照同样带上，
    // 这样哈希口径与真实产物一致，也能覆盖「缓存快照带着索引」的形状。
    index: {
      _generated: true,
      version,
      schemaVersion: 1,
      generatedAt: '2026-02-01T00:00:00.000Z',
      schools: [
        {
          id: 'default',
          name: '通用作息',
          system: null,
          configPath: 'presets/schools/_default/school.json',
          timetablePath: 'presets/schools/_default/school.json',
        },
      ],
      systems: [
        {
          id: 'jwglxt',
          name: '正方教务',
          metaPath: 'presets/systems/jwglxt/system.json',
          loginPath: 'presets/systems/jwglxt/system.json',
          detect: { markers: ['jwglxt'], timetableTableIds: [], timetableTableClasses: [], gridCellIdPatterns: [] },
          entryPath: '/jwglxt/xtgl/login_slogin.html',
          hint: '缓存正文',
        },
      ],
    },
  };
  return { ...unsigned, hash: `sha256:${sha256HexSync(canonicalPresetJson(unsigned))}` };
}

/** 造好「快照 + 正文」两侧缓存；正文版本可单独指定，用来测版本不一致。 */
async function storageWithCache(
  snapshotVersion: string,
  content: CachedPresetContent = { ...CACHED_CONTENT, version: snapshotVersion },
): Promise<Storage> {
  const storage = new MemoryStorage();
  await writeCachedSnapshot(storage, signedSnapshot(snapshotVersion));
  await writeCachedPresetContent(storage, content);
  return storage;
}

beforeEach(() => {
  setPresetOverride(null);
});

afterEach(() => {
  setPresetOverride(null);
});

test('缓存版本高于内置且正文合法：启动套用，读取函数换成缓存内容', async () => {
  const storage = await storageWithCache('1.1.0');

  const applied = await applyCachedPreset(storage);
  assert.equal(applied.applied, true);
  assert.equal(applied.kind, 'cached');
  assert.equal(applied.version, '1.1.0');

  // 有效预设真的换了：同名 id 被覆盖、新增 id 能查到、内置独有的看不到
  assert.equal(findTimetable('default')?.name, '缓存通用作息');
  assert.equal(findTimetable('cached-demo')?.name, '仅缓存作息');
  assert.equal(findTimetable('usts'), undefined);
  assert.equal(effectivePresetVersion(), '1.1.0');
  assert.equal(readSystemsConfig()[0]?.name, '正方教务（缓存）');

  // 内置常量没被改写
  assert.equal(BUILTIN_TIMETABLES.find((preset) => preset.id === 'default')?.name, '通用作息');
});

test('缓存版本等于或低于内置：不套用，继续用内置', async () => {
  const same = await applyCachedPreset(await storageWithCache(BUILTIN_PRESET_VERSION));
  assert.equal(same.applied, false);
  assert.equal(same.kind, 'builtin');
  assert.equal(same.version, BUILTIN_PRESET_VERSION);
  assert.equal(findTimetable('default')?.name, '通用作息');
  assert.equal(findTimetable('cached-demo'), undefined);

  // 装回旧包后残留的更新缓存：禁止降级。
  // 内置现在是 0.1.0，所以「更旧」要取 0.x 里比它小的版本（0.9.0 反而比内置新）。
  const older = await applyCachedPreset(await storageWithCache('0.0.9'));
  assert.equal(older.applied, false);
  assert.equal(effectivePresetVersion(), BUILTIN_PRESET_VERSION);
  assert.equal(findTimetable('default')?.name, '通用作息');
});

test('只有快照、没有正文：回退内置并给出可读原因', async () => {
  const storage = new MemoryStorage();
  await writeCachedSnapshot(storage, signedSnapshot('1.1.0'));

  // 快照本身仍是「可信且更新」的：设置页该照旧显示已更新
  const source = await resolvePresetSource(storage);
  assert.equal(source.kind, 'cached');
  assert.equal(source.version, '1.1.0');

  const applied = await applyCachedPreset(storage);
  assert.equal(applied.applied, false);
  assert.equal(applied.kind, 'builtin');
  assert.match(String(applied.reason), /缺少可用正文/);
  assert.equal(findTimetable('default')?.name, '通用作息');
});

test('缓存正文损坏：JSON 非法 / 结构不对 / 作息时间非法，全部回退内置', async () => {
  const brokenJson = await storageWithCache('1.1.0');
  await brokenJson.writeMeta(PRESET_CONTENT_META_KEY, '{ 不是 JSON');
  assert.equal(await resolveCachedPresetContent(brokenJson), null);
  assert.equal((await applyCachedPreset(brokenJson)).applied, false);

  const wrongShape = await storageWithCache('1.1.0');
  await wrongShape.writeMeta(PRESET_CONTENT_META_KEY, JSON.stringify({ version: '1.1.0' }));
  assert.equal(await resolveCachedPresetContent(wrongShape), null);
  assert.equal((await applyCachedPreset(wrongShape)).applied, false);

  // 结构对但内容非法：`8:00` 不是合法的 HH:MM
  const invalidBody = await storageWithCache('1.1.0');
  await invalidBody.writeMeta(
    PRESET_CONTENT_META_KEY,
    JSON.stringify({
      ...CACHED_CONTENT,
      timetables: [{ id: 'bad', name: '坏作息', periods: [{ periodNo: 1, start: '8:00', end: '08:45' }] }],
    }),
  );
  assert.equal(await resolveCachedPresetContent(invalidBody), null, '不合法正文应在读回时被拦住');

  // 非法教务系统同理
  const invalidSystems = await storageWithCache('1.1.0');
  await invalidSystems.writeMeta(
    PRESET_CONTENT_META_KEY,
    JSON.stringify({ ...CACHED_CONTENT, systems: [{ id: '不存在的系统' }] }),
  );
  assert.equal(await resolveCachedPresetContent(invalidSystems), null);

  for (const storage of [brokenJson, wrongShape, invalidBody, invalidSystems]) {
    const applied = await applyCachedPreset(storage);
    assert.equal(applied.applied, false);
    assert.equal(effectivePresetVersion(), BUILTIN_PRESET_VERSION);
    assert.equal(findTimetable('default')?.name, '通用作息');
  }
});

test('正文版本与快照版本不一致：视为缓存不可用，回退内置', async () => {
  // 快照说 1.1.0，正文却是 1.0.5
  const storage = await storageWithCache('1.1.0', { ...CACHED_CONTENT, version: '1.0.5' });
  assert.equal(await resolveCachedPresetContent(storage, '1.1.0'), null);

  const applied = await applyCachedPreset(storage);
  assert.equal(applied.applied, false);
  assert.match(String(applied.reason), /版本不一致/);
  assert.equal(findTimetable('cached-demo'), undefined);
});

test('缓存快照损坏（哈希不符）：无从谈起正文，直接用内置', async () => {
  const storage = new MemoryStorage();
  const tampered = { ...signedSnapshot('1.1.0'), version: '9.9.9' };
  await storage.writeMeta(PRESET_SNAPSHOT_META_KEY, JSON.stringify(tampered));
  await writeCachedPresetContent(storage, { ...CACHED_CONTENT, version: '9.9.9' });

  assert.equal(await readCachedSnapshot(storage), null, '内容与 hash 不符的快照必须被忽略');
  const applied = await applyCachedPreset(storage);
  assert.equal(applied.applied, false);
  assert.equal(applied.kind, 'builtin');
  assert.equal(findTimetable('cached-demo'), undefined);
});

test('重复调用是幂等的：先套用缓存、再对空库套用会退回内置', async () => {
  const storage = await storageWithCache('1.1.0');
  assert.equal((await applyCachedPreset(storage)).applied, true);

  // 缓存被清掉后（例如用户重装/降级残留清理）再启动一次：必须回到内置，而不是留着旧覆盖
  await storage.writeMeta(PRESET_SNAPSHOT_META_KEY, '');
  const again = await applyCachedPreset(storage);
  assert.equal(again.applied, false);
  assert.equal(again.kind, 'builtin');
  assert.equal(findTimetable('default')?.name, '通用作息');
  assert.deepEqual(effectiveTimetables(), BUILTIN_TIMETABLES);
});
