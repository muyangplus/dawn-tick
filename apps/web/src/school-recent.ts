import { getSchool, searchSchools, type Storage, type School } from '@dawn-tick/core';
import { readMetaJson, writeMetaJson } from './lib/meta.ts';
import { RECENT_SCHOOL_META_KEY } from './lib/meta-keys.ts';

export { RECENT_SCHOOL_META_KEY };

export interface RecentSchool {
  id: string;
  name: string;
}

/** 校验 `{ id, name }`：id 必须是非空字符串，name 缺失时退回 id。 */
function parseRecentSchool(value: unknown): RecentSchool | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = record['id'];
  if (typeof id !== 'string' || id === '') return null;
  return { id, name: typeof record['name'] === 'string' ? record['name'] : id };
}

/**
 * 读上次选的学校：优先按 id 回目录取；id 对不上按校名精确匹配；都找不到则只回 id 与校名。
 */
export async function readRecentSchool(storage: Storage): Promise<School | null> {
  const parsed = await readMetaJson<RecentSchool | null>(storage, RECENT_SCHOOL_META_KEY, {
    parse: parseRecentSchool,
    fallback: null,
    scope: 'school',
  });
  if (parsed === null) return null;
  const known = getSchool(parsed.id) ?? searchSchools(parsed.name).find((item) => item.name === parsed.name);
  if (known !== undefined) return known;
  return { id: parsed.id, name: parsed.name, tags: [] };
}

/** 记下这次选的学校：导入流程与作息页共用同一个键。 */
export async function writeRecentSchool(storage: Storage, school: School): Promise<void> {
  const payload: RecentSchool = { id: school.id, name: school.name };
  await writeMetaJson(storage, RECENT_SCHOOL_META_KEY, payload, { scope: 'school' });
}
