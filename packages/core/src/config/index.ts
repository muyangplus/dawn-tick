/**
 * 作息表与教务系统配置的加载器。
 *
 * 事实来源（唯一需要人工编辑、可以直接分享给别人的文件）是同一目录下的
 * `timetables.json`、`systems.json`、`preset-version.json` 与
 * `builtin-preset-snapshot.json`（后两者由同步脚本生成，不要手改）。
 * 这些 JSON 在打包期直接被 import 进来（tsconfig 打开了 `resolveJsonModule`），
 * 因此不再需要手写的 TS 等价副本，也就不存在「两份常量漂移」的问题。
 *
 * 为什么要用 import 而不是运行时读文件：Web 端在浏览器里运行、不能读本地文件，
 * 打包期内联的 JSON 是三端唯一可用的同一份数据。
 *
 * 加载即校验：模块被引入时就会跑一遍 validateTimetables / validateSystems，
 * 数据不合法会立刻抛出可读错误（而不是等到用户点了导入才炸）。
 *
 * 内置快照的来源与同步方式见 `tools/presets/README.md`：
 * 它是预设仓库 `dawn-tick-presets` 产出的原文副本（含 hash），
 * 改完预设仓库必须跑 `node tools/presets/sync-snapshot.mjs --from <预设仓库>` 重新同步。
 */
import timetablesJson from './timetables.json' with { type: 'json' };
import systemsJson from './systems.json' with { type: 'json' };
import presetVersionJson from './preset-version.json' with { type: 'json' };
import builtinPresetSnapshotJson from './builtin-preset-snapshot.json' with { type: 'json' };
import { formatClock, parseClock, sectionOf } from '../timetable.ts';
import type { PeriodSection } from '../types.ts';
// 具名别名导入：下面还要把同名函数转出，直接同名导入会构成「重复导出」
import { canonicalPresetJson, sha256HexSync as digestSha256 } from './preset-hash.ts';

/**
 * 哈希口径在本模块转出一次：`./preset-hash.ts` 是全仓唯一实现，
 * 而调用方（快照自检、Web 端下载校验、同步脚本、单测）通常只 import 本模块，
 * 少一条 import 路径就少一次「两份实现漂移」的机会。
 */
export { canonicalPresetJson, sha256HexSync } from './preset-hash.ts';

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
 * 读取 `preset-version.json` 的 `schemaVersion`。
 * 1.0.0 时期的 `preset-version.json` 只有 `version`，缺失时按 1 处理（当时的结构就是 1）。
 */
function readSchemaVersion(input: unknown): number {
  const record = asRecord(input, 'preset-version.json');
  const schemaVersion = record['schemaVersion'];
  if (schemaVersion === undefined) return 1;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error(`preset-version.json 的 schemaVersion 应为正整数：${String(schemaVersion)}`);
  }
  return schemaVersion;
}

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

const SYSTEMS_CONFIG: readonly SystemConfig[] = validateSystems(SYSTEMS_DATA);

// —— 内置预设快照 ——

/** 快照里的一个源文件条目：id 是源 id，sha256 是该源内容的哈希。 */
export interface PresetSnapshotSourceFile {
  id: string;
  /**
   * 相对预设仓库根目录的**历史契约路径**（见 `tools/presets/README.md`）。
   * 学校目录合并成 `schools/<校目录>/school.json` 之后，两类源的 `path` 语义不同：
   * - `sources.timetables[].path`：恒为 `presets/schools/<校目录>/timetable.json`，
   *   该文件**已不存在**；它代表合并进 school.json 的那个 `timetable` 值——
   *   `sha256` 是这个值**逐字节还原**成独立文件文本后的哈希。
   * - `sources.systems[].path`：恒为 `presets/systems/<id>/system.json`，合并后这个文件
   *   **确实存在**；但 `sha256` 覆盖的是 `scripts/lib/legacy.mjs` 把它编译成旧扁平结构后
   *   那段**文本**，与文件自身的哈希不同，所以也不能「读文件 → 复算哈希」。
   *
   * 结论：本仓库只把 `path` 当描述性字段（记录来源），**任何代码都不该按它读文件做校验**。
   * 真实路径与字段来源在快照新增的 `index` 字段里
   * （学校是 `configPath` / `timetablePath` → `school.json`，系统是 `metaPath` / `loginPath`）。
   */
  path: string;
  /** `sha256:<hex>`；作息表是内嵌 timetable 值还原出的原文，教务系统是 legacy 编译产物文本的哈希 */
  sha256: string;
}

