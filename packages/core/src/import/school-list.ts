import { readSystemsConfig, type SchoolSystemId } from '../config/index.ts';
import { DIRECTORY_NAMES, MANUAL_SCHOOLS } from './schools.ts';

export { DIRECTORY_NAMES, MANUAL_SCHOOLS };

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
 * 教务系统入口模板：数据全部来自 src/config/systems.json（经 src/config 校验）。
 * 这里只是把配置字段改成既有调用方习惯的名字（name → label、entryPath → loginPath），
 * 保证 SYSTEM_ENTRIES 的形态与顺序不变，避免别处的引用一起改。
 */
export const SYSTEM_ENTRIES: readonly SystemEntry[] = readSystemsConfig().map((system) => ({
  id: system.id,
  label: system.name,
  loginPath: system.entryPath,
  hint: system.hint,
}));

export interface SchoolEntry {
  id: string;
  name: string;
  system: SchoolSystem;
  /** 教务系统域名或完整地址；留空表示待补充 */
  url: string;
  /** 检索用简称 */
  aliases?: readonly string[];
  source: 'builtin' | 'user';
}

/**
 * 内置学校：上游适配仓库的条目 + 本项目自行维护的条目。
 * 两段数据都在 schools.ts，手工维护段重新生成时不会被覆盖。
 */
export const BUILTIN_SCHOOLS: readonly SchoolEntry[] = [...MANUAL_SCHOOLS];

export function systemEntry(system: SchoolSystem): SystemEntry {
  return SYSTEM_ENTRIES.find((entry) => entry.id === system) ?? (SYSTEM_ENTRIES[0] as SystemEntry);
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

/** 按名称与简称检索，前缀命中优先。 */
export function matchSchools(schools: readonly SchoolEntry[], keyword: string): SchoolEntry[] {
  const query = keyword.trim().toLowerCase();
  const scored: Array<{ school: SchoolEntry; score: number }> = [];
  for (const school of schools) {
    const fields = [school.name, ...(school.aliases ?? [])].map((text) => text.toLowerCase());
    let score = 0;
    for (const field of fields) {
      if (query.length === 0) score = Math.max(score, 1);
      else if (field.startsWith(query)) score = Math.max(score, 3);
      else if (field.includes(query)) score = Math.max(score, 2);
    }
    if (score > 0) scored.push({ school, score });
  }
  return scored
    .sort((left, right) => right.score - left.score || left.school.name.localeCompare(right.school.name))
    .map((item) => item.school);
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

/** 下拉框候选：带教务入口的条目排在前，其次才是名单里只有校名的学校。 */
export interface SchoolSuggestion {
  key: string;
  name: string;
  system: SchoolSystem;
  url: string;
  id: string | null;
  hasEntry: boolean;
  source: 'builtin' | 'user' | 'directory';
}

export interface SuggestSchoolsOptions {
  schools: readonly SchoolEntry[];
  directory?: readonly string[];
  limit?: number;
}

export function suggestSchools(query: string, options: SuggestSchoolsOptions): SchoolSuggestion[] {
  const limit = options.limit ?? 20;
  const directory = options.directory ?? DIRECTORY_NAMES;
  const keyword = query.trim();
  const out: SchoolSuggestion[] = [];
  const covered = new Set<string>();

  const pool =
    keyword.length === 0
      ? [...options.schools].sort((left, right) => left.name.localeCompare(right.name))
      : matchSchools(options.schools, keyword);

  for (const school of pool) {
    if (out.length >= limit) break;
    out.push({
      key: school.id,
      name: school.name,
      system: school.system,
      url: school.url,
      id: school.id,
      hasEntry: school.url.length > 0,
      source: school.source,
    });
    covered.add(school.name);
  }

  if (keyword.length > 0) {
    const lower = keyword.toLowerCase();
    for (const name of directory) {
      if (out.length >= limit) break;
      if (covered.has(name) || !name.toLowerCase().includes(lower)) continue;
      out.push({
        key: `dir:${name}`,
        name,
        system: 'other',
        url: '',
        id: null,
        hasEntry: false,
        source: 'directory',
      });
      covered.add(name);
    }
  }

  return out;
}
