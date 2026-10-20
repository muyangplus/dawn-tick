// 纯逻辑（不含 JSX）：渲染截断、按省份分组、入口匹配、`adapterInfo` 徽标、作息定位、`requestSchoolUrl`。
// 目录检索只有一条路径：组件直接调 core 的 `searchSchools`（名字/拼音/标签/省份）；
// 本文件不再包一层检索，`SchoolEntry` 只负责「入口匹配与 URL 构造」。
// 已适配 = 系统 id 有效 且 `systems` 含该系统 且 `parserPath` 非空；`schools`.`system` 恒空。
import {
  BUILTIN_PRESET_SNAPSHOT,
  DEFAULT_TIMETABLE_ID,
  entryUrlFor,
  findTimetable,
  presetToTimeSlots,
  replaceTimeSlots,
  type SchoolEntry,
  type Storage,
} from '@dawn-tick/core';
import { SCHOOL_TAGS, listProvinces, type School } from '@dawn-tick/core';
import {
  presetIndexFromSnapshot,
  resolvePresetSource,
  type PresetIndex,
  type PresetIndexSchool,
  type PresetSnapshot,
} from '../preset-update.ts';

export type { School };

// —— 请求适配：GitHub Issue 模板；地址只写在这一处，换仓库或模板改名只改这里。 ——
/** Issue 新建页 */
export const PRESET_ISSUE_NEW_URL = 'https://github.com/muyangplus/dawn-tick-presets/issues/new';
/** 「请求学校适配」Issue 表单的模板文件名 */
export const REQUEST_SCHOOL_TEMPLATE = 'request-school.yml';
/** 底部固定入口的默认标题 */
export const REQUEST_SCHOOL_DEFAULT_TITLE = '[学校适配] 提交学校信息';

/** 生成「提交学校信息 / 请求适配」的 Issue 地址；传校名则写进 `title`，不传用默认标题。 */
export function requestSchoolUrl(schoolName?: string): string {
  const title = schoolName === undefined || schoolName.trim() === '' ? REQUEST_SCHOOL_DEFAULT_TITLE : `[学校适配] ${schoolName.trim()}`;
  return `${PRESET_ISSUE_NEW_URL}?template=${REQUEST_SCHOOL_TEMPLATE}&title=${encodeURIComponent(title)}`;
}

// —— 筛选 ——

/** 没有省份的学校归到这一组（目录里目前有 2 所） */
export const OTHER_PROVINCE = '其他';

/** 筛选行上固定露出的常用标签（顺序即展示顺序）；缺了就用最高频的标签补齐。 */
export const PREFERRED_SCHOOL_TAGS: readonly string[] = ['985', '211', '双一流'];

/** 筛选行一次露出几个标签，其余折叠进「更多标签」。 */
export const PRIMARY_TAG_COUNT = 3;

/** 结果区一次最多渲染多少行：2659 所全渲染没必要，其余靠关键词与筛选收敛。 */
export const SCHOOL_RENDER_LIMIT = 120;

/** 目录里出现过的全部标签（只读视图，便于界面直接遍历）。 */
export function allSchoolTags(): readonly string[] {
  return SCHOOL_TAGS;
}

/** 筛选行上固定露出的常用标签：先取 `PREFERRED_SCHOOL_TAGS`，不足 `PRIMARY_TAG_COUNT` 时按码元序补齐。 */
export function primarySchoolTags(tags: readonly string[] = SCHOOL_TAGS): string[] {
  const available = new Set(tags);
  const preferred = PREFERRED_SCHOOL_TAGS.filter((tag) => available.has(tag));
  if (preferred.length >= PRIMARY_TAG_COUNT) return preferred.slice(0, PRIMARY_TAG_COUNT);
  const rest = [...tags].filter((tag) => !preferred.includes(tag)).sort();
  return [...preferred, ...rest].slice(0, PRIMARY_TAG_COUNT);
}

/** 折叠进「更多标签」的其余标签。 */
export function extraSchoolTags(tags: readonly string[] = SCHOOL_TAGS): string[] {
  const primary = new Set(primarySchoolTags(tags));
  return [...tags].filter((tag) => !primary.has(tag)).sort();
}

