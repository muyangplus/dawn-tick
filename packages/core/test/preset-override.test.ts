/**
 * 预设覆盖层（`setPresetOverride` / `effective*`）的单测。
 *
 * 这一层守的是「启动套用、运行时绝不热替换」里的前半句：
 *   - 没有覆盖时，有效预设**逐条等于内置**（既有调用方不受影响）；
 *   - 合法覆盖整体生效，`findTimetable` / `readSystemsConfig` 也跟着换；
 *   - 非法覆盖**整体忽略**：不生效、不清空已有覆盖、更不污染内置；
 *   - `setPresetOverride(null)` 恢复内置。
 *
 * 每个用例前后都清一次覆盖：这一层是模块级状态，用例之间不能互相串味。
 */
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILTIN_PRESET_VERSION,
  BUILTIN_TIMETABLES,
  effectivePresetVersion,
  effectiveSystems,
  effectiveTimetables,
  findTimetable,
  readSystemsConfig,
  setPresetOverride,
  validateSystems,
  validateTimetables,
} from '../src/config/index.ts';

/**
 * 内置教务系统的独立基准（直接读 JSON 原文）。
 * `readSystemsConfig()` 现在返回的是**有效**配置，用它当基准会变成自己比自己。
 */
const BUILTIN_SYSTEMS = validateSystems(
  JSON.parse(readFileSync(new URL('../src/config/systems.json', import.meta.url), 'utf8')) as unknown,
);

/** 一份合法的覆盖作息表：故意与内置的 `default` 同名 id、不同正文。 */
const OVERRIDE_TIMETABLES = [
  {
    id: 'default',
    name: '缓存作息（测试）',
    periods: [
      { periodNo: 1, start: '08:30', end: '09:15' },
      { periodNo: 2, start: '09:25', end: '10:10' },
    ],
  },
  {
    id: 'cached-only',
    name: '仅缓存里有',
    periods: [{ periodNo: 1, start: '07:00', end: '07:45' }],
  },
];

/** 一份合法的覆盖教务系统：只留一个系统，且 id 与内置同名。 */
const OVERRIDE_SYSTEMS = [
  {
    id: 'jwglxt',
    name: '正方教务（缓存）',
    entryPath: '/jwglxt/xtgl/login_slogin.html',
    hint: '缓存正文',
    detect: { markers: ['jwglxt'] },
  },
];

beforeEach(() => {
  setPresetOverride(null);
});

afterEach(() => {
  setPresetOverride(null);
});

test('无覆盖时：有效预设逐条等于内置，版本号取自 preset-version.json', () => {
  assert.deepEqual(effectiveTimetables(), BUILTIN_TIMETABLES, 'effectiveTimetables() 应等于内置作息表');
  assert.deepEqual(effectiveSystems(), BUILTIN_SYSTEMS, 'effectiveSystems() 应等于内置教务系统配置');
  assert.equal(effectivePresetVersion(), BUILTIN_PRESET_VERSION);
  assert.equal(BUILTIN_PRESET_VERSION, '0.1.0');

  // 既有读取函数的行为不变
  assert.equal(findTimetable('usts')?.name, '苏州科技大学');
  assert.equal(findTimetable('   USTS ')?.id, 'usts');
  assert.equal(findTimetable('不存在的学校'), undefined);
  assert.ok(readSystemsConfig().some((system) => system.id === 'jwglxt'));
});

test('合法覆盖：整体生效，findTimetable / readSystemsConfig / 版本号都跟着换', () => {
  const result = setPresetOverride({
    timetables: OVERRIDE_TIMETABLES,
    systems: OVERRIDE_SYSTEMS,
    version: '1.1.0',
  });
  assert.equal(result.applied, true);
  assert.equal(result.reason, undefined);
  assert.equal(result.version, '1.1.0');

  // 正文按校验器规整后生效（接口没写的 detect 字段被补成空数组）
  assert.deepEqual(effectiveTimetables(), validateTimetables(OVERRIDE_TIMETABLES));
  assert.deepEqual(effectiveSystems(), validateSystems(OVERRIDE_SYSTEMS));
  assert.equal(effectivePresetVersion(), '1.1.0');

  // 同名 id 被覆盖，新增 id 也能查到
  assert.equal(findTimetable('default')?.name, '缓存作息（测试）');
  assert.equal(findTimetable('CACHED-ONLY')?.name, '仅缓存里有');
  assert.equal(findTimetable('usts'), undefined, '覆盖后应看不到内置里才有的作息表');

  assert.equal(readSystemsConfig().length, 1);
  assert.equal(readSystemsConfig()[0]?.name, '正方教务（缓存）');

  // 内置常量本身不被改写
  assert.equal(BUILTIN_TIMETABLES.some((preset) => preset.id === 'usts'), true);
  assert.equal(BUILTIN_TIMETABLES.find((preset) => preset.id === 'default')?.name, '通用作息');
});

