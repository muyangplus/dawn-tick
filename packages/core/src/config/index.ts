/**
 * 作息表与教务系统配置的加载器。
 *
 * 事实来源（唯一需要人工编辑、可以直接分享给别人的文件）是同一目录下的
 * `timetables.json`、`systems.json`、`preset-version.json` 与
 * `builtin-preset-snapshot.json`（后两者由同步脚本生成，不要手改）。
 * 这些 JSON 在打包期直接被 import 进来（tsconfig 打开了 `resolveJsonModule`），
 * 不再需要手写的 TS 等价副本，「两份常量漂移」的问题随之消失。
 *
 * 用 import 而不是运行时读文件：Web 端在浏览器里运行、不能读本地文件，
 * 打包期内联的 JSON 是三端唯一可用的同一份数据。
 *
 * 加载即校验：模块被引入时就会跑一遍 validateTimetables / validateSystems，
 * 数据不合法会立刻抛出可读错误（而不是等到用户点了导入才炸）。
 *
 * 内置快照的来源与同步方式见 `tools/presets/README.md`：
 * 它是预设仓库 `dawn-tick-presets` 产出的原文副本（含 hash），
 * 改完预设仓库必须跑 `node tools/presets/sync-snapshot.mjs --from <预设仓库>` 重新同步。
 */
export { canonicalPresetJson, sha256HexSync } from './preset-hash.ts';
export {
  DEFAULT_TIMETABLE_ID,
  SCHOOL_SYSTEM_IDS,
  validateSystems,
  validateTimetables,
  type SchoolSystemId,
  type SystemConfig,
  type SystemDetectConfig,
  type TimetablePeriod,
  type TimetablePreset,
} from './validate.ts';
export {
  BUILTIN_PRESET_SCHEMA_VERSION,
  BUILTIN_PRESET_VERSION,
  BUILTIN_TIMETABLES,
} from './builtin.ts';
export * from './snapshot.ts';

import { formatClock, parseClock, sectionOf } from '../timetable.ts';
import type { PeriodSection } from '../types.ts';
import { BUILTIN_PRESET_VERSION, BUILTIN_SYSTEMS, BUILTIN_TIMETABLES } from './builtin.ts';
import { validateSystems, validateTimetables, type SystemConfig, type TimetablePreset } from './validate.ts';

// —— 可注入的预设覆盖层 ——
//
// 语义一句话：**启动时套用缓存、运行时绝不热替换**。
//
// 应用启动时（`apps/web/src/App.tsx` 的初始化）会把「本地缓存且版本高于内置」的预设
// 通过 `setPresetOverride()` 注进这一层；此后进程内所有读取（`findTimetable`、
// `readSystemsConfig`、`effectiveTimetables`/`effectiveSystems`/`effectivePresetVersion`）
// 都返回**有效预设**（有覆盖就是覆盖，没有就是内置）。
//
// 运行时不做热替换：用户正在用的一套作息/教务配置不在半路更换——
// 设置页里下载成功只提示「下次启动生效」正是这个约定。
//
// 安全边界：覆盖内容必须**先过 `validateTimetables` / `validateSystems`**。
// 只有全部合法才整体生效，任何一条不合法都整体忽略并继续用内置，
// 且**不向上抛错**（缓存是外部数据，坏缓存只能让功能退回内置，不能让应用起不来）。

/** 一次覆盖注入的入参；三项都可选，全部省略等价于「清空覆盖」。 */
export interface PresetOverrideInput {
  /** 作息表正文，形状与 `timetables.json` 相同；不合法则整体忽略 */
  timetables?: unknown;
  /** 教务系统正文，形状与 `systems.json` 相同；不合法则整体忽略 */
  systems?: unknown;
  /** 这份覆盖的版本号（缓存快照的 version）；缺失时沿用内置版本号 */
  version?: string;
}

/** 覆盖注入的结果：`applied` 为假表示输入不合法、已按约定忽略并保持内置。 */
export interface PresetOverrideResult {
  applied: boolean;
  /** 忽略原因（仅用于日志与测试断言，界面不该展示） */
  reason?: string;
  /** 本次生效的版本号 */
  version: string;
}

