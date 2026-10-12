/**
 * 内置预设快照的一致性测试。
 *
 * 守四件事：
 *   1. **快照自洽**：`verifyBuiltinPresetSnapshot()` 复算规范化 sha256 必须与快照里的 `hash` 一致；
 *   2. **篡改可见**：改动快照内容后复算哈希必须对不上（只改内存里的浅拷贝，不碰仓库文件）；
 *   3. **不漂移**：`BUILTIN_TIMETABLES` / `readSystemsConfig()` 与快照 `sources` 清单对齐；
 *   4. **同步脚本可用**：`tools/presets/sync-snapshot.mjs` 能正确写入，快照被篡改或缺目录时
 *      非 0 退出、一个文件都不写。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * 本文件刚加载时（= 测试运行前）两个文件的原文。
 * 既是下面只读断言的基准，也是「万一上次跑崩在中途留下假数据」时的自我修复依据。
 */
const ORIGINAL_SNAPSHOT_TEXT = readText(SNAPSHOT_TARGET);
const ORIGINAL_VERSION_TEXT = readText(VERSION_TARGET);
const ORIGINAL_DIGEST = builtinPresetSourcesDigest();
/** 内置快照是否还是预设仓库 1.0.0 的原文（为假说明工作区被假数据污染了，见 before 钩子）。 */
const SNAPSHOT_IS_REAL = /"version": "1\.0\.0"/.test(ORIGINAL_SNAPSHOT_TEXT);

before(() => {
  // 上次若跑崩在中途，这里先把两个文件恢复成加载时读到的原文，保证本次顺序与断言都可预期
  if (readText(SNAPSHOT_TARGET) !== ORIGINAL_SNAPSHOT_TEXT) {
    writeFileSync(SNAPSHOT_TARGET, ORIGINAL_SNAPSHOT_TEXT, 'utf8');
  }
  if (readText(VERSION_TARGET) !== ORIGINAL_VERSION_TEXT) {
    writeFileSync(VERSION_TARGET, ORIGINAL_VERSION_TEXT, 'utf8');
  }
});

after(() => {
  // 收尾兜底：写入类用例即使断言失败也已经各自还原过，这里再确认一次
  assert.equal(readText(SNAPSHOT_TARGET), ORIGINAL_SNAPSHOT_TEXT, '测试结束时内置快照应回到原文');
  assert.equal(readText(VERSION_TARGET), ORIGINAL_VERSION_TEXT, '测试结束时 preset-version.json 应回到原文');
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
        // 上面那条会写真文件的用例把内置快照改成了假数据，这里退一步只比 id 集合
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

// —— 会写文件的两个用例放最后 ——
//
// 它们（及其 finally 还原）必须晚于上面所有只读断言执行：node:test 的同文件用例按注册顺序串行跑。
// 为避免「上一次跑崩在中途、留下 9.9.9 的假快照」污染本次运行，before 钩子先把这两个文件
// 恢复成本文件加载时读到的原文，再让写入类用例各自保存/还原。

test('同步脚本：伪造预设仓库 → 正确写入主仓库文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'dawn-tick-presets-'));
  const before = readText(SNAPSHOT_TARGET);
  const beforeVersion = readText(VERSION_TARGET);
  try {
    // 伪造一份「内容与内置相同、但格式/版本/时间戳都不同」的仓库，
    // 这样能同时验证「写入的是快照原文」而不是脚本自己重排的 JSON。
    const fake: Omit<PresetSnapshot, 'hash'> = {
      version: '9.9.9',
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
    writeFileSync(join(root, 'snapshot', `presets-${fake.version}.json`), snapshotText, 'utf8');
    writeFileSync(
      join(root, 'version.json'),
      `${JSON.stringify({ version: fake.version, schemaVersion: fake.schemaVersion, channel: 'stable' }, null, 2)}\n`,
      'utf8',
    );

    const stdout = execFileSync(process.execPath, [SYNC_SCRIPT, '--from', root], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, SOURCE_DATE_EPOCH: '0' },
    });
    assert.match(stdout, /=== 预设快照同步 ===/);
    assert.match(stdout, /版本：9\.9\.9（schemaVersion 1）/);
    assert.match(stdout, /内容哈希：sha256:[0-9a-f]{64}（已复算一致）/);
    assert.match(stdout, /已写入：packages\/core\/src\/config\/builtin-preset-snapshot\.json/);
    assert.match(stdout, /已写入：packages\/core\/src\/config\/preset-version\.json/);

    const writtenSnapshot = readText(SNAPSHOT_TARGET);
    assert.equal(writtenSnapshot, snapshotText, '内置快照必须是预设仓库快照的原文（逐字节）');
    assert.deepEqual(JSON.parse(writtenSnapshot), snapshot);
    assert.deepEqual(JSON.parse(readText(VERSION_TARGET)), { version: '9.9.9', schemaVersion: 1 });
    assert.notEqual(writtenSnapshot, before, '写入应当真的改变了文件内容');

    // 幂等：再跑一次不再写文件，并明确报告「未改动」
    const secondRun = execFileSync(process.execPath, [SYNC_SCRIPT, '--from', root], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, SOURCE_DATE_EPOCH: '0' },
    });
    assert.match(secondRun, /未改动任何文件（幂等）/);
    assert.equal(readText(SNAPSHOT_TARGET), snapshotText);
    assert.equal(readText(VERSION_TARGET), `${JSON.stringify({ version: '9.9.9', schemaVersion: 1 }, null, 2)}\n`);
  } finally {
    // 还原：脚本写过的两个文件都回到测试前的样子
    rmSync(root, { recursive: true, force: true });
    writeFileSync(SNAPSHOT_TARGET, before, 'utf8');
    writeFileSync(VERSION_TARGET, beforeVersion, 'utf8');
    assert.equal(readText(SNAPSHOT_TARGET), before);
    assert.equal(readText(VERSION_TARGET), beforeVersion);
    assert.equal(verifyBuiltinPresetSnapshot().ok, true, '还原后内置快照应重新自洽');
  }
});

