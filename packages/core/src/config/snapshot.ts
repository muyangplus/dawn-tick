/** 内置预设快照：类型、来源摘要与自检。 */
import builtinPresetSnapshotJson from './builtin-preset-snapshot.json' with { type: 'json' };
import { canonicalPresetJson, sha256HexSync as digestSha256 } from './preset-hash.ts';
import {
  BUILTIN_PRESET_SCHEMA_VERSION,
  BUILTIN_PRESET_VERSION,
  BUILTIN_SYSTEMS,
  BUILTIN_TIMETABLES,
} from './builtin.ts';
import { validateSystems, validateTimetables } from './validate.ts';

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
 * 这里只做类型收敛，内容比对由 `verifyBuiltinPresetSnapshot()` 负责。
 */
export const BUILTIN_PRESET_SNAPSHOT: PresetSnapshot =
  builtinPresetSnapshotJson as unknown as PresetSnapshot;

/** 预期长度的 sha256 hex（去掉 `sha256:` 前缀后）。 */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * 作息表条目的 `path` 形状：`presets/schools/<校目录>/timetable.json`。
 *
 * 这是**符号路径**（合并后没有这个文件）：它代表 `schools/<校目录>/school.json` 里内嵌的
 * `timetable` 值。只校验形状：校目录名与作息 id 可以不同（`_default` → `default`），
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
 * 它不参与校验：拿内置内容算出来的值再去对内置内容，是循环论证。
 */
export function builtinPresetSourcesDigest(): { timetables: string; systems: string } {
  return {
    timetables: semanticDigest(BUILTIN_TIMETABLES),
    systems: semanticDigest(BUILTIN_SYSTEMS),
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
 *   3. **比对教务系统**：快照 `sources.systems` 的 id 集合与内置 `systems.json`（`BUILTIN_SYSTEMS`）完全相同；
 *   4. **内嵌索引的路径形状**：`index.schools[].configPath` / `timetablePath` 必须指向合并后的
 *      真实文件 `presets/schools/<校目录>/school.json`，`index.systems[].metaPath` / `loginPath`
 *      必须指向 `presets/systems/<id>/system.json`（合并后系统仍只有一个文件）。
 *
 * 注意本函数判的是**内置**（`timetables.json` / `systems.json`）与内置快照是否对得上，
 * 与运行时的预设覆盖层（`setPresetOverride`）无关：覆盖层换的是「当前生效值」，
 * 内置快照永远是打包时固化的那一份，这里不受覆盖状态影响。
 *
 * 判据：快照清单里每条只记 `{ id, path, sha256 }`，描述的是预设仓库里的
 * **单个来源**；内置 `timetables.json` / `systems.json` 是合并后的数组。两边形态不同：
 * 单文件哈希是带缩进的单对象原文哈希（教务系统那项更是编译产物的文本哈希），
 * 与合并数组复算的哈希**本来就不同**，清单里的 `sha256` 无法拿来对内置正文做内容级比对
 * （它的价值在预设仓库侧：证明那些来源没被改）。这里的「不漂移」判据用的是 id 集合：
 * **数量一致 + 双向无缺失**——内置多一个、少一个、被改名都会立刻失败。
 * `path` 只校验**形状**（不读文件）：作息表是历史契约符号路径
 * `presets/schools/<校目录>/timetable.json`（该文件已并入 school.json、不再存在），
 * 教务系统是 `presets/systems/<id>/system.json`（文件存在，但记录的是 legacy 编译产物哈希）。
 * 真实路径看 `index` 里的同名字段。
 *
 * 已知边界（见 `tools/presets/README.md`）：改内置 `systems.json` 里某个字段的**值**
 * （id 不动）不会让本函数失败——快照里没有那份内容可比。这类漂移由两处覆盖：
 *   1. 流程规矩——预设仓库是唯一内容来源，改完必须跑 `tools/presets/sync-snapshot.mjs`；
 *   2. 两侧各自的单测——内置侧有 `config.test.ts`（逐节比对作息、系统字段），
 *      预设仓库侧有自己的快照 CI。
 * `builtinPresetSourcesDigest()` 导出的指纹可用于人工审计（例如写进发布检查）。
 *
 * 关于顺序：**只比集合，不比顺序**。快照清单是预设仓库按文件名排序得到的
 * （`default` 在 `usts` 前、`other` 在 `urp` 前），而内置 `systems.json` 的顺序是
 * 「识别优先级」这一业务语义，两者不相等。
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
      builtin: BUILTIN_SYSTEMS,
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