/** 预设快照的源清单。`adapters` 是 `{ 文件名: sha256 }`，本仓库只保存不执行。 */
export interface PresetSnapshotSources {
  timetables: PresetSnapshotSourceFile[];
  systems: PresetSnapshotSourceFile[];
  adapters?: Record<string, string>;
}

/**
 * 快照内嵌索引里的一条学校（原 `presets/index.json` 的 `schools[]` 条目）。
 *
 * `configPath` 与 `timetablePath` 现在**都指向合并后的真实文件**
 * `presets/schools/<校目录>/school.json`（`configPath` 只在确实有覆盖配置时才不为 null，
 * 但路径形状一样）——`timetable.json` / `config.json` 都不再存在。
 * 这里只声明本仓库自检要用的字段，其余字段（`region` / `aliases` / `generic` …）原样保留。
 */
export interface PresetSnapshotIndexSchool {
  id: string;
  name: string;
  /** 学校配置文件（真实文件）的相对路径；没有配置时为 null */
  configPath?: string | null;
  /** 学校作息来源（真实文件）的相对路径，恒为 `presets/schools/<校目录>/school.json` */
  timetablePath?: string;
  /** 索引条目还会带 `region` / `aliases` / `generic` / `default` 等字段，本仓库原样保留不消费 */
  [key: string]: unknown;
}

/** 快照内嵌索引里的一条教务系统引用（原 `presets/index.json` 的 `systems[]` 条目）。 */
export interface PresetSnapshotIndexSystem {
  id: string;
  name: string;
  /** 系统元数据（真实文件）的相对路径，恒为 `presets/systems/<id>/system.json` */
  metaPath?: string;
  /** 登录配置（真实文件）的相对路径，同样指向 `system.json`（合并后只有一个文件） */
  loginPath?: string;
  /** 索引条目还会带 `aliases` / `hasParser` / `parserPath` / `detect` / `entryPath` 等字段 */
  [key: string]: unknown;
}

/**
 * 快照新增的顶层字段 `index`：原 `presets/index.json` 的**全部信息**
 * （学校索引 + 系统引用）。预设仓库不再单独产出 `presets/index.json`。
 *
 * 它**参与内容哈希**，所以任何一处改动都会让 `hash` 对不上；本仓库对字段级结构
 * （`_generated` / 必填字段 / id 不重复 / 路径安全）的校验在 Web 端
 * `parsePresetIndex()` 一处完成，这里只做「路径形状指向真实新文件」的自检。
 */
export interface PresetSnapshotIndex {
  _generated: true;
  version: string;
  schemaVersion: number;
  /** 索引自身的生成时间（与快照顶层的 `generatedAt` 同源） */
  generatedAt?: string;
  schools: PresetSnapshotIndexSchool[];
  systems: PresetSnapshotIndexSystem[];
}

/**
 * 预设仓库 `dawn-tick-presets` 产出的快照结构。
 * `generatedAt` 在结构里是可选的，但真实快照一定带（见 `tools/presets/README.md`）。
 */
export interface PresetSnapshot {
  version: string;
  schemaVersion: number;
  generatedAt?: string;
  sources: PresetSnapshotSources;
  /**
   * 内嵌索引（2026 结构合并后的新增字段）。旧快照没有它，此时本仓库不额外要求；
   * 但内置快照由 `tools/presets/sync-snapshot.mjs` 从预设仓库同步而来，必然带 `index`。
   */
  index?: PresetSnapshotIndex;
  /** `sha256:<hex>`，对去掉本字段后的快照对象（含 `index`）做规范化序列化再取 sha256 */
  hash: string;
}

