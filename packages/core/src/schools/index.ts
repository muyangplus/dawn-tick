/**
 * 学校富目录：从公开高校数据整理出来的**本地检索索引**（零依赖、纯数据）。
 *
 * 数据来源与生成方式见 `directory.json` 顶部的 `_source` 字段与
 * `tools/schools/README.md`。一句话：`大学目录.json`（校名索引）+
 * `大学详情/*.json`（标签/简介）+ `各行政区大学列表/*.json`（教育部名单：
 * 代码、省市、层次）三份只读数据，经 `node tools/schools/import-directory.mjs`
 * 合并生成。**数据源更新后必须重跑那个脚本**，本文件不要手改。
 *
 * 本模块只做「取数 + 检索」，不碰网络、不读文件系统、不含任何第三方依赖：
 * `directory.json` 在打包期被 import 进来，浏览器/Node/打包产物拿到的是同一份。
 *
 * 字段取舍（详见 tools/schools/README.md）：
 * - 只保留结构化短字段；logo、图片外链、简介长文本一律不入库。
 * - `system`（教务系统）在数据源里无从判断，一律留空——真要接教务入口，
 *   走 `src/import/schools.ts` 的 `MANUAL_SCHOOLS` 或用户自定义学校。
 *
 * 检索口径：
 * - 中文全名 / 中文简称 / **简称全拼** / 校名拼音全拼 / 拼音首字母缩写，五种键都可以命中；
 * - 大小写不敏感，拼音键忽略空格（`qing hua` 等价于 `qinghua`）；
 * - 空查询返回全部（仍然会套用筛选条件）。
 */
import directoryJson from './directory.json' with { type: 'json' };

/** 一所学校的检索条目；除 `id`/`name`/`tags` 外都可能缺失。 */
export interface School {
  /** 稳定唯一标识：教育部学校代码（如 `4111010003`），没有代码时是 `x-<拼音>`。 */
  id: string;
  /** 校名全称。 */
  name: string;
  /** 简介里写明的中文简称（如「清华」「北大」），数据源没写就留空。 */
  shortName?: string;
  /**
   * 简称的无声调全拼（如 `qinghua`、`beida`），由 `tools/schools/import-directory.mjs`
   * 用同一张拼音表从 `shortName` 生成。
   *
   * 为什么单独存一档：用户更常按**简称的读音**搜（`beida` → 北京大学），
   * 而校名全拼 `beijingdaxue` 既不以 `beida` 开头也不包含它，只靠 `pinyin` 是搜不到的。
   * 少数简称含拼音表未覆盖的汉字时整个字段不产出（宁可没有，也不给缺字的半截拼音）。
   */
  shortPinyin?: string;
  /** 省级行政区（如「北京市」「广东省」「香港」）。 */
  province?: string;
  /** 城市（如「广州市」）；港澳台与个别军队院校没有。 */
  city?: string;
  /** 标签，如 `['综合类','双一流','985','211','本科']`。 */
  tags: string[];
  /** 门类，由标签里的「XX类」推出（如 `综合`、`理工`、`师范`）。 */
  category?: string;
  /** 校名全拼，无声调小写连写（如 `qinghuadaxue`）。 */
  pinyin?: string;
  /** 校名拼音首字母缩写（如 `qhdx`）。 */
  initials?: string;
  /** 教务系统标识；当前数据源无法判断，一律为空。 */
  system?: string;
}

/** 检索筛选条件；`tags` 是「全都要满足」，多个条件之间是与关系。 */
export interface SearchSchoolsOptions {
  /** 需要的标签（大小写不敏感），例如 `['985']`、`['211','本科']`。 */
  tags?: string[];
  /** 省级行政区；允许简写，`北京` 能匹配到 `北京市`。 */
  province?: string;
  /** 门类，带不带「类」都行：`理工` 与 `理工类` 等价。 */
  category?: string;
}

interface DirectoryFile {
  readonly _generated: boolean;
  readonly _generatedBy: string;
  readonly _source: Readonly<Record<string, unknown>>;
  readonly _stats: Readonly<Record<string, number>>;
  readonly schools: readonly School[];
}

const DIRECTORY = directoryJson as unknown as DirectoryFile;

/** 目录里的全部学校，顺序是生成时的固定顺序（拼音 → 校名），可直接当列表渲染。 */
const ALL: readonly School[] = DIRECTORY.schools;

/** `SCHOOL_TAGS`：目录里出现过的全部标签，码元序（UI 若要排序可自行再排）。 */
export const SCHOOL_TAGS: readonly string[] = (() => {
  const seen = new Set<string>();
  for (const school of ALL) {
    for (const tag of school.tags) seen.add(tag);
  }
  return [...seen].sort();
})();

const PROVINCES: readonly string[] = (() => {
  const seen = new Set<string>();
  for (const school of ALL) {
    if (school.province !== undefined) seen.add(school.province);
  }
  return [...seen].sort();
})();

let byId: Map<string, School> | undefined;

/** 全部学校（只读视图，不要原地改；需要副本请自己 `slice()`）。 */
export function listSchools(): readonly School[] {
  return ALL;
}

/** 按 id 取学校；找不到返回 `undefined`。 */
export function getSchool(id: string): School | undefined {
  if (byId === undefined) {
    byId = new Map();
    for (const school of ALL) byId.set(school.id, school);
  }
  return byId.get(id);
}

/** 全部省级行政区（码元序），用于筛选下拉框。 */
export function listProvinces(): string[] {
  return [...PROVINCES];
}

