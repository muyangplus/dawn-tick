/**
 * 内置预设快照的一致性测试。
 *
 * 守五件事：
 *   1. **快照自洽**：`verifyBuiltinPresetSnapshot()` 复算规范化 sha256 必须与快照里的 `hash` 一致；
 *   2. **篡改可见**：改动快照内容后复算哈希必须对不上（只改内存里的浅拷贝，不碰仓库文件）；
 *   3. **不漂移**：`BUILTIN_TIMETABLES` / `readSystemsConfig()` 与快照 `sources` 清单对齐；
 *   4. **同步脚本可用**：`tools/presets/sync-snapshot.mjs` 能正确写入、`--check` 只读、
 *      快照被篡改或缺目录时非 0 退出、一个文件都不写；
 *   5. **真实内置配置零改动**：所有会写盘的用例一律走 `--out <临时目录>`，
 *      本测试**从不写** `packages/core/src/config/` 下的那两个真实文件；
 *      测试结束时还会比对它们的 sha256 与测试开始前是否**完全一致**。
 *
 * 为什么这么严：写入类用例曾经临时改写真实的内置配置再在 finally 还原，
 * 进程被强杀就会把 9.9.9 的假快照留在工作区。现在写盘只发生在 `mkdtempSync` 出来的临时目录里，
 * 真实目录连 mtime 都不该变——这本身就是一条被断言的验收项。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_PRESET_SCHEMA_VERSION,
  BUILTIN_PRESET_SNAPSHOT,
  BUILTIN_PRESET_VERSION,
  BUILTIN_TIMETABLES,
  canonicalPresetJson,
  builtinPresetSourcesDigest,
  readSystemsConfig,
  sha256HexSync,
  verifyBuiltinPresetSnapshot,
  type PresetSnapshot,
} from '../src/config/index.ts';

/** 仓库根目录（本文件在 packages/core/test/ 下）。 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SYNC_SCRIPT = join(REPO_ROOT, 'tools', 'presets', 'sync-snapshot.mjs');

/**
 * 真实内置配置的两个目标文件：本测试**只读**它们，任何写入都必须发生在 `--out` 临时目录里。
 */
const SNAPSHOT_TARGET = join(REPO_ROOT, 'packages', 'core', 'src', 'config', 'builtin-preset-snapshot.json');
const VERSION_TARGET = join(REPO_ROOT, 'packages', 'core', 'src', 'config', 'preset-version.json');

/**
 * 只读参考：预设仓库（`E:\work\dsh\dawn-tick-presets` 或仓库旁的同级目录）。
 * 为了让本测试既能当仓库内单测、也能在外层做端到端核对，它缺失时相关断言会跳过。
 * 可用 `DAWN_TICK_PRESETS_DIR` 环境变量指定。
 */
const PRESETS_DIR = process.env['DAWN_TICK_PRESETS_DIR'] ?? 'E:/work/dsh/dawn-tick-presets';

/** 预设仓库 snapshot.mjs 的签名口径：去掉 hash 后规范化序列化，再取 sha256。 */
function sign(snapshot: Omit<PresetSnapshot, 'hash'>): PresetSnapshot {
  return { ...snapshot, hash: `sha256:${sha256HexSync(canonicalPresetJson(snapshot))}` };
}

