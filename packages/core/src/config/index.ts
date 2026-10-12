/**
 * 作息表与教务系统配置的加载器。
 *
 * 事实来源（唯一需要人工编辑、可以直接分享给别人的文件）是同一目录下的
 * `timetables.json`、`systems.json` 与 `preset-version.json`。
 * 这些 JSON 在打包期直接被 import 进来（tsconfig 打开了 `resolveJsonModule`），
 * 因此不再需要手写的 TS 等价副本，也就不存在「两份常量漂移」的问题。
 *
 * 为什么要用 import 而不是运行时读文件：Web 端在浏览器里运行、不能读本地文件，
 * 打包期内联的 JSON 是三端唯一可用的同一份数据。
 *
 * 加载即校验：模块被引入时就会跑一遍 validateTimetables / validateSystems，
 * 数据不合法会立刻抛出可读错误（而不是等到用户点了导入才炸）。
 */
import timetablesJson from './timetables.json' with { type: 'json' };
import systemsJson from './systems.json' with { type: 'json' };
import presetVersionJson from './preset-version.json' with { type: 'json' };
import { formatClock, parseClock, sectionOf } from '../timetable.ts';
import type { PeriodSection } from '../types.ts';

/** 一节作息时间；start / end 都是 24 小时制的 `HH:MM`。 */
export interface TimetablePeriod {
  periodNo: number;
  start: string;
  end: string;
}

/** 一张内置作息表。 */
export interface TimetablePreset {
  id: string;
  name: string;
  /** 数据来源说明，便于别人核对与更换 */
  source?: string;
  periods: TimetablePeriod[];
}

/** 没有指定学校时使用的作息表 id。 */
export const DEFAULT_TIMETABLE_ID = 'default';

/**
 * 已知教务系统的 id。
 * 新增系统时需要同时改动这里、`systems.json`，以及 `SchoolSystem` 的语义
 * （`SchoolSystem` 就是本类型的别名，见 import/school-list.ts）。
 */
export const SCHOOL_SYSTEM_IDS = ['jwglxt', 'qzdatasource', 'urp', 'other'] as const;

export type SchoolSystemId = (typeof SCHOOL_SYSTEM_IDS)[number];

/** 一个教务系统的页面特征；用来把 page-tables.ts 里的识别规则外置成配置。 */
export interface SystemDetectConfig {
  /** 页面里出现任一标记即判定为该教务系统。按正则源码书写，纯文本可以直接写。 */
  markers: string[];
  /** 课表表格 id 里出现的特征词（命中即加分） */
  timetableTableIds: string[];
  /** 课表表格 class 里出现的特征词（命中即加分） */
  timetableTableClasses: string[];
  /** 「日-节」网格单元格 id 的正则片段，例如正方的 id="1-2" */
  gridCellIdPatterns: string[];
}

/** 一个教务系统的配置。 */
export interface SystemConfig {
  id: SchoolSystemId;
  name: string;
  /** 登录入口路径，拼接在学校域名之后 */
  entryPath: string;
  hint: string;
  detect: SystemDetectConfig;
}

/**
 * 打包期内联的作息表数据（`timetables.json`）。
 * 这里只做类型收敛，字段级校验交给 validateTimetables。
 */
const TIMETABLES_DATA: unknown = timetablesJson;

/** 打包期内联的教务系统数据（`systems.json`）。 */
const SYSTEMS_DATA: unknown = systemsJson;

/** 严格的 24 小时制 `HH:MM`。 */
const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} 应为对象`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${where} 应为非空字符串`);
  }
  return value.trim();
}

function requireClock(value: unknown, where: string): string {
  const text = requireText(value, where);
  if (!CLOCK_PATTERN.test(text)) throw new Error(`${where} 应为 HH:MM 格式的 24 小时制时间：${text}`);
  return text;
}

