import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_SCHOOLS,
  MANUAL_SCHOOLS,
  SYSTEM_ENTRIES,
  buildEntryUrl,
  entryUrlFor,
  mergeSchools,
  systemEntry,
  type SchoolEntry,
} from '../src/import/school-list.ts';
import { searchSchools } from '../src/schools/index.ts';

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

test('已有具体路径的入口按原样使用', () => {
  const usts = BUILTIN_SCHOOLS.find((school) => school.id === 'usts');
  assert.equal(usts?.name, '苏州科技大学');
  assert.equal(usts?.system, 'jwglxt');
  assert.equal(usts?.url, 'https://jwgl.usts.edu.cn/jwglxt/xtgl/login_slogin.html');
  assert.equal(
    entryUrlFor('jwglxt', String(usts?.url)),
    'https://jwgl.usts.edu.cn/jwglxt/xtgl/login_slogin.html',
    '带路径的入口不应被系统模板改写',
  );
  assert.equal(
    entryUrlFor('jwglxt', 'jwgl.usts.edu.cn'),
    'https://jwgl.usts.edu.cn/jwglxt/xtgl/login_slogin.html',
    '纯域名才按系统模板补齐',
  );
  assert.equal(
    entryUrlFor('other', 'https://jw.example.edu.cn/portal/index.html#/hall'),
    'https://jw.example.edu.cn/portal/index.html#/hall',
  );
  assert.equal(entryUrlFor('jwglxt', ''), '');

});

test('内置条目可用且系统模板覆盖四种', () => {
  assert.ok(BUILTIN_SCHOOLS.length >= 1, `内置学校数量偏少：${BUILTIN_SCHOOLS.length}`);
  const systems = new Set(BUILTIN_SCHOOLS.map((school) => school.system));
  assert.ok(systems.has('jwglxt'), '应包含正方教务学校');
  for (const school of BUILTIN_SCHOOLS) {
    assert.ok(school.id.length > 0 && school.name.length > 0);
    if (school.url.length > 0) {
      assert.match(school.url, /^https?:\/\//, `${school.name} 的网址格式不对：${school.url}`);
    }
    assert.equal(school.source, 'builtin');
  }
  const withUrl = BUILTIN_SCHOOLS.filter((school) => school.url.length > 0);
  assert.ok(withUrl.length >= 1);
  assert.deepEqual(
    SYSTEM_ENTRIES.map((entry) => entry.id).sort(),
    ['jwglxt', 'other', 'qzdatasource', 'urp'],
  );
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

test('内置学校即手工维护段，id 不重复', () => {
  assert.ok(MANUAL_SCHOOLS.some((school) => school.id === 'usts'), '手工维护段应含苏州科技大学');
  assert.equal(BUILTIN_SCHOOLS.length, MANUAL_SCHOOLS.length);
  const ids = BUILTIN_SCHOOLS.map((school) => school.id);
  assert.equal(new Set(ids).size, ids.length, '学校 id 不应重复');
});

test('校名检索走高校名单目录', () => {
  assert.equal(searchSchools('苏州科技大学')[0]?.name, '苏州科技大学');
  assert.equal(searchSchools('苏州科技')[0]?.name, '苏州科技大学');
});