test('非法作息表覆盖：整体忽略、不生效，内置一个字段都没被污染', () => {
  const bad = [
    { id: 'demo', name: '示例作息', periods: [{ periodNo: 1, start: '8:00', end: '08:45' }] },
  ];
  const result = setPresetOverride({ timetables: bad, systems: OVERRIDE_SYSTEMS, version: '9.9.9' });

  assert.equal(result.applied, false);
  assert.match(String(result.reason), /HH:MM/, '忽略原因应可读');
  assert.equal(result.version, BUILTIN_PRESET_VERSION);

  // 整体忽略：合法的 systems 也一并不生效
  assert.deepEqual(effectiveTimetables(), BUILTIN_TIMETABLES);
  assert.deepEqual(effectiveSystems(), BUILTIN_SYSTEMS);
  assert.equal(effectivePresetVersion(), BUILTIN_PRESET_VERSION);
  assert.equal(findTimetable('usts')?.id, 'usts', '内置作息仍可查');
});

test('非法教务系统覆盖：整体忽略（未知 id / 空数组 / 非数组都算）', () => {
  const cases: unknown[] = [
    [{ ...OVERRIDE_SYSTEMS[0], id: 'unknown-system' }],
    [],
    '不是数组',
    [{ id: 'jwglxt' }],
  ];
  for (const systems of cases) {
    const result = setPresetOverride({ systems });
    assert.equal(result.applied, false, `应被忽略：${JSON.stringify(systems)}`);
    assert.equal(result.reason !== undefined, true);
    assert.deepEqual(effectiveSystems(), BUILTIN_SYSTEMS);
  }
});

test('非法覆盖不清空已生效的合法覆盖（不合法就保持现状）', () => {
  setPresetOverride({ timetables: OVERRIDE_TIMETABLES, version: '1.1.0' });
  assert.equal(findTimetable('default')?.name, '缓存作息（测试）');

  const failed = setPresetOverride({ timetables: [{ id: 'broken' }] });
  assert.equal(failed.applied, false);
  assert.equal(findTimetable('default')?.name, '缓存作息（测试）', '失败的注入不该改变现状');
  assert.equal(effectivePresetVersion(), '1.1.0');
});

test('可以只覆盖一个维度：另一个维度继续用内置', () => {
  setPresetOverride({ timetables: OVERRIDE_TIMETABLES });
  assert.equal(findTimetable('cached-only')?.name, '仅缓存里有');
  assert.deepEqual(effectiveSystems(), BUILTIN_SYSTEMS, '没覆盖教务系统时应保持内置');
  assert.equal(effectivePresetVersion(), BUILTIN_PRESET_VERSION, '没给版本号时沿用内置版本号');
});

test('setPresetOverride(null)：清空覆盖，恢复内置', () => {
  setPresetOverride({ timetables: OVERRIDE_TIMETABLES, systems: OVERRIDE_SYSTEMS, version: '1.1.0' });
  assert.equal(effectivePresetVersion(), '1.1.0');

  const cleared = setPresetOverride(null);
  assert.equal(cleared.applied, true);
  assert.equal(cleared.version, BUILTIN_PRESET_VERSION);

  assert.deepEqual(effectiveTimetables(), BUILTIN_TIMETABLES);
  assert.deepEqual(effectiveSystems(), BUILTIN_SYSTEMS);
  assert.equal(findTimetable('default')?.name, '通用作息');
  assert.equal(findTimetable('cached-only'), undefined);

  // undefined 与 null 等价
  setPresetOverride({ timetables: OVERRIDE_TIMETABLES });
  setPresetOverride(undefined);
  assert.deepEqual(effectiveTimetables(), BUILTIN_TIMETABLES);
});

test('空对象注入：不改内容，只把版本号记下来（用于缓存版本对齐）', () => {
  const result = setPresetOverride({ version: '1.2.3' });
  assert.equal(result.applied, true);
  assert.equal(effectivePresetVersion(), '1.2.3');
  assert.deepEqual(effectiveTimetables(), BUILTIN_TIMETABLES);
  assert.deepEqual(effectiveSystems(), BUILTIN_SYSTEMS);

  // 空白版本号视为「没给」，沿用当前值
  setPresetOverride({ version: '   ' });
  assert.equal(effectivePresetVersion(), '1.2.3');
});