/**
 * 内置快照：预设仓库 `presets-<version>.json` 的**原文副本**（含 hash 与生成时间）。
 *
 * 它由 `tools/presets/sync-snapshot.mjs` 从预设仓库同步而来，只读不改：
 * 需要更新时改预设仓库、重新生成快照，再跑同步脚本，而不是在这里手改。
 * 这里只做类型收敛，内容可信度由 `verifyBuiltinPresetSnapshot()` 负责背书。
 */
export const BUILTIN_PRESET_SNAPSHOT: PresetSnapshot =
  builtinPresetSnapshotJson as unknown as PresetSnapshot;

/** 预期长度的 sha256 hex（去掉 `sha256:` 前缀后）。 */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * 作息表条目的 `path` 形状：`presets/schools/<校目录>/timetable.json`。
 *
 * 这是**符号路径**（合并后没有这个文件）：它代表 `schools/<校目录>/school.json` 里内嵌的
 * `timetable` 值。只校验形状，因为校目录名与作息 id 可以不同（`_default` → `default`），
 * id → 真实路径的对应关系在快照的 `index.schools[].timetablePath` 里。
 */
const TIMETABLE_SOURCE_PATH_PATTERN = /^presets\/schools\/[^/]+\/timetable\.json$/;

/**
 * 学校真实文件的形状：`presets/schools/<校目录>/school.json`。
 * `index.schools[].configPath` 与 `timetablePath` 都必须是这个形状
 * （合并后 `timetable.json` / `config.json` 都不存在了）。
 */
const SCHOOL_FILE_PATH_PATTERN = /^presets\/schools\/[^/]+\/school\.json$/;

/** 按 id 排序后规范化序列化再取 sha256：给内置正文算一个「指纹」，用于审计与呈现。 */
function semanticDigest(value: unknown): string {
  const list = Array.isArray(value) ? value : [];
  const entries = list as Array<Record<string, unknown>>;
  const sorted = [...entries].sort((left, right) => String(left['id']).localeCompare(String(right['id'])));
  return `sha256:${digestSha256(canonicalPresetJson(sorted))}`;
}

/**
 * 用内置配置的当前正文复算「语义摘要」（按 id 排序后规范化再取 sha256）。
 *
 * 用途是**审计与呈现**：让人一眼看出内置正文的指纹（例如写进发布检查、人工核对）。
 * 它不参与自证——拿内置内容算出来的值再去对内置内容，是循环论证。
 */
export function builtinPresetSourcesDigest(): { timetables: string; systems: string } {
  return {
    timetables: semanticDigest(BUILTIN_TIMETABLES),
    systems: semanticDigest(SYSTEMS_CONFIG),
  };
}