/** 复算任意快照对象的规范化哈希（与实现同一套口径，直接取自 core）。 */
function recomputedHashOf(snapshot: PresetSnapshot): string {
  const { hash: _ignored, ...unsigned } = snapshot as unknown as Record<string, unknown>;
  return `sha256:${sha256HexSync(canonicalPresetJson(unsigned))}`;
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

/** 真实文件的 sha256（hex，无前缀）——本文件所有「没被写过」的断言都用它。 */
function sha256OfFile(path: string): string {
  return sha256HexSync(readText(path));
}

/**
 * 本文件刚加载时（= 测试运行前）两个真实文件的原文与 sha256。
 * 既是下面只读断言的基准，也是「测试结束后真实文件必须一字未动」的比对依据。
 */
const ORIGINAL_SNAPSHOT_TEXT = readText(SNAPSHOT_TARGET);
const ORIGINAL_VERSION_TEXT = readText(VERSION_TARGET);
const ORIGINAL_SNAPSHOT_SHA256 = sha256OfFile(SNAPSHOT_TARGET);
const ORIGINAL_VERSION_SHA256 = sha256OfFile(VERSION_TARGET);
const ORIGINAL_DIGEST = builtinPresetSourcesDigest();
/** 内置快照是否还是预设仓库 1.0.0 的原文（为假说明工作区被假数据污染了，见 before 钩子）。 */
const SNAPSHOT_IS_REAL = /"version": "1\.0\.0"/.test(ORIGINAL_SNAPSHOT_TEXT);

before(() => {
  // 本测试不再改写真实文件，所以这里只做「进来时工作区必须是干净的」这一条体检；
  // 上次若被旧版测试跑崩在中途留下假数据，这里会明确指出怎么恢复。
  assert.equal(
    readText(SNAPSHOT_TARGET),
    ORIGINAL_SNAPSHOT_TEXT,
    '测试开始时真实内置快照与本文件加载时读到的原文不一致（工作区被污染了）',
  );
  assert.equal(
    readText(VERSION_TARGET),
    ORIGINAL_VERSION_TEXT,
    '测试开始时真实 preset-version.json 与本文件加载时读到的原文不一致（工作区被污染了）',
  );
});

after(() => {
  // 收尾兜底：两个真实文件的 sha256 必须与测试开始前完全一致
  assert.equal(sha256OfFile(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_SHA256, '真实内置快照的 sha256 在测试前后必须一致');
  assert.equal(sha256OfFile(VERSION_TARGET), ORIGINAL_VERSION_SHA256, '真实 preset-version.json 的 sha256 在测试前后必须一致');
  assert.equal(readText(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_TEXT, '测试结束时内置快照应仍是原文');
  assert.equal(readText(VERSION_TARGET), ORIGINAL_VERSION_TEXT, '测试结束时 preset-version.json 应仍是原文');
});

test('前置：内置快照是真实快照（工作区没被假数据污染）', () => {
  assert.equal(
    SNAPSHOT_IS_REAL,
    true,
    '内置快照不是预设仓库 1.0.0 的原文，说明工作区里留着测试注入的假数据；' +
      '请重跑 node tools/presets/sync-snapshot.mjs --from <预设仓库> 恢复',
  );
});

test('内置快照：verifyBuiltinPresetSnapshot() 通过', () => {
  const result = verifyBuiltinPresetSnapshot();
  assert.equal(result.ok, true, `内置快照应通过校验，实际原因：${result.reason ?? '（无）'}`);
  assert.equal(result.reason, undefined);
});

test('内置快照：逐字段与预设仓库 1.0.0 的真快照一致（含 hash 与 generatedAt）', () => {
  // 这份期望值是预设仓库 1.0.0 快照的原文，手抄在此作「外部基准」：
  // 用自己的实现签自己的数据是循环论证，只有这份别人算出来的 hash 能证明口径对齐。
  assert.deepEqual(BUILTIN_PRESET_SNAPSHOT, {
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
  });
  // 版本文件与快照必须同一版本线
  assert.equal(BUILTIN_PRESET_VERSION, BUILTIN_PRESET_SNAPSHOT.version);
  assert.equal(BUILTIN_PRESET_SCHEMA_VERSION, BUILTIN_PRESET_SNAPSHOT.schemaVersion);
});

test('篡改检测：改写 sources.systems[0] 的条目后复算哈希与 hash 不符', () => {
  const first = BUILTIN_PRESET_SNAPSHOT.sources.systems[0];
  assert.ok(first !== undefined, '快照应至少有一个教务系统');
  const originalPath = first.path;

  // 浅拷贝两层：改的是内存对象，仓库文件一个字都不动。
  // 用 unknown 转换是因为「塞一个源清单里没有的字段」正是要模拟的篡改行为，类型系统当然不允许。
  const tamperedSystems = [...BUILTIN_PRESET_SNAPSHOT.sources.systems];
  tamperedSystems[0] = { ...first, path: 'presets/systems/被篡改的教务系统.json' } as unknown as typeof first;
  const tampered: PresetSnapshot = {
    ...BUILTIN_PRESET_SNAPSHOT,
    sources: { ...BUILTIN_PRESET_SNAPSHOT.sources, systems: tamperedSystems },
  };

  const declared = tampered.hash;
  const recomputed = recomputedHashOf(tampered);
  assert.notEqual(recomputed, declared, '条目被改写后复算哈希必须与快照声明的 hash 不同');
  assert.equal(BUILTIN_PRESET_SNAPSHOT.sources.systems[0]?.path, originalPath, '原对象不应被污染');
  assert.equal(verifyBuiltinPresetSnapshot().ok, true, '仓库里的内置快照仍然自洽');

  // 反向验证：同一份篡改对象若把 hash 一起改掉，就会「自洽」——说明检测点确实是内容哈希
  const resigned = { ...tampered, hash: recomputed };
  assert.equal(recomputedHashOf(resigned), recomputed);
  assert.notEqual(resigned.hash, declared);
});

test('一致性：BUILTIN_TIMETABLES 与快照 sources.timetables 对齐', () => {
  const listed = BUILTIN_PRESET_SNAPSHOT.sources.timetables;
  assert.equal(listed.length, BUILTIN_TIMETABLES.length, '快照列出的作息表数量应与内置一致');
  const listedIds = listed.map((item) => item.id);
  assert.deepEqual(
    [...new Set(listedIds)].sort(),
    BUILTIN_TIMETABLES.map((preset) => preset.id).sort(),
    '快照清单 id 与内置作息表 id 必须一一对应',
  );
  // 内置顺序不必等于快照顺序（快照按文件名排序），但内容集合必须相同
  for (const item of listed) {
    const builtin: { id: string } | undefined = BUILTIN_TIMETABLES.find((preset) => preset.id === item.id);
    assert.ok(builtin !== undefined, `内置作息表应含 ${item.id}`);
    assert.equal(item.path, `presets/timetables/${item.id}.json`);
  }
});

test('一致性：readSystemsConfig() 与快照 sources.systems 对齐', () => {
  const listed = BUILTIN_PRESET_SNAPSHOT.sources.systems;
  const systems = readSystemsConfig();
  assert.equal(listed.length, systems.length, '快照列出的教务系统数量应与内置一致');
  assert.deepEqual(
    listed.map((item) => item.id).sort(),
    systems.map((system) => system.id).sort(),
    '快照清单 id 与内置教务系统 id 必须一一对应',
  );
  for (const item of listed) {
    const builtin: { id: string } | undefined = systems.find((system) => system.id === item.id);
    assert.ok(builtin !== undefined, `内置教务系统应含 ${item.id}`);
    assert.equal(item.path, `presets/systems/${item.id}.json`);
  }
});

/** 一致性：预设仓库只读参考在场时，逐条内容与内置配置 deepEqual。 */
test('一致性：预设仓库只读参考在场时，逐条内容与内置配置 deepEqual', (t) => {
  if (!existsSync(PRESETS_DIR)) {
    t.skip(`预设仓库不在 ${PRESETS_DIR}，跳过端到端内容比对`);
    return;
  }

  const groups = [
    { label: '作息表', listed: BUILTIN_PRESET_SNAPSHOT.sources.timetables, builtin: BUILTIN_TIMETABLES },
    { label: '教务系统', listed: BUILTIN_PRESET_SNAPSHOT.sources.systems, builtin: readSystemsConfig() },
  ];
  for (const group of groups) {
    for (const item of group.listed) {
      const sourcePath = join(PRESETS_DIR, item.path);
      assert.ok(existsSync(sourcePath), `预设仓库应存在 ${item.path}`);
      const sourceText = readText(sourcePath);
      const builtin: { id: string } | undefined = group.builtin.find((entry) => entry.id === item.id);
      assert.ok(builtin !== undefined);

      if (SNAPSHOT_IS_REAL) {
        // 内置快照还是预设仓库 1.0.0 的原文：内容与清单里的单文件哈希都要对得上
        assert.deepEqual(
          builtin,
          JSON.parse(sourceText) as unknown,
          `内置${group.label}「${item.id}」应与预设仓库 ${item.path} 逐字段一致`,
        );
        assert.equal(`sha256:${sha256HexSync(sourceText)}`, item.sha256, `${item.path} 的 sha256 应与快照一致`);
      } else {
        // 内置快照被外部污染时退一步只比 id 集合（本测试自己不会再造成这种污染）
        assert.equal(typeof builtin.id, 'string');
      }
    }
  }
});

test('内置正文指纹：builtinPresetSourcesDigest() 稳定', () => {
  const digest = builtinPresetSourcesDigest();
  assert.match(digest.timetables, /^sha256:[0-9a-f]{64}$/);
  assert.match(digest.systems, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(builtinPresetSourcesDigest(), digest, '同一份内容必须得到同一个指纹');
  assert.notEqual(digest.timetables, digest.systems, '两类源的指纹不应偶合');
  assert.deepEqual(builtinPresetSourcesDigest(), ORIGINAL_DIGEST, '内置正文在测试前后必须没变');
});

// —— 下面全部是会「真的落盘」的用例，一律只写 --out 给的临时目录 ——
//
// node:test 的同文件用例按注册顺序串行跑，所以最后的「真实文件 sha256 未变」用例
// 排在所有写盘用例之后，能把它们的副作用一并兜住。

/**
 * 造一份假的预设仓库：内容清单与内置一致，但版本 / 时间戳 / 格式都不同。
 * 这样既能验证「写入的是快照原文」，也不会和真实内置配置撞车。
 * 调用方负责 `rmSync(root, { recursive: true, force: true })`。
 */
function makeFakePresetRepo(version = '9.9.9'): { root: string; snapshotText: string } {
  const root = mkdtempSync(join(tmpdir(), 'dawn-tick-presets-'));
  const fake: Omit<PresetSnapshot, 'hash'> = {
    version,
    schemaVersion: 1,
    generatedAt: '2030-05-06T07:08:09.000Z',
    sources: {
      timetables: BUILTIN_TIMETABLES.map((preset) => ({
        id: preset.id,
        path: `presets/timetables/${preset.id}.json`,
        sha256: `sha256:${'1'.repeat(64)}`,
      })),
      systems: readSystemsConfig().map((system) => ({
        id: system.id,
        path: `presets/systems/${system.id}.json`,
        sha256: `sha256:${'2'.repeat(64)}`,
      })),
      adapters: { 'demo.js': `sha256:${'f'.repeat(64)}` },
    },
  };
  const snapshot = sign(fake);
  // 故意写成紧凑的单行：写入必须是逐字节复制，不能是重排后的 JSON
  const snapshotText = JSON.stringify(snapshot);
  mkdirSync(join(root, 'snapshot'), { recursive: true });
  writeFileSync(join(root, 'snapshot', `presets-${version}.json`), snapshotText, 'utf8');
  writeFileSync(
    join(root, 'version.json'),
    `${JSON.stringify({ version, schemaVersion: 1, channel: 'stable' }, null, 2)}\n`,
    'utf8',
  );
  return { root, snapshotText };
}

/** 一个只用来接 `--out` 的空临时目录（调用方负责删除）。 */
function makeTempOutDir(prefix = 'dawn-tick-snapshot-out-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 跑同步脚本（预期成功），返回 stdout。 */
function runSync(args: string[]): string {
  return execFileSync(process.execPath, [SYNC_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, SOURCE_DATE_EPOCH: '0' },
  });
}

test('同步脚本：--out 临时目录 → 写入两份文件，真实内置配置一字未动', () => {
  const repo = makeFakePresetRepo();
  const outDir = makeTempOutDir();
  const beforeSnapshotText = readText(SNAPSHOT_TARGET);
  const beforeVersionText = readText(VERSION_TARGET);
  const beforeSnapshotMtime = statSync(SNAPSHOT_TARGET).mtimeMs;
  const beforeVersionMtime = statSync(VERSION_TARGET).mtimeMs;
  try {
    const stdout = runSync(['--from', repo.root, '--out', outDir]);
    assert.match(stdout, /=== 预设快照同步 ===/);
    assert.match(stdout, /版本：9\.9\.9（schemaVersion 1）/);
    assert.match(stdout, /内容哈希：sha256:[0-9a-f]{64}（已复算一致）/);
    assert.match(stdout, /输出目录：.*（--out 指定）/, '摘要必须写明写入目录');
    assert.match(stdout, /已写入：.*builtin-preset-snapshot\.json/);
    assert.match(stdout, /已写入：.*preset-version\.json/);

    // ① --out 目录里出现了两份内容正确的文件
    const outSnapshotPath = join(outDir, 'builtin-preset-snapshot.json');
    const outVersionPath = join(outDir, 'preset-version.json');
    const writtenSnapshot = readText(outSnapshotPath);
    assert.equal(writtenSnapshot, repo.snapshotText, '写入的必须是预设仓库快照的原文（逐字节）');
    assert.deepEqual(JSON.parse(writtenSnapshot), JSON.parse(repo.snapshotText));
    assert.deepEqual(JSON.parse(readText(outVersionPath)), { version: '9.9.9', schemaVersion: 1 });

    // ② 真实内置配置：内容、sha256 与 mtime 都不许变
    assert.equal(readText(SNAPSHOT_TARGET), beforeSnapshotText, '真实内置快照不得被写入');
    assert.equal(readText(VERSION_TARGET), beforeVersionText, '真实 preset-version.json 不得被写入');
    assert.equal(sha256OfFile(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_SHA256);
    assert.equal(sha256OfFile(VERSION_TARGET), ORIGINAL_VERSION_SHA256);
    assert.equal(statSync(SNAPSHOT_TARGET).mtimeMs, beforeSnapshotMtime, '真实内置快照的 mtime 不应变化');
    assert.equal(statSync(VERSION_TARGET).mtimeMs, beforeVersionMtime, '真实 preset-version.json 的 mtime 不应变化');

    // ③ 幂等：再跑一次不再写文件，并明确报告「未改动」
    const secondRun = runSync(['--from', repo.root, '--out', outDir]);
    assert.match(secondRun, /未改动任何文件（幂等）/);
    assert.equal(readText(outSnapshotPath), repo.snapshotText);
    assert.equal(readText(outVersionPath), `${JSON.stringify({ version: '9.9.9', schemaVersion: 1 }, null, 2)}\n`);
    assert.equal(sha256OfFile(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_SHA256);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('同步脚本：--out 目录不存在时按需创建（默认目录不受影响）', () => {
  const repo = makeFakePresetRepo();
  const parent = makeTempOutDir('dawn-tick-snapshot-nested-');
  const outDir = join(parent, '子目录', 'config');
  assert.equal(existsSync(outDir), false);
  try {
    const stdout = runSync(['--from', repo.root, '--out', outDir]);
    assert.match(stdout, /已写入：.*builtin-preset-snapshot\.json/);
    assert.equal(readText(join(outDir, 'builtin-preset-snapshot.json')), repo.snapshotText);
    assert.equal(sha256OfFile(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_SHA256, '真实内置快照不受影响');
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test('同步脚本：--check 只校验不写盘（--out 目录为空 → 需要同步；写入后 → 已是最新）', () => {
  const repo = makeFakePresetRepo();
  const outDir = makeTempOutDir('dawn-tick-snapshot-check-');
  try {
    const first = runSync(['--from', repo.root, '--out', outDir, '--check']);
    assert.match(first, /--check：.*需要同步/);
    assert.match(first, /未改动任何文件（幂等）/);
    assert.deepEqual(readdirSync(outDir), [], '--check 不得写出任何文件');

    runSync(['--from', repo.root, '--out', outDir]);
    const second = runSync(['--from', repo.root, '--out', outDir, '--check']);
    assert.match(second, /--check：.*已是最新，无需同步/);
    assert.deepEqual(
      readdirSync(outDir).sort(),
      ['builtin-preset-snapshot.json', 'preset-version.json'],
      '写入后目录里应正好是两份目标文件',
    );
    assert.equal(sha256OfFile(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_SHA256);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('同步脚本：不给 --out 时默认输出目录仍是主仓库内置配置（--check 只读，不写真实文件）', () => {
  const repo = makeFakePresetRepo();
  const beforeSnapshotMtime = statSync(SNAPSHOT_TARGET).mtimeMs;
  try {
    const stdout = runSync(['--from', repo.root, '--check']);
    assert.match(stdout, /输出目录：packages\/core\/src\/config（主仓库内置配置，默认）/);
    assert.match(
      stdout,
      /目标文件：packages\/core\/src\/config\/builtin-preset-snapshot\.json、packages\/core\/src\/config\/preset-version\.json/,
    );
    assert.match(stdout, /--check：packages\/core\/src\/config 里的内置快照与预设仓库不一致，需要同步/);
    assert.equal(readText(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_TEXT, '默认路径的 --check 也不得写盘');
    assert.equal(statSync(SNAPSHOT_TARGET).mtimeMs, beforeSnapshotMtime);
    assert.equal(sha256OfFile(VERSION_TARGET), ORIGINAL_VERSION_SHA256);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test('同步脚本：哈希不符的假快照 → 非 0 退出、不写任何文件（含 --out 目录）', () => {
  const repo = makeFakePresetRepo();
  const outDir = makeTempOutDir('dawn-tick-snapshot-bad-');
  try {
    const good = JSON.parse(repo.snapshotText) as PresetSnapshot;
    // 只改 hash 的最后一位：结构完全合法，只有内容哈希对不上
    const broken = { ...good, hash: `${good.hash.slice(0, -1)}${good.hash.endsWith('0') ? '1' : '0'}` };
    assert.notEqual(broken.hash, good.hash);
    writeFileSync(join(repo.root, 'snapshot', 'presets-9.9.9.json'), `${JSON.stringify(broken, null, 2)}\n`, 'utf8');

    const failure = runExpectingFailure(['--from', repo.root, '--out', outDir]);
    assert.notEqual(failure.status, 0, '哈希不符必须非 0 退出');
    assert.match(failure.stderr, /快照哈希校验未通过/);
    assert.match(failure.stderr, /未写入任何文件/);

    assert.deepEqual(readdirSync(outDir), [], '失败时 --out 目录里不该有任何文件');
    assert.equal(readText(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_TEXT, '失败时不得改动内置快照');
    assert.equal(readText(VERSION_TARGET), ORIGINAL_VERSION_TEXT, '失败时不得改动 preset-version.json');
    assert.equal(sha256OfFile(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_SHA256);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('同步脚本：预设仓库目录不存在 → 非 0 退出、不写任何文件（含 --out 目录）', () => {
  const outDir = makeTempOutDir('dawn-tick-snapshot-missing-');
  const missing = join(tmpdir(), 'dawn-tick-presets-不存在-9f3c1a');
  assert.equal(existsSync(missing), false);
  try {
    const failure = runExpectingFailure(['--from', missing, '--out', outDir]);
    assert.notEqual(failure.status, 0);
    assert.match(failure.stderr, /预设仓库目录不存在/);
    assert.match(failure.stderr, /未写入任何文件/);
    assert.deepEqual(readdirSync(outDir), []);
    assert.equal(readText(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_TEXT);
    assert.equal(readText(VERSION_TARGET), ORIGINAL_VERSION_TEXT);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('同步脚本：--out 指向文件或缺值 → 非 0 退出、不写任何文件', () => {
  const repo = makeFakePresetRepo();
  const parent = makeTempOutDir('dawn-tick-snapshot-badout-');
  const notADir = join(parent, '其实是文件.txt');
  writeFileSync(notADir, 'not a directory\n', 'utf8');
  try {
    const asFile = runExpectingFailure(['--from', repo.root, '--out', notADir]);
    assert.notEqual(asFile.status, 0);
    assert.match(asFile.stderr, /--out 指向的不是目录/);
    assert.match(asFile.stderr, /未写入任何文件/);

    // --out 后没跟目录：必须报错，绝不能悄悄退回默认目录去写真实内置配置
    const noValue = runExpectingFailure(['--from', repo.root, '--out']);
    assert.notEqual(noValue.status, 0);
    assert.match(noValue.stderr, /--out 参数（输出目录）应为非空字符串/);
    assert.match(noValue.stderr, /未写入任何文件/);

    assert.equal(readText(notADir), 'not a directory\n', '被当成 --out 的文件不应被改写');
    assert.equal(sha256OfFile(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_SHA256);
    assert.equal(sha256OfFile(VERSION_TARGET), ORIGINAL_VERSION_SHA256);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test('真实内置配置零改动：两个文件的 sha256 与测试开始前完全一致', () => {
  // 这条排在所有写盘用例之后：若上面任何一条偷偷写了真实文件，这里会当场对不上。
  assert.equal(
    sha256OfFile(SNAPSHOT_TARGET),
    ORIGINAL_SNAPSHOT_SHA256,
    'builtin-preset-snapshot.json 的 sha256 与本文件加载时不一致（有用例写了真实文件）',
  );
  assert.equal(
    sha256OfFile(VERSION_TARGET),
    ORIGINAL_VERSION_SHA256,
    'preset-version.json 的 sha256 与本文件加载时不一致（有用例写了真实文件）',
  );
  assert.match(ORIGINAL_SNAPSHOT_SHA256, /^[0-9a-f]{64}$/);
  assert.match(ORIGINAL_VERSION_SHA256, /^[0-9a-f]{64}$/);
});

/** 跑一个预期失败的同步脚本，返回状态码与 stderr（不抛异常）。 */
function runExpectingFailure(args: string[]): { status: number; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [SYNC_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, SOURCE_DATE_EPOCH: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    throw new Error(`本应失败却成功了：${stdout}`);
  } catch (cause: unknown) {
    const error = cause as { status?: number | null; stderr?: string | Buffer };
    if (typeof error.status !== 'number') throw cause;
    return { status: error.status, stderr: String(error.stderr ?? '') };
  }
}
