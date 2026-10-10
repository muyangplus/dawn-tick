export type SchoolSystem = 'jwglxt' | 'qzdatasource' | 'urp' | 'other';

export interface SystemEntry {
  id: SchoolSystem;
  label: string;
  /** 登录入口路径，拼接在学校域名之后 */
  loginPath: string;
  hint: string;
}

/** 教务系统入口模板：路径来自各系统本身的固定写法。 */
export const SYSTEM_ENTRIES: readonly SystemEntry[] = [
  { id: 'jwglxt', label: '正方教务', loginPath: '/jwglxt/xtgl/login_slogin.html', hint: '个人课表查询在「信息查询 → 学生课表查询」' },
  { id: 'qzdatasource', label: '强智教务', loginPath: '/jsxsd/', hint: '课表在「培养管理 → 我的课表」' },
  { id: 'urp', label: 'URP 教务', loginPath: '/', hint: '综合教务系统，课表在「课表查询」' },
  { id: 'other', label: '其他教务', loginPath: '/', hint: '自行登录后打开课表页' },
];

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
 * 内置学校。网址需与学校实际情况核对，界面里可编辑并保存到本地。
 * 未收录的学校可用「教务系统入口」直接填域名。
 */
export const BUILTIN_SCHOOLS: readonly SchoolEntry[] = [
  {
    id: 'sust',
    name: '苏州科技大学',
    system: 'jwglxt',
    url: '',
    aliases: ['苏科大', '苏州科技'],
    source: 'builtin',
  },
];

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