/** 只取前 `limit` 所（默认 `SCHOOL_RENDER_LIMIT`），用于渲染。 */
export function limitSchools(schools: readonly School[], limit: number = SCHOOL_RENDER_LIMIT): School[] {
  return schools.length <= limit ? [...schools] : schools.slice(0, limit);
}

/** 地区下拉的选项：全部省级行政区（与 `listProvinces()` 同序）。 */
export function provinceOptions(): string[] {
  return listProvinces();
}

/** 一所学校的分组名：没有省份归「其他」。 */
export function provinceOf(school: School): string {
  const province = school.province?.trim();
  return province === undefined || province === '' ? OTHER_PROVINCE : province;
}

/** 一个省份分组。 */
export interface SchoolGroup {
  province: string;
  schools: School[];
}

/** 按省份分组：已知省份按 `listProvinces()` 顺序，未知省份在其后，`其他` 最后；组内保持传入顺序。 */
export function groupSchoolsByProvince(
  schools: readonly School[],
  provinces: readonly string[] = listProvinces(),
): SchoolGroup[] {
  const order = new Map<string, number>();
  provinces.forEach((province, index) => order.set(province, index));

  const buckets = new Map<string, School[]>();
  for (const school of schools) {
    const key = provinceOf(school);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [school]);
    else bucket.push(school);
  }

  const rank = (province: string): number => {
    if (province === OTHER_PROVINCE) return 3;
    return order.has(province) ? 0 : 2;
  };

  return [...buckets.entries()]
    .map(([province, list]) => ({ province, schools: list }))
    .sort(
      (left, right) =>
        rank(left.province) - rank(right.province) ||
        (order.get(left.province) ?? 0) - (order.get(right.province) ?? 0) ||
        left.province.localeCompare(right.province),
    );
}

/** 每行的次要行文案：`标签 · 门类`。 */
export function schoolSubtitle(school: School): string {
  const parts = [school.tags.join(' / '), school.category ?? ''].filter((part) => part.trim() !== '');
  return parts.join(' · ');
}

// —— 预设上下文：索引 + 快照（适配徽标与作息定位的共同输入）——

/** 当前生效的预设：版本、索引、快照。`index` 为 null 时 `problem` 说明原因。 */
export interface PresetContext {
  version: string;
  kind: 'builtin' | 'cached';
  index: PresetIndex | null;
  /** 索引不可用时的可读原因（界面只用来提示，不弹错） */
  problem: string | null;
  /** 用于在 `sources` 里定位学校作息文件；拿不到时为 null */
  snapshot: PresetSnapshot | null;
}

/** 读当前生效的预设：缓存快照（版本更高且哈希可信）优先，否则内置；解析失败给 `index: null` 与原因。 */
export async function loadPresetContext(storage: Storage): Promise<PresetContext> {
  const source = await resolvePresetSource(storage);
  const snapshot = source.snapshot ?? (BUILTIN_PRESET_SNAPSHOT as unknown as PresetSnapshot);
  let index: PresetIndex | null = null;
  let problem: string | null = null;
  try {
    index = presetIndexFromSnapshot(snapshot);
  } catch (cause: unknown) {
    problem = cause instanceof Error ? cause.message : String(cause);
  }
  return { version: source.version, kind: source.kind, index, problem, snapshot };
}

/** 索引里一条学校条目的可选字段都是 unknown，这里逐个收敛成字符串。 */
function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function aliasesOf(entry: PresetIndexSchool): string[] {
  const raw = entry['aliases'];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => textOf(item)).filter((item): item is string => item !== null);
}

/** 通用作息（`generic` / `default`）不是某一所学校，匹配时跳过。 */
function isGenericEntry(entry: PresetIndexSchool): boolean {
  return entry['generic'] === true || entry['default'] === true;
}

