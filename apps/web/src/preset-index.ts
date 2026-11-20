/** 预设索引：快照内嵌的学校与教务系统目录，随快照过哈希。 */
import {
  PRESET_SCHEMA_VERSION,
  type PresetSnapshot,
} from './preset-update.ts';

// —— 预设索引（快照内嵌的 index 字段）——
// 索引随快照过哈希，无独立请求（旧 PRESET_INDEX_URL 会 404）。

/** 索引里的一条学校。 */
export interface PresetIndexSchool {
  id: string;
  name: string;
  /** 绑定的教务系统 id；通用作息为 null */
  system: string | null;
  /** 作息来源真实文件的相对路径：恒为 presets/schools/<校目录>/school.json（timetable.json 已不存在）。 */
  timetablePath: string;
  /** 学校覆盖配置的相对路径：有配置时同样指向 presets/schools/<校目录>/school.json，没有则为 null。 */
  configPath: string | null;
  /** 索引条目还会带 `region` / `aliases` / `generic` / `default` / `type` 等字段，本模块原样保留 */
  [key: string]: unknown;
}

/** 索引里的一条教务系统引用。 */
export interface PresetIndexSystem {
  id: string;
  /** 页面识别特征，四项都可能为空数组。 */
  /** 快照 sources.systems[].path 是 legacy 编译产物文本的哈希，读文件要按索引的 metaPath / loginPath / parserPath。 */
  detect: {
    markers: string[];
    timetableTableIds: string[];
    timetableTableClasses: string[];
    gridCellIdPatterns: string[];
  };
  /** 登录入口路径（相对站点根，以 `/` 开头） */
  entryPath: string;
  hint: string;
  /** 索引条目还会带 `aliases` / `version` / `hasParser` / `parserPath` / `metaPath` / `loginPath` 等字段 */
  [key: string]: unknown;
}

/** 快照内嵌索引的结构（原 `presets/index.json` 的顶层结构）；本模块只取需要的字段。 */
export interface PresetIndex {
  _generated: true;
  version: string;
  schemaVersion: number;
  schools: PresetIndexSchool[];
  systems: PresetIndexSystem[];
}

