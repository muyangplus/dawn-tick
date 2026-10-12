/**
 * 「导入识别」必须用**有效配置**，而不是模块加载时冻结的常量。
 *
 * 背景：`setPresetOverride()` 是应用启动时把「本地缓存的教务配置」注进 config 层的，
 * 而页面识别（`page-tables.ts`）与入口模板（`school-list.ts`）如果在自己模块加载时
 * 就把 `readSystemsConfig()` 的结果算成常量，覆盖层就永远影响不到识别与入口——
 * 缓存预设里改过的 markers / entryPath 会「注入了但不生效」。
 *
 * 本文件守两件事：
 *   1. **无覆盖时逐条等于内置**：识别结果、入口路径、`SYSTEM_ENTRIES` 视图与
 *      直接读 `systems.json` 的独立基准完全一致（既有行为不变）；
 *   2. **有覆盖时立刻跟着换**：markers / entryPath / gridCellIdPatterns 都走有效配置，
 *      `setPresetOverride(null)` 能回到内置，非法覆盖被整体忽略且不抛错。
 *
 * 覆盖层是模块级状态，每个用例前后都清一次（node:test 每个测试文件独立进程，不会串到别的文件）。
 */
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  type SystemConfig,
  setPresetOverride,
  validateSystems,
} from '../src/config/index.ts';
import { detectSystem, looksLikeTimetablePage } from '../src/import/page-tables.ts';
import {
  SYSTEM_ENTRIES,
  buildEntryUrl,
  entryUrlFor,
  systemEntry,
} from '../src/import/school-list.ts';

/**
 * 内置教务系统的独立基准（直接读 JSON 原文）。
 * `readSystemsConfig()` 返回的是**有效**配置，用它当基准会变成自己比自己。
 */
const BUILTIN_SYSTEMS: readonly SystemConfig[] = validateSystems(
  JSON.parse(readFileSync(new URL('../src/config/systems.json', import.meta.url), 'utf8')) as unknown,
);

const BUILTIN_JWGLXT = BUILTIN_SYSTEMS.find((system) => system.id === 'jwglxt');
assert.ok(BUILTIN_JWGLXT !== undefined, '内置 systems.json 必须含 jwglxt');

/** 含 jwglxt 特征的页面：`timetable_con` 与 `jwglxt` 都是内置 markers。 */
const JWGLXT_PAGE =
  '<!doctype html><html><body><script src="/jwglxt/js/index.js"></script>' +
  '<table id="kbtable"><tr><td id="1-1"><div class="timetable_con">高等数学</div></td></tr></table>' +
  '</body></html>';

/** 只带内置「日-节」网格特征之外的自定义 id：用来验证网格特征也走有效配置。 */
const CUSTOM_GRID_PAGE = '<html><body><table><tr><td id="cached-7">x</td></tr></table></body></html>';

/** 一份合法的覆盖教务系统：换掉 id 之外的一切（标记、入口、表格特征、网格特征）。 */
const OVERRIDE_SYSTEMS: readonly SystemConfig[] = [
  {
    id: 'jwglxt',
    name: '正方教务（缓存）',
    entryPath: '/cached/login',
    hint: '缓存正文',
    detect: {
      markers: ['zhengfang-cache-marker'],
      timetableTableIds: ['cached-kbtable'],
      timetableTableClasses: ['cached-kb'],
      gridCellIdPatterns: ['cached-\\d+'],
    },
  },
];

beforeEach(() => {
  setPresetOverride(null);
});

afterEach(() => {
  setPresetOverride(null);
});

test('无覆盖：识别用内置，含 jwglxt 特征的页面仍判定为 jwglxt', () => {
  assert.equal(detectSystem(JWGLXT_PAGE).id, 'jwglxt');
  assert.equal(detectSystem(JWGLXT_PAGE).label, BUILTIN_JWGLXT.name);
  assert.equal(detectSystem('<html><script src="/qzdatasource.js"></script></html>').id, 'qzdatasource');
  assert.equal(detectSystem('<html><title>教学信息服务平台</title></html>').id, 'urp');
  assert.equal(detectSystem('<html><body>没有任何教务特征</body></html>').id, 'unknown');
  assert.equal(detectSystem(JWGLXT_PAGE).label, '正方教务');
});

test('无覆盖：入口模板逐条等于内置 systems.json（SYSTEM_ENTRIES 视图也对得上）', () => {
  const builtinPath = BUILTIN_JWGLXT.entryPath;
  assert.equal(systemEntry('jwglxt').loginPath, builtinPath);
  assert.equal(systemEntry('jwglxt').label, BUILTIN_JWGLXT.name);
  assert.equal(buildEntryUrl('jwglxt', 'jw.example.edu.cn'), `https://jw.example.edu.cn${builtinPath}`);
  assert.equal(entryUrlFor('jwglxt', 'jw.example.edu.cn'), `https://jw.example.edu.cn${builtinPath}`);
  assert.deepEqual(
    SYSTEM_ENTRIES.map((entry) => ({
      id: entry.id,
      label: entry.label,
      loginPath: entry.loginPath,
      hint: entry.hint,
    })),
    BUILTIN_SYSTEMS.map((system) => ({
      id: system.id,
      label: system.name,
      loginPath: system.entryPath,
      hint: system.hint,
    })),
    'SYSTEM_ENTRIES 应与内置 systems.json 逐条一致',
  );
  assert.equal([...SYSTEM_ENTRIES].length, BUILTIN_SYSTEMS.length, '惰性视图要能被展开遍历');
});