/** 在预设索引里找这所学校：先按 id，再按校名，再按简称/别名；两处 id 口径不同，名称匹配是主路径。 */
export function findIndexSchool(index: PresetIndex, school: School): PresetIndexSchool | undefined {
  const wanted = [school.id, school.name, school.shortName]
    .map((value) => textOf(value))
    .filter((value): value is string => value !== null);
  if (wanted.length === 0) return undefined;
  return index.schools.find((entry) => {
    if (isGenericEntry(entry)) return false;
    if (wanted.includes(entry.id) || wanted.includes(entry.name)) return true;
    return aliasesOf(entry).some((alias) => wanted.includes(alias));
  });
}

/** 适配徽标的判定结果。`reason` 为空表示已适配。 */
export interface AdapterInfo {
  adapted: boolean;
  /** 判定用到的教务系统 id（已适配或「系统存在但缺解析脚本」时非空） */
  systemId: string | null;
  systemName: string | null;
  /** 未适配的原因，用于提示与测试断言 */
  reason: string;
}

/** 判定「已适配 / 暂未适配」：系统 id 取目录 `school.system` → 索引条目 `system`，且 `systems` 里能找到它、`parserPath` 非空。 */
export function adapterInfo(context: PresetContext | null, school: School): AdapterInfo {
  const miss = (reason: string, systemId: string | null = null, systemName: string | null = null): AdapterInfo => ({
    adapted: false,
    systemId,
    systemName,
    reason,
  });

  if (context === null) return miss('预设还在读取中');
  const index = context.index;
  if (index === null) return miss(context.problem ?? '预设索引不可用');

  const entry = findIndexSchool(index, school);
  const entrySystem = entry === undefined ? null : textOf(entry.system);
  const systemId = textOf(school.system) ?? entrySystem;
  if (systemId === null) return miss('预设索引里没有该校教务系统');

  const system = index.systems.find((item) => item.id.toLowerCase() === systemId.toLowerCase());
  if (system === undefined) return miss(`预设索引里没有教务系统 ${systemId}`, systemId);

  const parserPath = textOf(system.parserPath);
  const systemName = textOf(system.name) ?? systemId;
  if (parserPath === null) return miss(`教务系统 ${systemName} 还没有解析脚本`, systemId, systemName);
  return { adapted: true, systemId, systemName, reason: '' };
}

/** 适配徽标的文案：已适配时带预设版本，未适配时就是「暂未适配」。 */
export function adapterBadgeText(info: AdapterInfo, presetVersion: string): string {
  return info.adapted ? `已适配 ${presetVersion}` : '暂未适配';
}

// —— 学校作息定位 ——

/** 快照 `sources` 里的一条来源文件（只取定位需要的两个字段）。 */
export interface PresetSourceFile {
  id: string;
  path: string;
}

/** 把快照 `sources.timetables` / `sources.systems` 收敛成 `{ id, path }` 列表。 */
export function readSourceFiles(raw: unknown): PresetSourceFile[] {
  if (!Array.isArray(raw)) return [];
  const files: PresetSourceFile[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const id = textOf(record['id']);
    const path = textOf(record['path']);
    if (id === null || path === null) continue;
    files.push({ id, path });
  }
  return files;
}