/**
 * 校验内置快照：复算内容哈希，并确认「内置快照 ⇔ 内置配置」没有漂移。
 *
 * 做四件事：
 *   1. **复算哈希**：去掉 `hash` 字段后规范化序列化，sha256 必须等于 `hash`
 *      （口径与预设仓库 `scripts/snapshot.mjs` 一致，实现见 `./preset-hash.ts`；
 *      2026 结构合并后 `index` 也在这个哈希范围里）；
 *   2. **比对作息表**：快照 `sources.timetables` 的 id 集合与 `BUILTIN_TIMETABLES` 完全相同；
 *   3. **比对教务系统**：快照 `sources.systems` 的 id 集合与内置 `systems.json`（`SYSTEMS_CONFIG`）完全相同；
 *   4. **内嵌索引的路径形状**：`index.schools[].configPath` / `timetablePath` 必须指向合并后的
 *      真实文件 `presets/schools/<校目录>/school.json`，`index.systems[].metaPath` / `loginPath`
 *      必须指向 `presets/systems/<id>/system.json`（合并后系统仍只有一个文件）。
 *
 * 注意本函数判的是**内置**（`timetables.json` / `systems.json`）与内置快照是否对得上，
 * 与运行时的预设覆盖层（`setPresetOverride`）无关：覆盖层换的是「当前生效值」，
 * 内置快照永远是打包时固化的那一份，所以这里不受覆盖状态影响。
 *
 * 判据为什么是这样——快照清单里每条只记 `{ id, path, sha256 }`，描述的是预设仓库里的
 * **单个来源**；内置 `timetables.json` / `systems.json` 是合并后的数组。两边形态不同：
 * 单文件哈希是带缩进的单对象原文哈希（教务系统那项更是编译产物的文本哈希），
 * 与合并数组复算的哈希**本来就不同**，所以清单里的 `sha256` 无法拿来对内置正文做内容级比对
 * （它的价值在预设仓库侧：证明那些来源没被改）。因此这里判「不漂移」用的是 id 集合：
 * **数量一致 + 双向无缺失**——内置多一个、少一个、被改名都会立刻失败。
 * `path` 只校验**形状**（不读文件）：作息表是历史契约符号路径
 * `presets/schools/<校目录>/timetable.json`（该文件已并入 school.json、不再存在），
 * 教务系统是 `presets/systems/<id>/system.json`（文件存在，但记录的是 legacy 编译产物哈希）。
 * 真实路径看 `index` 里的同名字段。
 *
 * 已知边界（见 `tools/presets/README.md`）：改内置 `systems.json` 里某个字段的**值**
 * （id 不动）不会让本函数失败，因为快照里没有那份内容可比。这类漂移靠两件事兜住：
 *   1. 流程规矩——预设仓库是唯一内容来源，改完必须跑 `tools/presets/sync-snapshot.mjs`；
 *   2. 两侧各自的单测——内置侧有 `config.test.ts`（逐节比对作息、系统字段），
 *      预设仓库侧有自己的快照 CI。
 * `builtinPresetSourcesDigest()` 导出的指纹可用于人工审计（例如写进发布检查）。
 *
 * 关于顺序：**只比集合，不比顺序**。快照清单是预设仓库按文件名排序得到的
 * （`default` 在 `usts` 前、`other` 在 `urp` 前），而内置 `systems.json` 的顺序是
 * 「识别优先级」这一业务语义，两者本来就不该相等。
 *
 * 不抛异常：任何问题都收敛成 `{ ok: false, reason }`，方便启动自检与测试直接判定。
 */
