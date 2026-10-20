import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_SCHOOLS,
  DIRECTORY_NAMES,
  MANUAL_SCHOOLS,
  SYSTEM_ENTRIES,
  buildEntryUrl,
  entryUrlFor,
  matchSchools,
  mergeSchools,
  suggestSchools,
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

  const suggestions = suggestSchools('苏州科技', { schools: BUILTIN_SCHOOLS, limit: 5 });
  const target = suggestions.find((item) => item.name === '苏州科技大学');
  assert.equal(target?.hasEntry, true, '学校应标记为已有入口');
  assert.equal(entryUrlFor(target?.system ?? 'other', String(target?.url)), 'https://jwgl.usts.edu.cn/jwglxt/xtgl/login_slogin.html');
});

test('可按校名检索教务条目', () => {
  const schools = matchSchools(BUILTIN_SCHOOLS, '苏州科技');
  assert.equal(schools.length, 1);
  assert.equal(schools[0]?.name, '苏州科技大学');
  const byName = matchSchools(BUILTIN_SCHOOLS, '苏州科技大学');
  assert.equal(byName[0]?.name, '苏州科技大学');
  assert.equal(byName[0]?.system, 'jwglxt');
  assert.ok(matchSchools(BUILTIN_SCHOOLS, '苏州').some((school) => school.name === '苏州科技大学'));
  assert.equal(matchSchools(BUILTIN_SCHOOLS, '不存在的学校').length, 0);
  assert.equal(matchSchools(BUILTIN_SCHOOLS, '').length, BUILTIN_SCHOOLS.length);
  // 名单里的校名走候选检索，不带入口信息
  const directoryHit = suggestSchools('安徽电气', {
    schools: BUILTIN_SCHOOLS,
    directory: ['安徽电气工程职业技术学院'],
  });
  assert.ok(directoryHit.some((item) => item.name === '安徽电气工程职业技术学院'));
});

test('三处检索入口对同一关键词给出同一个首条结果', () => {
  // 目录检索、入口检索、候选检索（条目 + 名单）共用 `nameHitScore` 一张权重表：
  // 精确 > 前缀 > 包含，同分按校名，所以同一个关键词的首条必须一致。
  for (const keyword of ['苏州科技', '苏州科技大学']) {
    const directory = searchSchools(keyword)[0]?.name;
    const entry = matchSchools(BUILTIN_SCHOOLS, keyword)[0]?.name;
    const suggestion = suggestSchools(keyword, { schools: BUILTIN_SCHOOLS, limit: 5 })[0]?.name;
    assert.equal(directory, '苏州科技大学', `目录检索首条不对：${keyword} → ${directory ?? '(空)'}`);
    assert.equal(entry, directory, `入口检索与目录检索不一致：${keyword} → ${entry ?? '(空)'}`);
    assert.equal(suggestion, directory, `候选检索与目录检索不一致：${keyword} → ${suggestion ?? '(空)'}`);
  }
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

test('学校数据集中在一个文件且手工段在首位', () => {
  assert.ok(DIRECTORY_NAMES.length >= 2000, `高校名单偏少：${DIRECTORY_NAMES.length}`);
  assert.ok(MANUAL_SCHOOLS.some((school) => school.id === 'usts'), '手工维护段应含苏州科技大学');
  assert.equal(BUILTIN_SCHOOLS.length, MANUAL_SCHOOLS.length);
  const ids = BUILTIN_SCHOOLS.map((school) => school.id);
  assert.equal(new Set(ids).size, ids.length, '学校 id 不应重复');
});

test('下拉候选先给带入口的学校再补名单校名', () => {
  const suggestions = suggestSchools('苏州', {
    schools: BUILTIN_SCHOOLS,
    directory: ['苏州职业大学', '苏州大学'],
    limit: 10,
  });
  assert.ok(
    suggestions.some((item) => item.name === '苏州科技大学' && item.hasEntry),
    '已给出网址的学校应标注已有入口',
  );
  assert.ok(
    suggestions.some((item) => item.name === '苏州大学' && !item.hasEntry),
    '仅名单校名不应标注已有入口',
  );
  const directoryOnly = suggestions.find((item) => item.source === 'directory');
  assert.ok(directoryOnly !== undefined, '名单里独有的学校应作为候选补充');
  assert.equal(directoryOnly?.hasEntry, false);
  assert.equal(directoryOnly?.url, '');
  assert.equal(directoryOnly?.id, null);
  const names = suggestions.map((item) => item.name);
  assert.equal(new Set(names).size, names.length, '候选不应出现同名重复');
  assert.ok(
    suggestions.some((item) => item.name === '苏州职业大学'),
    '名单校名应出现在候选里',
  );

  const many = suggestSchools('大学', {
    schools: BUILTIN_SCHOOLS,
    directory: ['示例大学', '样例大学', '测试大学', '模板大学', '演示大学', '范例大学', '参考大学'],
    limit: 6,
  });
  assert.equal(many.length, 6, '候选数量应受 limit 限制');
  const empty = suggestSchools('', { schools: BUILTIN_SCHOOLS, directory: ['示例职业学院'], limit: 4 });
  assert.equal(empty.length, Math.min(4, BUILTIN_SCHOOLS.length));
  assert.ok(
    empty.every((item) => item.source !== 'directory'),
    '空查询只列带入口的条目',
  );
});

test('高校名单数据可用于检索', () => {
  assert.ok(DIRECTORY_NAMES.length >= 2000, `名单条目偏少：${DIRECTORY_NAMES.length}`);
  assert.ok(DIRECTORY_NAMES.includes('北京大学') || DIRECTORY_NAMES.includes('清华大学'));
  const hit = suggestSchools('深圳职业技术', { schools: BUILTIN_SCHOOLS, directory: DIRECTORY_NAMES, limit: 5 });
  assert.ok(hit.length >= 1);
});