test('覆盖改 detect.markers：新特征能识别、旧特征不再识别', () => {
  const applied = setPresetOverride({ systems: OVERRIDE_SYSTEMS, version: '2.0.0' });
  assert.equal(applied.applied, true, `覆盖应生效，实际原因：${applied.reason ?? '（无）'}`);

  // 旧特征确实还在页面里（markers 之外的 timetable_con / jwglxt 都在），但覆盖后不该再命中
  assert.match(JWGLXT_PAGE, /timetable_con/);
  assert.match(JWGLXT_PAGE, /jwglxt/);
  assert.equal(detectSystem(JWGLXT_PAGE).id, 'unknown', '旧特征在覆盖后不应再被识别');

  const cached = detectSystem('<html><body>zhengfang-cache-marker</body></html>');
  assert.equal(cached.id, 'jwglxt', '覆盖里的新特征应能识别');
  assert.equal(cached.label, '正方教务（缓存）');
});

test('覆盖改 entryPath：systemEntry / entryUrlFor / buildEntryUrl / SYSTEM_ENTRIES 都反映新入口', () => {
  setPresetOverride({ systems: OVERRIDE_SYSTEMS, version: '2.0.0' });

  assert.equal(systemEntry('jwglxt').loginPath, '/cached/login');
  assert.equal(buildEntryUrl('jwglxt', 'jw.example.edu.cn'), 'https://jw.example.edu.cn/cached/login');
  assert.equal(entryUrlFor('jwglxt', 'jw.example.edu.cn'), 'https://jw.example.edu.cn/cached/login');
  assert.equal(buildEntryUrl('jwglxt', 'jw.example.edu.cn', false), 'https://jw.example.edu.cn');
  assert.equal(
    entryUrlFor('jwglxt', 'https://x.edu.cn/portal/index.html'),
    'https://x.edu.cn/portal/index.html',
    '已带具体路径的地址仍按原样使用',
  );
  assert.deepEqual(SYSTEM_ENTRIES.map((entry) => entry.loginPath), ['/cached/login']);
  assert.equal(SYSTEM_ENTRIES.length, 1);

  // 覆盖只换「生效值」，内置基准一个字段都没被污染
  assert.equal(BUILTIN_JWGLXT.entryPath, '/jwglxt/xtgl/login_slogin.html');
});

test('覆盖改 detect.gridCellIdPatterns：网格页判定也跟着有效配置走', () => {
  assert.equal(looksLikeTimetablePage(CUSTOM_GRID_PAGE), false, '内置特征不该命中 cached-7');
  setPresetOverride({ systems: OVERRIDE_SYSTEMS });
  assert.equal(looksLikeTimetablePage(CUSTOM_GRID_PAGE), true, '覆盖后的网格特征应命中');
  setPresetOverride(null);
  assert.equal(looksLikeTimetablePage(CUSTOM_GRID_PAGE), false);
});

test('setPresetOverride(null)：识别与入口回到内置行为', () => {
  setPresetOverride({ systems: OVERRIDE_SYSTEMS, version: '2.0.0' });
  assert.equal(detectSystem(JWGLXT_PAGE).id, 'unknown');
  assert.equal(systemEntry('jwglxt').loginPath, '/cached/login');

  const cleared = setPresetOverride(null);
  assert.equal(cleared.applied, true);
  assert.equal(detectSystem(JWGLXT_PAGE).id, 'jwglxt');
  assert.equal(systemEntry('jwglxt').loginPath, BUILTIN_JWGLXT.entryPath);
  assert.equal(
    entryUrlFor('jwglxt', 'jw.example.edu.cn'),
    `https://jw.example.edu.cn${BUILTIN_JWGLXT.entryPath}`,
  );
  assert.deepEqual(
    SYSTEM_ENTRIES.map((entry) => entry.id),
    BUILTIN_SYSTEMS.map((system) => system.id),
  );
});

test('非法覆盖（缺字段 / 入口不以 / 开头 / 正则非法 / 非数组 / 空数组）被忽略：识别仍用内置且不抛错', () => {
  const cases: unknown[] = [
    [{ id: 'jwglxt' }],
    [{ ...OVERRIDE_SYSTEMS[0], entryPath: 'jwglxt/login' }],
    [{ ...OVERRIDE_SYSTEMS[0], detect: { markers: ['['] } }],
    [{ ...OVERRIDE_SYSTEMS[0], detect: { markers: ['ok', ''] } }],
    '不是数组',
    [],
  ];

  for (const systems of cases) {
    const result = setPresetOverride({ systems });
    assert.equal(result.applied, false, `应被整体忽略：${JSON.stringify(systems)}`);
    assert.equal(typeof result.reason, 'string', '忽略原因应可读');

    // 不抛错，且识别/入口仍按内置走
    assert.equal(detectSystem(JWGLXT_PAGE).id, 'jwglxt');
    assert.equal(detectSystem('<html><body>zhengfang-cache-marker</body></html>').id, 'unknown');
    assert.equal(systemEntry('jwglxt').loginPath, BUILTIN_JWGLXT.entryPath);
    assert.equal(SYSTEM_ENTRIES.length, BUILTIN_SYSTEMS.length);
  }
});

test('覆盖只换 systems 维度：换回来仍是同一套内置特征（缓存按引用失效，不会串味）', () => {
  const firstBuiltin = detectSystem(JWGLXT_PAGE);
  setPresetOverride({ systems: OVERRIDE_SYSTEMS });
  assert.equal(detectSystem(JWGLXT_PAGE).id, 'unknown');
  setPresetOverride(null);
  assert.deepEqual(detectSystem(JWGLXT_PAGE), firstBuiltin, '回到内置后识别结果应与一开始逐字段相同');
  // 再套一次同样的覆盖，重编出来的特征仍能命中新标记
  setPresetOverride({ systems: OVERRIDE_SYSTEMS });
  assert.equal(detectSystem('<html>zhengfang-cache-marker</html>').id, 'jwglxt');
});