function matchesFilters(school: School, options: SearchSchoolsOptions): boolean {
  const wantedTags = options.tags;
  if (wantedTags !== undefined && wantedTags.length > 0) {
    const owned = school.tags.map((tag) => tag.toLowerCase());
    for (const tag of wantedTags) {
      const wanted = tag.trim().toLowerCase();
      if (wanted.length === 0) continue;
      if (!owned.includes(wanted)) return false;
    }
  }

  const wantedProvince = options.province?.trim();
  if (wantedProvince !== undefined && wantedProvince.length > 0) {
    const province = school.province;
    if (province === undefined) return false;
    const hit =
      province === wantedProvince || province.startsWith(wantedProvince) || wantedProvince.startsWith(province);
    if (!hit) return false;
  }

  const rawCategory = options.category?.trim();
  if (rawCategory !== undefined && rawCategory.length > 0) {
    const wanted = rawCategory.replace(/类$/u, '');
    if (school.category === undefined || school.category !== wanted) return false;
  }

  return true;
}

/**
 * 名称/简称的命中档位：整串相等 > 作为前缀 > 出现在中间，**同一档里校名优先于简称**。
 * 返回值就是 `scoreOf` 的前六档（100/96/92/90/84/82），0 表示没命中。
 *
 * 单独导出（而不是在 `scoreOf` 里内联）是为了让其它「按校名检索」的入口——
 * `import/school-list.ts` 的 `matchSchools` 与 `suggestSchools`——复用**同一张权重表**：
 * 同一个关键词在目录检索与入口检索两条路径上必须排出同一个首条结果。
 *
 * `query` 由调用方先做 `trim().toLowerCase()`；这里只负责把校名/简称转小写。
 */
export function nameHitScore(name: string, shortName: string, query: string): number {
  const full = name.toLowerCase();
  const short = shortName.toLowerCase();
  if (full === query) return 100;
  if (short.length > 0 && short === query) return 96;
  if (full.startsWith(query)) return 92;
  if (short.length > 0 && short.startsWith(query)) return 90;
  if (full.includes(query)) return 84;
  if (short.length > 0 && short.includes(query)) return 82;
  return 0;
}

/**
 * 命中得分；0 表示没命中。分数只用于排序，数值本身没有对外含义。
 *
 * 次序是「整串相等 > 作为前缀 > 出现在中间」，且**同一档里校名与简称同级**：
 * 查询 `北大` 时「北京大学」靠简称整串相等（96）赢过「东北大学」的中间命中（84），
 * 这正是简称检索要解决的问题。
 *
 * 拼音部分同理分两档：**简称全拼**（94/88/80）优先于首字母缩写（66…）与校名全拼（58…）。
 * 简称全拼命中的是「用户按读音念出来的那个简称」——`beida` 只可能是北京大学；
 * 而校名全拼只是碰巧包含同样的字母时，多半是噪声。反过来说，`beijingdaxue`
 * 不会被简称全拼 `beida` 抢走：`shortPinyin.startsWith(query)` 为假。
 */
function scoreOf(school: School, query: string, compact: string): number {
  const nameScore = nameHitScore(school.name, school.shortName ?? '', query);
  if (nameScore > 0) return nameScore;

  if (compact.length === 0) return 0;
  const initials = school.initials ?? '';
  const pinyin = school.pinyin ?? '';
  const shortPinyin = school.shortPinyin ?? '';
  if (shortPinyin.length > 0 && shortPinyin === compact) return 94;
  if (shortPinyin.length > 0 && shortPinyin.startsWith(compact)) return 88;
  if (shortPinyin.length > 0 && shortPinyin.includes(compact)) return 80;
  if (initials === compact) return 66;
  if (initials.startsWith(compact)) return 62;
  if (pinyin === compact) return 58;
  if (pinyin.startsWith(compact)) return 54;
  if (initials.includes(compact)) return 48;
  if (pinyin.includes(compact)) return 44;
  return 0;
}

function compareSchools(left: School, right: School): number {
  const leftKey = left.pinyin ?? left.name;
  const rightKey = right.pinyin ?? right.name;
  if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/**
 * 办学层次权重，只作**同分时的次序**用：缩写撞车很常见
 * （`qhdx` 同时是清华大学与青海大学），先出层次更高的那所更符合直觉。
 * 它不参与打分，不会把「文字更贴近」的结果压下去。
 */
function prominence(school: School): number {
  if (school.tags.includes('985')) return 0;
  if (school.tags.includes('211')) return 1;
  if (school.tags.includes('双一流')) return 2;
  return 3;
}

/**
 * 检索学校。
 *
 * - `query` 可以是中文全名、中文简称、简称全拼（`beida`）、校名拼音全拼或拼音首字母缩写；
 * - 空字符串（或纯空白）返回全部学校，顺序与 `listSchools()` 一致；
 * - 命中的结果按「精确 > 前缀 > 包含」排序；同分时先看办学层次
 *   （985 > 211 > 双一流 > 其他），再看拼音/校名，结果稳定可预期。
 */
export function searchSchools(query: string, options: SearchSchoolsOptions = {}): School[] {
  const trimmed = query.trim();
  const normalized = trimmed.toLowerCase();
  const compact = normalized.replace(/\s+/gu, '');

  const hits: Array<{ school: School; score: number }> = [];
  for (const school of ALL) {
    if (!matchesFilters(school, options)) continue;
    if (normalized.length === 0) {
      hits.push({ school, score: 0 });
      continue;
    }
    const score = scoreOf(school, normalized, compact);
    if (score > 0) hits.push({ school, score });
  }

  if (normalized.length === 0) return hits.map((hit) => hit.school);
  hits.sort(
    (left, right) =>
      right.score - left.score ||
      prominence(left.school) - prominence(right.school) ||
      compareSchools(left.school, right.school),
  );
  return hits.map((hit) => hit.school);
}