function requireTextArray(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${where} 应为字符串数组`);
  return value.map((item, index) => requireText(item, `${where}[${index}]`));
}

function requireRegex(source: string, where: string): void {
  try {
    new RegExp(source, 'i');
  } catch {
    throw new Error(`${where} 不是合法的正则表达式：${source}`);
  }
}

/**
 * 校验并规整作息表数据（`timetables.json` 的解析结果）。
 * 不合法时抛出可读错误：
 * - 顶层不是非空数组；
 * - 作息表 id 重复；
 * - periodNo 不是正整数、没有严格递增（即重复或乱序）；
 * - 时间不是合法 `HH:MM`；
 * - 同一节的 end 不晚于 start。
 */
export function validateTimetables(input: unknown): TimetablePreset[] {
  if (!Array.isArray(input)) throw new Error('作息表配置应为数组');
  if (input.length === 0) throw new Error('作息表配置不能为空');

  const seenIds = new Set<string>();
  const presets: TimetablePreset[] = [];

  for (const [index, raw] of input.entries()) {
    const where = `作息表 #${index + 1}`;
    const record = asRecord(raw, where);
    const id = requireText(record['id'], `${where} 的 id`);
    if (seenIds.has(id)) throw new Error(`作息表 id 重复：${id}`);
    seenIds.add(id);

    const name = requireText(record['name'], `作息表 ${id} 的 name`);
    const periodsRaw = record['periods'];
    if (!Array.isArray(periodsRaw) || periodsRaw.length === 0) {
      throw new Error(`作息表 ${id} 的 periods 应为非空数组`);
    }

    const periods: TimetablePeriod[] = [];
    let previousPeriodNo = 0;
    for (const [periodIndex, periodRaw] of periodsRaw.entries()) {
      const periodWhere = `作息表 ${id} 第 ${periodIndex + 1} 条`;
      const period = asRecord(periodRaw, periodWhere);
      const periodNo = period['periodNo'];
      if (typeof periodNo !== 'number' || !Number.isInteger(periodNo) || periodNo < 1) {
        throw new Error(`作息表 ${id} 的 periodNo 应为正整数：${String(periodNo)}`);
      }
      if (periodNo <= previousPeriodNo) {
        throw new Error(`作息表 ${id} 的 periodNo 应严格递增且不重复：第 ${periodNo} 节`);
      }
      previousPeriodNo = periodNo;

      const start = requireClock(period['start'], `作息表 ${id} 第 ${periodNo} 节的 start`);
      const end = requireClock(period['end'], `作息表 ${id} 第 ${periodNo} 节的 end`);
      if (parseClock(end) <= parseClock(start)) {
        throw new Error(`作息表 ${id} 第 ${periodNo} 节的 end 应晚于 start：${start}-${end}`);
      }
      periods.push({ periodNo, start, end });
    }

    const source = record['source'];
    if (source !== undefined && (typeof source !== 'string' || source.trim().length === 0)) {
      throw new Error(`作息表 ${id} 的 source 应为非空字符串`);
    }
    presets.push(
      source === undefined
        ? { id, name, periods }
        : { id, name, source: (source as string).trim(), periods },
    );
  }

  return presets;
}

/**
 * 校验并规整教务系统配置（`systems.json` 的解析结果）。
 * 不合法时抛出可读错误：顶层不是非空数组、id 不在已知系统列表里、id 重复、
 * 必填文本为空、入口路径不是以 `/` 开头、特征字段不是字符串数组、
 * 或标记不是合法正则。
 */