test('同步脚本：哈希不符的假快照 → 非 0 退出且不写任何文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'dawn-tick-presets-bad-'));
  const before = readText(SNAPSHOT_TARGET);
  const beforeVersion = readText(VERSION_TARGET);
  try {
    const good = sign({
      version: '9.9.9',
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
      },
    });
    // 只改 hash 的最后一位：结构完全合法，只有内容哈希对不上
    const broken = { ...good, hash: `${good.hash.slice(0, -1)}${good.hash.endsWith('0') ? '1' : '0'}` };
    assert.notEqual(broken.hash, good.hash);
    mkdirSync(join(root, 'snapshot'), { recursive: true });
    writeFileSync(join(root, 'snapshot', 'presets-9.9.9.json'), `${JSON.stringify(broken, null, 2)}\n`, 'utf8');
    writeFileSync(
      join(root, 'version.json'),
      `${JSON.stringify({ version: '9.9.9', schemaVersion: 1 }, null, 2)}\n`,
      'utf8',
    );

    const failure = runExpectingFailure([SYNC_SCRIPT, '--from', root]);
    assert.notEqual(failure.status, 0, '哈希不符必须非 0 退出');
    assert.match(failure.stderr, /快照哈希校验未通过/);
    assert.match(failure.stderr, /未写入任何文件/);

    assert.equal(readText(SNAPSHOT_TARGET), before, '失败时不得改动内置快照');
    assert.equal(readText(VERSION_TARGET), beforeVersion, '失败时不得改动 preset-version.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('同步脚本：预设仓库目录不存在 → 非 0 退出且不写任何文件', () => {
  const before = readText(SNAPSHOT_TARGET);
  const beforeVersion = readText(VERSION_TARGET);
  const missing = join(tmpdir(), 'dawn-tick-presets-不存在-9f3c1a');
  assert.equal(existsSync(missing), false);
  const failure = runExpectingFailure([SYNC_SCRIPT, '--from', missing]);
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /预设仓库目录不存在/);
  assert.match(failure.stderr, /未写入任何文件/);
  assert.equal(readText(SNAPSHOT_TARGET), before);
  assert.equal(readText(VERSION_TARGET), beforeVersion);
});

/** 跑一个预期失败的同步脚本，返回状态码与 stderr（不抛异常）。 */
function runExpectingFailure(args: string[]): { status: number; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, args, {
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
