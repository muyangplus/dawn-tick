import { getSchool, searchSchools, type Storage, type School } from '@dawn-tick/core';

/** 记住「上次选的学校」用的 meta 键。 */
export const RECENT_SCHOOL_META_KEY = 'recent_school';

export interface RecentSchool {
  id: string;
  name: string;
}

/**
 * 读上次选的学校：优先按 id 回目录取；id 对不上按校名精确匹配；都找不到则只回 id 与校名。
 */
export async function readRecentSchool(storage: Storage): Promise<School | null> {
  const raw = await storage.readMeta(RECENT_SCHOOL_META_KEY);
  if (raw === null || raw === undefined || raw === '') return null;
  let parsed: RecentSchool;
  try {
    const value = JSON.parse(raw) as Partial<RecentSchool>;
    if (typeof value.id !== 'string' || value.id === '') return null;
    parsed = { id: value.id, name: typeof value.name === 'string' ? value.name : value.id };
  } catch {
    return null;
  }
  const known = getSchool(parsed.id) ?? searchSchools(parsed.name).find((item) => item.name === parsed.name);
  if (known !== undefined) return known;
  return { id: parsed.id, name: parsed.name, tags: [] };
}

/** 记下这次选的学校：导入页与作息页共用同一个键。 */
export async function writeRecentSchool(storage: Storage, school: School): Promise<void> {
  const payload: RecentSchool = { id: school.id, name: school.name };
  await storage.writeMeta(RECENT_SCHOOL_META_KEY, JSON.stringify(payload));
}