/** 校验通过的覆盖内容；`undefined` 表示没有覆盖（等价于内置）。 */
interface NormalizedPresetOverride {
  timetables: readonly TimetablePreset[];
  systems: readonly SystemConfig[];
  version: string;
}

let presetOverride: NormalizedPresetOverride | undefined;

/** 把值收敛成非空字符串；空白串与其它类型都返回 undefined。 */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() === '' ? undefined : value.trim();
}

/**
 * 注入（或清空）预设覆盖。
 *
 * - 传 `null` / `undefined`：清空覆盖，恢复到内置预设；
 * - `timetables` / `systems` 省略：该维度保持内置，另一维度仍可单独覆盖；
 * - 任一维度存在但不合法：**什么都不改**（既不清空已生效的覆盖，也不破坏内置），
 *   返回 `{ applied: false, reason }`。
 *
 * 本函数不抛错；调用方只记日志即可。
 */
export function setPresetOverride(input: PresetOverrideInput | null | undefined): PresetOverrideResult {
  if (input === null || input === undefined) {
    presetOverride = undefined;
    return { applied: true, version: BUILTIN_PRESET_VERSION };
  }

  const next: NormalizedPresetOverride = {
    timetables: presetOverride?.timetables ?? BUILTIN_TIMETABLES,
    systems: presetOverride?.systems ?? BUILTIN_SYSTEMS,
    version: optionalText(input.version) ?? presetOverride?.version ?? BUILTIN_PRESET_VERSION,
  };

  try {
    if (input.timetables !== undefined) next.timetables = validateTimetables(input.timetables);
    if (input.systems !== undefined) next.systems = validateSystems(input.systems);
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { applied: false, reason: message, version: effectivePresetVersion() };
  }

  presetOverride = next;
  return { applied: true, version: next.version };
}

/** 当前有效作息表：有覆盖用覆盖，否则等价于 `BUILTIN_TIMETABLES`。 */
export function effectiveTimetables(): readonly TimetablePreset[] {
  return presetOverride?.timetables ?? BUILTIN_TIMETABLES;
}

/** 当前有效教务系统配置（顺序即识别优先级）：有覆盖用覆盖，否则等价于 `readSystemsConfig()` 的内置值。 */
export function effectiveSystems(): readonly SystemConfig[] {
  return presetOverride?.systems ?? BUILTIN_SYSTEMS;
}

/** 当前有效预设版本号：有覆盖用覆盖的版本，否则为 `BUILTIN_PRESET_VERSION`。 */
export function effectivePresetVersion(): string {
  return presetOverride?.version ?? BUILTIN_PRESET_VERSION;
}

/** 按 id 查**有效**作息表（覆盖层优先）；找不到返回 undefined。id 忽略大小写与首尾空白。 */
export function findTimetable(id: string): TimetablePreset | undefined {
  const wanted = id.trim().toLowerCase();
  return effectiveTimetables().find((preset) => preset.id.toLowerCase() === wanted);
}

/**
 * 读取校验后的**有效**教务系统配置（顺序即识别优先级）。
 *
 * 保持既有签名与返回类型；没有覆盖时逐条等于内置 `systems.json`。
 */
export function readSystemsConfig(): readonly SystemConfig[] {
  return effectiveSystems();
}

/** 把一张作息表摊平成课次（periodNo / startTime / endTime / section），可直接灌进 time_slots。 */
export function presetToTimeSlots(
  preset: TimetablePreset,
): Array<{ periodNo: number; startTime: string; endTime: string; section: PeriodSection }> {
  return preset.periods.map((period) => {
    // 用 parseClock 过一遍，产出的时间与库里的 time_slots 口径一致
    const start = formatClock(parseClock(period.start));
    return {
      periodNo: period.periodNo,
      startTime: start,
      endTime: formatClock(parseClock(period.end)),
      section: sectionOf(start),
    };
  });
}
