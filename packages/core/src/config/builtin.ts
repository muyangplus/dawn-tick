/** 打包期内联的内置预设：加载即校验，数据不合法会立刻抛错。 */
import timetablesJson from './timetables.json' with { type: 'json' };
import systemsJson from './systems.json' with { type: 'json' };
import presetVersionJson from './preset-version.json' with { type: 'json' };
import {
  readPresetVersion,
  readSchemaVersion,
  validateSystems,
  validateTimetables,
  type SystemConfig,
  type TimetablePreset,
} from './validate.ts';

/**
 * 打包期内联的作息表数据（`timetables.json`）。
 * 这里只做类型收敛，字段级校验交给 validateTimetables。
 */
const TIMETABLES_DATA: unknown = timetablesJson;

/** 打包期内联的教务系统数据（`systems.json`）。 */
const SYSTEMS_DATA: unknown = systemsJson;

/**
 * 内置预设的版本号（`preset-version.json`）。
 *
 * 它与独立预设仓库 `dawn-tick-presets` 的 `version.json` 保持同一个版本线：
 * 内置的 `timetables.json` / `systems.json` 就是该版本快照的离线兜底副本。
 * 运行时的「检查预设更新」以本值为基线，只会接受更高版本。
 *
 * 该文件由 `tools/presets/sync-snapshot.mjs` 写出，不要手改。
 */
export const BUILTIN_PRESET_VERSION: string = readPresetVersion(presetVersionJson);

/**
 * 内置快照声明的数据格式版本（`preset-version.json` 的 `schemaVersion`）。
 *
 * 语义：`version` 是**内容版本**（预设仓库每发一版就 +1，App 以它做更新比较），
 * `schemaVersion` 是**结构版本**（快照字段形状的版本，只在字段增删改语义时 +1）。
 * 两者独立：可以只发内容（version 变、schemaVersion 不变），
 * 而结构一变，认识旧结构的 App 必须拒收而不是猜着解析。
 *
 * 快照文件缺失该字段时回退 1（1.0.0 时期的快照就是这个形状）。
 */
export const BUILTIN_PRESET_SCHEMA_VERSION: number = readSchemaVersion(presetVersionJson);

/** 内置作息表：模块加载时即完成校验，数据有问题会直接抛错。 */
export const BUILTIN_TIMETABLES: readonly TimetablePreset[] = validateTimetables(TIMETABLES_DATA);

/** 内置教务系统配置：同样在加载时校验。 */
export const BUILTIN_SYSTEMS: readonly SystemConfig[] = validateSystems(SYSTEMS_DATA);