/** `presets/schools/usts/school.json` → `presets/schools/usts`（路径的目录部分）。 */
export function schoolDirOf(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

/** 在快照清单里定位某校作息来源：优先同 id，其次同目录（索引给 `school.json`，清单 `path` 是历史契约 `timetable.json`）。 */
export function locateTimetableSource(context: PresetContext, entry: PresetIndexSchool): PresetSourceFile | null {
  const timetablePath = textOf(entry.timetablePath);
  if (timetablePath === null) return null;
  const files = readSourceFiles(context.snapshot?.sources?.timetables);
  const byId = files.find((file) => file.id.toLowerCase() === entry.id.toLowerCase());
  if (byId !== undefined) return byId;
  const dir = schoolDirOf(timetablePath);
  return files.find((file) => schoolDirOf(file.path) === dir) ?? null;
}

/** 一所学校能套用哪套作息。`found` 为假时调用方应回退内置通用作息。 */
export interface SchoolTimetableResolution {
  found: boolean;
  /** 实际生效的作息 id（找到专属作息时就是预设里该校的 id） */
  timetableId: string | null;
  /** 作息节次（找到时才非空） */
  periods: { periodNo: number; start: string; end: string }[];
  /** 快照里定位到的作息来源路径 */
  sourcePath: string | null;
  reason: string;
}

/** 专属作息判定：索引有 `timetablePath` + 快照清单能定位 + 生效预设含正文；缺一则套内置通用作息。 */
export function resolveSchoolTimetable(context: PresetContext | null, school: School): SchoolTimetableResolution {
  const miss = (reason: string): SchoolTimetableResolution => ({
    found: false,
    timetableId: null,
    periods: [],
    sourcePath: null,
    reason,
  });

  if (context === null) return miss('预设还在读取中');
  const index = context.index;
  if (index === null) return miss(context.problem ?? '预设索引不可用');

  const entry = findIndexSchool(index, school);
  if (entry === undefined) return miss('预设索引里没有这所学校');
  if (textOf(entry.timetablePath) === null) return miss('预设索引里该校没有作息路径');

  const source = locateTimetableSource(context, entry);
  if (source === null) return miss('快照里没有该校作息');

  const preset = findTimetable(entry.id);
  if (preset === undefined || preset.periods.length === 0) return miss(`生效的预设里没有作息 ${entry.id}`);
  return {
    found: true,
    timetableId: preset.id,
    periods: preset.periods.map((period) => ({ ...period })),
    sourcePath: source.path,
    reason: '',
  };
}

// —— 按学校套用作息（作息卡片与首次引导共用）——

/** 套用结果：`exclusive` 为假表示该校没有专属作息，套的是内置通用作息。 */
export interface SchoolTimetableApplyResult {
  timetableId: string;
  timetableName: string;
  periods: number;
  exclusive: boolean;
  source: string | null;
  /** 一句可直接显示的结果说明 */
  message: string;
}

/** 按学校套用整张时间表：专属作息优先，否则回退内置通用；只在写库失败时抛出。 */
export async function applySchoolTimetable(
  storage: Storage,
  semesterId: string,
  school: School,
): Promise<SchoolTimetableApplyResult> {
  const context = await loadPresetContext(storage);
  const resolution = resolveSchoolTimetable(context, school);
  const exclusive = resolution.found ? findTimetable(resolution.timetableId ?? '') : undefined;
  const chosen = exclusive ?? findTimetable(DEFAULT_TIMETABLE_ID);
  if (chosen === undefined) throw new Error('内置通用作息不可用');
  await replaceTimeSlots(storage, semesterId, presetToTimeSlots(chosen));
  const found = exclusive !== undefined;
  return {
    timetableId: chosen.id,
    timetableName: chosen.name,
    periods: chosen.periods.length,
    exclusive: found,
    source: found ? (resolution.sourcePath ?? chosen.source ?? null) : (chosen.source ?? null),
    message: found
      ? `已套用 ${school.name} 的作息（${chosen.periods.length} 节）`
      : '该校暂无专属作息，已套用通用作息',
  };
}

// —— 内置/已保存教务条目 ↔ 目录学校的入口匹配 ——

/** 一条入口匹配：命中的教务条目 + 已构造好的登录地址。 */
export interface EntryMatch {
  entry: SchoolEntry;
  /** 登录地址：条目只有域名时按系统模板补入口路径，已带路径时原样使用 */
  url: string;
}

/**
 * 给一所目录学校找对应的教务条目，并构造可直接打开的登录地址。
 *
 * 只做**入口匹配与 URL 构造**：校名/拼音/标签/省份的检索统一走 `searchSchools`，
 * 这里只回答「这所学校的内置/已保存入口是哪一个、地址是什么」。
 * 匹配顺序先 id、后校名（`mergeSchools` 已保证同 id 时用户条目优先）。
 */
export function matchingEntrySchools(
  entries: readonly SchoolEntry[],
  school: School,
): EntryMatch | undefined {
  const entry =
    entries.find((item) => item.id === school.id) ?? entries.find((item) => item.name === school.name);
  if (entry === undefined) return undefined;
  return { entry, url: entryUrlFor(entry.system, entry.url) };
}
