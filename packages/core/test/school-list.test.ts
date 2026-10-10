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
  const schools = matchSchools(BUILTIN_SCHOOLS, '苏科');
  assert.equal(schools.length, 1);
  assert.equal(schools[0]?.name, '苏州科技大学');
  assert.equal(matchSchools(BUILTIN_SCHOOLS, '苏科大').length, 1);
  assert.equal(matchSchools(BUILTIN_SCHOOLS, '苏州科技大学')[0]?.system, 'jwglxt');
  assert.equal(matchSchools(BUILTIN_SCHOOLS, '不存在的学校').length, 0);
  assert.equal(matchSchools(BUILTIN_SCHOOLS, '').length, BUILTIN_SCHOOLS.length);
});

test('自定义学校覆盖同名内置条目', () => {
  const custom: SchoolEntry[] = [
    { id: 'sust', name: '苏州科技大学', system: 'jwglxt', url: 'jw.myschool.edu.cn', source: 'user' },
    { id: 'demo', name: '示例大学', system: 'qzdatasource', url: 'jw.demo.edu.cn', source: 'user' },
  ];
  const merged = mergeSchools(BUILTIN_SCHOOLS, custom);
  assert.equal(merged.length, 2);
  const sust = merged.find((school) => school.id === 'sust');
  assert.equal(sust?.url, 'jw.myschool.edu.cn');
  assert.equal(sust?.source, 'user');
  assert.equal(buildEntryUrl('jwglxt', String(sust?.url)), 'https://jw.myschool.edu.cn/jwglxt/xtgl/login_slogin.html');
});