export function verifyBuiltinPresetSnapshot(): { ok: boolean; reason?: string } {
  const snapshot = BUILTIN_PRESET_SNAPSHOT;

  // ① 结构自查，避免后面的比较在坏数据上给出误导性结论
  if (snapshot === null || typeof snapshot !== 'object') {
    return { ok: false, reason: '内置快照应为对象' };
  }
  if (typeof snapshot.version !== 'string' || snapshot.version.trim() === '') {
    return { ok: false, reason: '内置快照缺少 version' };
  }
  if (!Number.isInteger(snapshot.schemaVersion)) {
    return { ok: false, reason: '内置快照的 schemaVersion 应为整数' };
  }
  if (snapshot.version !== BUILTIN_PRESET_VERSION) {
    return {
      ok: false,
      reason: `内置快照版本与 preset-version.json 不一致：快照 ${snapshot.version}，配置 ${BUILTIN_PRESET_VERSION}`,
    };
  }
  if (snapshot.schemaVersion !== BUILTIN_PRESET_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `内置快照的 schemaVersion 与 preset-version.json 不一致：快照 ${snapshot.schemaVersion}，配置 ${BUILTIN_PRESET_SCHEMA_VERSION}`,
    };
  }

  // ② 复算哈希
  const declared = typeof snapshot.hash === 'string' ? snapshot.hash.trim().toLowerCase() : '';
  if (!SHA256_HEX_PATTERN.test(declared.replace(/^sha256:/, '')) || !declared.startsWith('sha256:')) {
    return { ok: false, reason: `内置快照的 hash 格式不合法：${String(snapshot.hash)}` };
  }
  const { hash: _ignored, ...unsigned } = snapshot as unknown as Record<string, unknown>;
  const recomputed = `sha256:${digestSha256(canonicalPresetJson(unsigned))}`;
  if (recomputed !== declared) {
    return { ok: false, reason: `内置快照哈希不符：声明 ${declared}，复算 ${recomputed}` };
  }

  // ③ 内置快照 ⇔ 内置配置：id 集合双向对齐，且清单条目自身自洽
  const checks: Array<{
    label: string;
    listed: readonly PresetSnapshotSourceFile[];
    builtin: readonly { id: string }[];
    builtinFile: string;
    /** 该组条目 `path` 的期望语义；返回 null 表示合法，返回字符串表示问题描述 */
    describePathProblem: (item: PresetSnapshotSourceFile) => string | null;
  }> = [
    {
      label: '作息表',
      listed: snapshot.sources?.timetables ?? [],
      builtin: BUILTIN_TIMETABLES,
      builtinFile: 'timetables.json',
      // 符号路径：合并后该文件不存在，它代表 school.json 里内嵌的 timetable 值。
      // 校目录名与作息 id 可以不同（`_default` 目录 → `default` 作息），所以只校验形状。
      describePathProblem: (item) =>
        TIMETABLE_SOURCE_PATH_PATTERN.test(item.path)
          ? null
          : `的路径应为符号路径 presets/schools/<校目录>/timetable.json，实际 ${String(item.path)}`,
    },
    {
      label: '教务系统',
      listed: snapshot.sources?.systems ?? [],
      builtin: SYSTEMS_CONFIG,
      builtinFile: 'systems.json',
      // 历史契约路径：合并后这个文件存在（就是 system.json 本身），
      // 但条目 sha256 覆盖的是它编译成旧扁平结构后的文本，所以也不能按文件复算。
      // 路径由 id 唯一决定，这里可以逐字比对。
      describePathProblem: (item) => {
        const expected = `presets/systems/${item.id}/system.json`;
        return item.path === expected
          ? null
          : `的路径应为 ${expected}，实际 ${String(item.path)}` +
              '（它记录的是 system.json 编译成旧扁平结构后的文本哈希，不能按文件复算）';
      },
    },
  ];

  for (const check of checks) {
    if (!Array.isArray(check.listed)) {
      return { ok: false, reason: `内置快照的 sources 缺少${check.label}清单` };
    }
    const listedIds = check.listed.map((item) => item.id);
    if (new Set(listedIds).size !== listedIds.length) {
      return { ok: false, reason: `内置快照的${check.label}清单存在重复 id` };
    }

    const builtinIds = check.builtin.map((entry) => entry.id);
    const missing = builtinIds.filter((id) => !listedIds.includes(id));
    const extra = listedIds.filter((id) => !builtinIds.includes(id));
    if (missing.length > 0 || extra.length > 0) {
      return {
        ok: false,
        reason:
          `内置快照与内置 ${check.builtinFile} 的${check.label}清单不一致：` +
          `快照多出 [${extra.join('、')}]，内置多出 [${missing.join('、')}]`,
      };
    }

    for (const item of check.listed) {
      // 条目自洽：id 必须能在内置配置里找到，且 path 符合该组在当前目录结构下的语义
      const builtin = check.builtin.find((entry) => entry.id === item.id);
      if (builtin === undefined) {
        return {
          ok: false,
          reason: `内置快照列出的${check.label}「${item.id}」在内置 ${check.builtinFile} 里不存在（两侧已漂移）`,
        };
      }
      const pathProblem = check.describePathProblem(item);
      if (pathProblem !== null) {
        return { ok: false, reason: `内置快照的${check.label}「${item.id}」${pathProblem}` };
      }
      if (typeof item.sha256 !== 'string' || !SHA256_HEX_PATTERN.test(item.sha256.replace(/^sha256:/, ''))) {
        return {
          ok: false,
          reason: `内置快照的${check.label}「${item.id}」缺少合法的 sha256：${String(item.sha256)}`,
        };
      }
    }
  }

  // ④ 内嵌索引（原 presets/index.json）：结构 + 路径形状必须指向合并后的**真实文件**
  const index = snapshot.index;
  if (index === undefined || index === null || typeof index !== 'object') {
    return { ok: false, reason: '内置快照缺少 index（新结构必须内嵌索引：学校索引 + 系统引用）' };
  }
  if ((index as { _generated?: unknown })._generated !== true) {
    return { ok: false, reason: '内置快照的 index 不是生成物（_generated 应为 true）' };
  }
  if (!Array.isArray(index.schools) || !Array.isArray(index.systems)) {
    return { ok: false, reason: '内置快照的 index 缺少 schools / systems 数组' };
  }

  const schoolIds = new Set<string>();
  for (const school of index.schools) {
    const id = school?.id;
    if (typeof id !== 'string' || id.trim() === '') {
      return { ok: false, reason: '内置快照的 index.schools 存在缺少 id 的条目' };
    }
    if (schoolIds.has(id)) {
      return { ok: false, reason: `内置快照的 index.schools 存在重复 id：${id}` };
    }
    schoolIds.add(id);
    if (typeof school.timetablePath !== 'string' || !SCHOOL_FILE_PATH_PATTERN.test(school.timetablePath)) {
      return {
        ok: false,
        reason:
          `内置快照的 index 学校「${id}」的 timetablePath 应为真实文件 ` +
          `presets/schools/<校目录>/school.json，实际 ${String(school.timetablePath)}`,
      };
    }
    const configPath = school.configPath;
    if (configPath !== null && configPath !== undefined) {
      if (typeof configPath !== 'string' || !SCHOOL_FILE_PATH_PATTERN.test(configPath)) {
        return {
          ok: false,
          reason:
            `内置快照的 index 学校「${id}」的 configPath 应为真实文件 ` +
            `presets/schools/<校目录>/school.json 或 null，实际 ${String(configPath)}`,
        };
      }
    }
  }

  const indexSystemIds = new Set<string>();
  for (const system of index.systems) {
    const id = system?.id;
    if (typeof id !== 'string' || id.trim() === '') {
      return { ok: false, reason: '内置快照的 index.systems 存在缺少 id 的条目' };
    }
    if (indexSystemIds.has(id)) {
      return { ok: false, reason: `内置快照的 index.systems 存在重复 id：${id}` };
    }
    indexSystemIds.add(id);
    // 合并后一个系统只有 system.json 一个文件：metaPath / loginPath 都指它
    for (const key of ['metaPath', 'loginPath'] as const) {
      const value = system[key];
      if (value === undefined || value === null) continue;
      const expected = `presets/systems/${id}/system.json`;
      if (typeof value !== 'string' || value !== expected) {
        return {
          ok: false,
          reason: `内置快照的 index 系统「${id}」的 ${key} 应为真实文件 ${expected}，实际 ${String(value)}`,
        };
      }
    }
  }

  return { ok: true };
}

// —— 可注入的预设覆盖层 ——
//
// 语义一句话：**启动时套用缓存、运行时绝不热替换**。
//
// 应用启动时（`apps/web/src/App.tsx` 的初始化）会把「本地缓存且版本高于内置」的预设
// 通过 `setPresetOverride()` 注进这一层；此后进程内所有读取（`findTimetable`、
// `readSystemsConfig`、`effectiveTimetables`/`effectiveSystems`/`effectivePresetVersion`）
// 都返回**有效预设**（有覆盖就是覆盖，没有就是内置）。
//
// 为什么不在运行时热替换：用户正在用的一套作息/教务配置，不能因为后台下载完成就在
// 半路换掉——设置页里下载成功只提示「下次启动生效」正是这个约定。
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
    systems: presetOverride?.systems ?? SYSTEMS_CONFIG,
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
  return presetOverride?.systems ?? SYSTEMS_CONFIG;
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