export function validateSystems(input: unknown): SystemConfig[] {
  if (!Array.isArray(input)) throw new Error('教务系统配置应为数组');
  if (input.length === 0) throw new Error('教务系统配置不能为空');

  const known = new Set<string>(SCHOOL_SYSTEM_IDS);
  const seenIds = new Set<string>();
  const systems: SystemConfig[] = [];

  for (const [index, raw] of input.entries()) {
    const where = `教务系统 #${index + 1}`;
    const record = asRecord(raw, where);
    const id = requireText(record['id'], `${where} 的 id`);
    if (!known.has(id)) {
      throw new Error(`未知的教务系统 id：${id}（可选：${SCHOOL_SYSTEM_IDS.join('、')}）`);
    }
    if (seenIds.has(id)) throw new Error(`教务系统 id 重复：${id}`);
    seenIds.add(id);

    const name = requireText(record['name'], `教务系统 ${id} 的 name`);
    const entryPath = requireText(record['entryPath'], `教务系统 ${id} 的 entryPath`);
    if (!entryPath.startsWith('/')) throw new Error(`教务系统 ${id} 的 entryPath 应以 / 开头：${entryPath}`);
    const hint = requireText(record['hint'], `教务系统 ${id} 的 hint`);

    const detectRaw = record['detect'];
    const detectRecord = detectRaw === undefined ? {} : asRecord(detectRaw, `教务系统 ${id} 的 detect`);
    const markers = requireTextArray(detectRecord['markers'], `教务系统 ${id} 的 detect.markers`);
    markers.forEach((marker, markerIndex) =>
      requireRegex(marker, `教务系统 ${id} 的 detect.markers[${markerIndex}]`),
    );

    systems.push({
      id: id as SchoolSystemId,
      name,
      entryPath,
      hint,
      detect: {
        markers,
        timetableTableIds: requireTextArray(
          detectRecord['timetableTableIds'],
          `教务系统 ${id} 的 detect.timetableTableIds`,
        ),
        timetableTableClasses: requireTextArray(
          detectRecord['timetableTableClasses'],
          `教务系统 ${id} 的 detect.timetableTableClasses`,
        ),
        gridCellIdPatterns: requireTextArray(
          detectRecord['gridCellIdPatterns'],
          `教务系统 ${id} 的 detect.gridCellIdPatterns`,
        ),
      },
    });
  }

  return systems;
}

/** 读取并校验 `preset-version.json`。 */
function readPresetVersion(input: unknown): string {
  const record = asRecord(input, 'preset-version.json');
  return requireText(record['version'], 'preset-version.json 的 version');
}

/**
 * 内置预设的版本号（`preset-version.json`）。
 *
 * 它与独立预设仓库 `dawn-tick-presets` 的 `version.json` 保持同一个版本线：
 * 内置的 `timetables.json` / `systems.json` 就是该版本快照的离线兜底副本。
 * 运行时的「检查预设更新」以本值为基线，只会接受更高版本。
 */
export const BUILTIN_PRESET_VERSION: string = readPresetVersion(presetVersionJson);

/** 内置作息表：模块加载时即完成校验，数据有问题会直接抛错。 */
export const BUILTIN_TIMETABLES: readonly TimetablePreset[] = validateTimetables(TIMETABLES_DATA);

const SYSTEMS_CONFIG: readonly SystemConfig[] = validateSystems(SYSTEMS_DATA);

/** 按 id 查内置作息表；找不到返回 undefined。id 忽略大小写与首尾空白。 */
export function findTimetable(id: string): TimetablePreset | undefined {
  const wanted = id.trim().toLowerCase();
  return BUILTIN_TIMETABLES.find((preset) => preset.id.toLowerCase() === wanted);
}

/** 读取校验后的教务系统配置（顺序即识别优先级）。 */
export function readSystemsConfig(): readonly SystemConfig[] {
  return SYSTEMS_CONFIG;
}

/** 把一张作息表摊平成课次（periodNo / startTime / endTime / section），可直接灌进 time_slots。 */
export function presetToTimeSlots(
  preset: TimetablePreset,
): Array<{ periodNo: number; startTime: string; endTime: string; section: PeriodSection }> {
  return preset.periods.map((period) => {
    // 用 parseClock 过一遍，保证产出的时间与库里的 time_slots 口径一致
    const start = formatClock(parseClock(period.start));
    return {
      periodNo: period.periodNo,
      startTime: start,
      endTime: formatClock(parseClock(period.end)),
      section: sectionOf(start),
    };
  });
}
