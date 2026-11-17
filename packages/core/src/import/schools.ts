/**
 * 手工维护的教务入口条目。校名检索用的全国高校名单在 `src/schools/directory.json`（见 `schools/index.ts`）。
 * 新增学校：写进下面的数组，字段为
 *   id（唯一）、name（校名）、system（jwglxt | qzdatasource | urp | other）、
 *   url（教务入口完整地址，或只写域名）、source: 'builtin'
 */
import type { SchoolEntry } from './school-list.ts';

export const MANUAL_SCHOOLS: readonly SchoolEntry[] = [
  {
    id: 'usts',
    name: '苏州科技大学',
    system: 'jwglxt',
    url: 'https://jwgl.usts.edu.cn/jwglxt/xtgl/login_slogin.html',
    source: 'builtin',
  },
];
