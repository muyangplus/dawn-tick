import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_SCHOOLS,
  SYSTEM_ENTRIES,
  buildEntryUrl,
  matchSchools,
  mergeSchools,
  systemEntry,
  type SchoolEntry,
} from '../src/import/school-list.ts';

test('教务系统入口模板齐全', () => {
  assert.equal(SYSTEM_ENTRIES.length, 4);
  assert.equal(systemEntry('jwglxt').loginPath, '/jwglxt/xtgl/login_slogin.html');
  assert.equal(systemEntry('qzdatasource').loginPath, '/jsxsd/');
  assert.equal(systemEntry('other').label, '其他教务');
});

test('由域名或地址拼出入口', () => {
  assert.equal(buildEntryUrl('jwglxt', 'jw.example.edu.cn'), 'https://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html');
  assert.equal(
    buildEntryUrl('jwglxt', 'http://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html'),
    'http://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html',
  );
  assert.equal(buildEntryUrl('qzdatasource', 'https://jw.example.edu.cn/other/path'), 'https://jw.example.edu.cn/jsxsd/');
  assert.equal(buildEntryUrl('jwglxt', 'jw.example.edu.cn', false), 'https://jw.example.edu.cn');
  assert.equal(buildEntryUrl('jwglxt', '   '), '');
});

test('可按名称与简称检索', () => {
  const schools = matchSchools(BUILTIN_SCHOOLS, '苏科大');
  assert.equal(schools.length, 1);
  assert.equal(schools[0]?.name, '苏州科技大学');
  const byName = matchSchools(BUILTIN_SCHOOLS, '苏州科技大学');
  assert.equal(byName[0]?.name, '苏州科技大学');
  assert.equal(byName[0]?.system, 'jwglxt');
  assert.ok(matchSchools(BUILTIN_SCHOOLS, '苏科').some((school) => school.name === '苏州科技大学'));
  assert.equal(matchSchools(BUILTIN_SCHOOLS, '不存在的学校').length, 0);
  assert.equal(matchSchools(BUILTIN_SCHOOLS, '').length, BUILTIN_SCHOOLS.length);
  // 上游仓库条目可按校名与代码检索
  assert.ok(matchSchools(BUILTIN_SCHOOLS, '安徽电气').length >= 1);
  assert.ok(matchSchools(BUILTIN_SCHOOLS, 'SUSTECH').length >= 1);
});

test('内置列表来自上游适配仓库且条目可用', () => {
  assert.ok(BUILTIN_SCHOOLS.length >= 200, `内置学校数量偏少：${BUILTIN_SCHOOLS.length}`);
  const systems = new Set(BUILTIN_SCHOOLS.map((school) => school.system));
  assert.ok(systems.has('jwglxt'), '应包含正方教务学校');
  assert.ok(systems.has('other'));
  for (const school of BUILTIN_SCHOOLS) {
    assert.ok(school.id.length > 0 && school.name.length > 0);
    if (school.url.length > 0) {
      assert.match(school.url, /^https?:\/\//, `${school.name} 的网址格式不对：${school.url}`);
    }
    assert.equal(school.source, 'builtin');
  }
  const withUrl = BUILTIN_SCHOOLS.filter((school) => school.url.length > 0);
  assert.ok(withUrl.length >= 200, `带入口地址的条目偏少：${withUrl.length}`);
});

test('自定义学校覆盖同名内置条目', () => {
  const custom: SchoolEntry[] = [
    { id: 'usts', name: '苏州科技大学', system: 'jwglxt', url: 'jw.myschool.edu.cn', source: 'user' },
    { id: 'demo', name: '示例大学', system: 'qzdatasource', url: 'jw.demo.edu.cn', source: 'user' },
  ];
  const merged = mergeSchools(BUILTIN_SCHOOLS, custom);
  assert.equal(merged.length, BUILTIN_SCHOOLS.length + 1, '同 id 覆盖不新增，新 id 追加一条');
  const sust = merged.find((school) => school.id === 'usts');
  assert.equal(sust?.url, 'jw.myschool.edu.cn');
  assert.equal(sust?.source, 'user');
  assert.equal(buildEntryUrl('jwglxt', String(sust?.url)), 'https://jw.myschool.edu.cn/jwglxt/xtgl/login_slogin.html');
  assert.ok(merged.some((school) => school.id === 'demo'));
});
