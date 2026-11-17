import { readSystemsConfig, type SchoolSystemId, type SystemConfig } from '../config/index.ts';
import { MANUAL_SCHOOLS } from './schools.ts';

export { MANUAL_SCHOOLS };

/** 教务系统 id；事实来源是 src/config/systems.json（见 src/config/index.ts）。 */
export type SchoolSystem = SchoolSystemId;

export interface SystemEntry {
  id: SchoolSystem;
  label: string;
  /** 登录入口路径，拼接在学校域名之后 */
  loginPath: string;
  hint: string;
}

/**
 * 把一份教务系统配置映射成既有调用方习惯的字段名（name → label、entryPath → loginPath）。
 * SystemEntry 的形态与顺序不变，别处的引用不必跟着改。
 */
function toSystemEntries(systems: readonly SystemConfig[]): readonly SystemEntry[] {
  return systems.map((system) => ({
    id: system.id,
    label: system.name,
    loginPath: system.entryPath,
    hint: system.hint,
  }));
}

/** 按有效配置数组的引用缓存映射结果（`readSystemsConfig()` 每次返回同一个引用）。 */
let cachedEntries:
  | { systems: readonly SystemConfig[]; entries: readonly SystemEntry[] }
  | undefined;

/**
 * **有效配置**的入口模板列表：没有覆盖时逐条等于内置 `systems.json`，
 * 被 `setPresetOverride()` 换过配置时立刻跟着换。
 */
export function effectiveSystemEntries(): readonly SystemEntry[] {
  const systems = readSystemsConfig();
  if (cachedEntries === undefined || cachedEntries.systems !== systems) {
    cachedEntries = { systems, entries: toSystemEntries(systems) };
  }
  return cachedEntries.entries;
}

/**
 * 教务系统入口模板（有效配置的只读视图）。
 *
 * 它是一个**惰性转发**到 `effectiveSystemEntries()` 的视图，而不是模块加载时算好的数组：
 * 启动时通过 `setPresetOverride()` 注入的缓存教务配置必须能影响这里，
 * 否则界面上的入口路径与 `systemEntry()` 返回的会是两套值。
 * 无覆盖时下标、长度、遍历结果与内置 `systems.json` 逐一相同——调用方感觉不到区别。
 */
export const SYSTEM_ENTRIES: readonly SystemEntry[] = new Proxy([] as SystemEntry[], {
  get(_target, property) {
    return Reflect.get(effectiveSystemEntries(), property);
  },
  has(_target, property) {
    return Reflect.has(effectiveSystemEntries(), property);
  },
  ownKeys() {
    return Reflect.ownKeys(effectiveSystemEntries());
  },
  getOwnPropertyDescriptor(_target, property) {
    return Reflect.getOwnPropertyDescriptor(effectiveSystemEntries(), property);
  },
});

/**
 * 一条教务入口数据：只回答「这所学校从哪个地址登录」，不参与目录检索与排序。
 *
 * 校名/简称/拼音/标签/省份的检索统一走 `schools/index.ts` 的 `searchSchools`；
 * 这里的 `name` 只用于与目录学校做入口匹配（先 id、后校名），不是检索键。
 * 也不再带 `aliases`：简称检索由目录数据自己的 `shortName` / `shortPinyin` 承担。
 */
export interface SchoolEntry {
  id: string;
  name: string;
  system: SchoolSystem;
  /** 教务系统域名或完整地址；留空表示待补充 */
  url: string;
  source: 'builtin' | 'user';
}

/** 内置学校：`schools.ts` 里手工维护的教务入口条目。 */
export const BUILTIN_SCHOOLS: readonly SchoolEntry[] = [...MANUAL_SCHOOLS];

/**
 * 按 id 取某个教务系统的入口模板（**有效配置**；覆盖层换过配置就用覆盖的那份）。
 * 找不到时回落到第一条，与既有行为一致。
 */
export function systemEntry(system: SchoolSystem): SystemEntry {
  const entries = effectiveSystemEntries();
  return entries.find((entry) => entry.id === system) ?? (entries[0] as SystemEntry);
}

/**
 * 由用户输入拼出登录入口：接受完整地址、域名或带路径的地址，
 * 去掉已有路径后按系统模板补上入口路径。留空时只返回域名部分。
 */
export function buildEntryUrl(system: SchoolSystem, input: string, withPath = true): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let origin = withScheme;
  try {
    origin = new URL(withScheme).origin;
  } catch {
    return trimmed;
  }
  if (!withPath) return origin;
  const entry = systemEntry(system);
  return `${origin}${entry.loginPath}`;
}

/**
 * 取某条学校记录的入口地址：已经带具体路径（或查询、片段）的按原样使用，
 * 只有纯域名时才按系统模板补上入口路径。
 */
export function entryUrlFor(system: SchoolSystem, url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    const hasPath =
      parsed.pathname.replace(/\/+$/, '').length > 0 || parsed.search.length > 0 || parsed.hash.length > 0;
    return hasPath ? parsed.toString() : `${parsed.origin}${systemEntry(system).loginPath}`;
  } catch {
    return trimmed;
  }
}

/** 合并内置与用户自定义学校，同 id 时用户条目优先。 */
export function mergeSchools(
  builtin: readonly SchoolEntry[],
  custom: readonly SchoolEntry[],
): SchoolEntry[] {
  const byId = new Map<string, SchoolEntry>();
  for (const school of builtin) byId.set(school.id, school);
  for (const school of custom) byId.set(school.id, { ...school, source: 'user' });
  return [...byId.values()];
}