/** 索引里 `detect` 的四个固定子键（与 core 的 `SystemDetectConfig` 同形）。 */
const PRESET_INDEX_DETECT_KEYS = [
  'markers',
  'timetableTableIds',
  'timetableTableClasses',
  'gridCellIdPatterns',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 非空字符串（去首尾空白后）才算数；其余一律 null。 */
function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** 路径安全检查：非空、POSIX 分隔符、相对路径、不含 .. 段、不带盘符——索引里的路径会被拿去读文件。 */
function describePresetPathProblem(value: unknown, where: string): string | null {
  const text = nonEmptyText(value);
  if (text === null) return `${where} 应为非空字符串`;
  if (text.startsWith('/') || text.includes('\\')) return `${where} 应为 POSIX 风格的相对路径：${text}`;
  if (/^[A-Za-z]:/.test(text)) return `${where} 不应带盘符：${text}`;
  if (text.split('/').includes('..')) return `${where} 不应包含 .. 段：${text}`;
  return null;
}

/** 字符串数组校验；元素必须是非空字符串。 */
function describeTextArrayProblem(value: unknown, where: string): string | null {
  if (!Array.isArray(value)) return `${where} 应为字符串数组`;
  for (const [index, item] of value.entries()) {
    if (nonEmptyText(item) === null) return `${where}[${index}] 应为非空字符串`;
  }
  return null;
}

/** 存在的可选字段要类型正确；缺失（undefined）不追究——索引会随结构演进加字段。 */
function describeOptionalProblem(entry: Record<string, unknown>, key: string, where: string): string | null {
  if (entry[key] === undefined) return null;
  const value = entry[key];
  if (key === 'aliases') return describeTextArrayProblem(value, `${where} 的 aliases`);
  if (key === 'generic' || key === 'default' || key === 'hasParser') {
    return typeof value === 'boolean' ? null : `${where} 的 ${key} 应为布尔值`;
  }
  if (key === 'region' || key === 'type' || key === 'version') {
    return nonEmptyText(value) === null ? `${where} 的 ${key} 应为非空字符串` : null;
  }
  // metaPath / loginPath / parserPath：可选，但一旦出现就必须是安全的相对路径
  return describePresetPathProblem(value, `${where} 的 ${key}`);
}

/** 校验内嵌索引，返回问题描述、合法时 null，不抛异常。 */
/** _generated 必须恒为 true；无绑定系统或无覆盖配置时 system / configPath 要显式写 null。 */
export function describePresetIndexProblem(value: unknown): string | null {
  if (!isRecord(value)) return '预设索引应为对象';
  if (value['_generated'] !== true) {
    return '预设索引缺少 _generated: true（它不是生成物，已拒绝）';
  }
  if (nonEmptyText(value['version']) === null) return '预设索引缺少 version';
  const schemaVersion = value['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    return '预设索引的 schemaVersion 应为整数';
  }
  if (schemaVersion > PRESET_SCHEMA_VERSION) {
    return `预设索引使用了更新的格式（schemaVersion ${schemaVersion}），请升级应用`;
  }
  if (!Array.isArray(value['schools'])) return '预设索引的 schools 应为数组';
  if (!Array.isArray(value['systems'])) return '预设索引的 systems 应为数组';

  const schoolIds = new Set<string>();
  for (const [index, raw] of value['schools'].entries()) {
    const where = `预设索引的学校 #${index + 1}`;
    if (!isRecord(raw)) return `${where} 应为对象`;
    const id = nonEmptyText(raw['id']);
    if (id === null) return `${where} 缺少 id`;
    if (schoolIds.has(id)) return `${where} 的 id 重复：${id}`;
    schoolIds.add(id);

    if (nonEmptyText(raw['name']) === null) return `预设索引的学校「${id}」缺少 name`;
    if (!('system' in raw)) {
      return `预设索引的学校「${id}」缺少 system`;
    }
    if (raw['system'] !== null && nonEmptyText(raw['system']) === null) {
      return `预设索引的学校「${id}」的 system 应为非空字符串或 null`;
    }
    if (!('configPath' in raw)) {
      return `预设索引的学校「${id}」缺少 configPath`;
    }
    if (raw['configPath'] !== null) {
      const problem = describePresetPathProblem(raw['configPath'], `预设索引的学校「${id}」的 configPath`);
      if (problem !== null) return problem;
    }
    const timetableProblem = describePresetPathProblem(
      raw['timetablePath'],
      `预设索引的学校「${id}」的 timetablePath`,
    );
    if (timetableProblem !== null) return timetableProblem;
    for (const key of ['aliases', 'generic', 'default', 'region', 'type']) {
      const problem = describeOptionalProblem(raw, key, `预设索引的学校「${id}」`);
      if (problem !== null) return problem;
    }
  }

  const systemIds = new Set<string>();
  for (const [index, raw] of value['systems'].entries()) {
    const where = `预设索引的系统 #${index + 1}`;
    if (!isRecord(raw)) return `${where} 应为对象`;
    const id = nonEmptyText(raw['id']);
    if (id === null) return `${where} 缺少 id`;
    if (systemIds.has(id)) return `${where} 的 id 重复：${id}`;
    systemIds.add(id);

    if (nonEmptyText(raw['name']) === null) return `预设索引的系统「${id}」缺少 name`;
    const detect = raw['detect'];
    if (!isRecord(detect)) return `预设索引的系统「${id}」缺少 detect`;
    for (const key of PRESET_INDEX_DETECT_KEYS) {
      const problem = describeTextArrayProblem(detect[key], `预设索引的系统「${id}」的 detect.${key}`);
      if (problem !== null) return problem;
    }
    const entryPath = nonEmptyText(raw['entryPath']);
    if (entryPath === null) return `预设索引的系统「${id}」缺少 entryPath`;
    if (!entryPath.startsWith('/')) {
      return `预设索引的系统「${id}」的 entryPath 应以 / 开头：${entryPath}`;
    }
    if (nonEmptyText(raw['hint']) === null) return `预设索引的系统「${id}」缺少 hint`;
    for (const key of ['aliases', 'hasParser', 'version', 'metaPath', 'loginPath', 'parserPath']) {
      const problem = describeOptionalProblem(raw, key, `预设索引的系统「${id}」`);
      if (problem !== null) return problem;
    }
  }

  return null;
}

/** 解析并校验索引内容（快照内嵌的 `index`）；不合法时抛出可读错误。 */
export function parsePresetIndex(value: unknown): PresetIndex {
  const problem = describePresetIndexProblem(value);
  if (problem !== null) throw new Error(`预设索引不可用：${problem}`);
  return value as PresetIndex;
}

/** 从已下载的快照里取出索引，纯函数、不看网络。 */
/** index 随快照过哈希，无独立请求（旧 PRESET_INDEX_URL 会 404）；缺 index 抛可读错误。 */
export function presetIndexFromSnapshot(snapshot: PresetSnapshot): PresetIndex {
  const index = (snapshot as { index?: unknown }).index;
  if (index === undefined || index === null) {
    throw new Error(
      '预设快照不可用：缺少内嵌索引 index',
    );
  }
  return parsePresetIndex(index);
}
