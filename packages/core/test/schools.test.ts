import test from 'node:test';
import assert from 'node:assert/strict';
import directoryJson from '../src/schools/directory.json' with { type: 'json' };
import {
  SCHOOL_TAGS,
  getSchool,
  listProvinces,
  listSchools,
  searchSchools,
  type School,
} from '../src/schools/index.ts';

const DIRECTORY = directoryJson as unknown as {
  _generated?: unknown;
  _generatedBy?: unknown;
  _source?: Record<string, unknown>;
  _stats?: Record<string, unknown>;
  schools: School[];
};

const names = (schools: readonly School[]): string[] => schools.map((school) => school.name);

test('目录带生成标记与来源字段', () => {
  assert.equal(DIRECTORY._generated, true);
  assert.equal(DIRECTORY._generatedBy, 'tools/schools/import-directory.mjs');
  const source = DIRECTORY._source;
  assert.ok(source !== undefined, '_source 必须存在');
  for (const key of ['root', 'index', 'details', 'regions', 'pinyinTable', 'policy']) {
    assert.ok(key in source, `_source 缺少 ${key}`);
  }
  assert.equal((source.xls as { used?: unknown }).used, false, 'xls 只作对账参考，不参与生成');
  assert.equal(DIRECTORY.schools.length, listSchools().length, '_stats 与实际条目数一致');
  assert.equal(DIRECTORY._stats?.count, DIRECTORY.schools.length);
});

test('学校总数合理且 id 唯一', () => {
  const schools = listSchools();
  assert.ok(schools.length >= 2000, `学校总数应 ≥ 2000，实际 ${schools.length}`);
  const ids = new Set<string>();
  for (const school of schools) {
    assert.equal(typeof school.id, 'string');
    assert.ok(school.id.length > 0, `${school.name} 的 id 为空`);
    assert.ok(!ids.has(school.id), `id 重复：${school.id}（${school.name}）`);
    ids.add(school.id);
  }
  assert.equal(ids.size, schools.length);
});

test('按中文全名搜索命中', () => {
  const hit = searchSchools('清华大学');
  assert.ok(names(hit).includes('清华大学'), '「清华大学」应命中清华大学');
  assert.equal(hit[0]?.name, '清华大学', '精确命中排第一');
});

test('按中文简称搜索命中', () => {
  const hit = searchSchools('北大');
  assert.ok(names(hit).includes('北京大学'), '「北大」应命中北京大学');
  const qinghua = listSchools().find((school) => school.name === '清华大学');
  assert.equal(qinghua?.shortName, '清华');
  assert.ok(names(searchSchools('清华')).includes('清华大学'), '简称「清华」应命中清华大学');
});

test('按拼音全拼搜索命中', () => {
  const hit = searchSchools('qinghuadaxue');
  assert.equal(hit[0]?.name, '清华大学');
  assert.ok(names(searchSchools('qing hua da xue')).includes('清华大学'), '拼音键忽略空格');
  assert.ok(names(searchSchools('QINGHUADAXUE')).includes('清华大学'), '拼音键大小写不敏感');
});

test('按拼音首字母缩写搜索命中', () => {
  const hit = searchSchools('qhdx');
  assert.equal(hit[0]?.name, '清华大学', '「qhdx」应命中清华大学');
  assert.ok(names(searchSchools('QHDX')).includes('清华大学'), '首字母缩写大小写不敏感');
  assert.ok(names(searchSchools('xmdx')).includes('厦门大学'), '多音字「厦」按 xia 取首字母');
  assert.ok(names(searchSchools('cqdx')).includes('重庆大学'), '多音字「重」取 chong');
});

test('按简称全拼搜索命中（`beida` → 北京大学）', () => {
  // 校名全拼 `beijingdaxue` 既不以 `beida` 开头也不含它，所以这条只能靠 shortPinyin
  assert.equal(searchSchools('beida')[0]?.name, '北京大学', '「beida」的第一条必须是北京大学');
  assert.equal(searchSchools('bei da')[0]?.name, '北京大学', '简称拼音也忽略空格');
  assert.equal(searchSchools('BEIDA')[0]?.name, '北京大学', '简称拼音大小写不敏感');
  assert.equal(searchSchools('qinghua')[0]?.name, '清华大学', '「qinghua」命中清华（全拼是 qinghuadaxue）');
  assert.ok(names(searchSchools('nanda')).includes('南京大学'), '「nanda」应能命中南京大学');

  // 字段本身：简称 + 简称全拼成对出现，且拼音是从简称生成的小写字母
  const beida = searchSchools('北大')[0];
  assert.equal(beida?.shortName, '北大');
  assert.equal(beida?.shortPinyin, 'beida');
  const qinghua = listSchools().find((school) => school.name === '清华大学');
  assert.equal(qinghua?.shortName, '清华');
  assert.equal(qinghua?.shortPinyin, 'qinghua');

  let shortNames = 0;
  let shortPinyins = 0;
  for (const school of listSchools()) {
    if (school.shortName !== undefined) {
      shortNames += 1;
      if (school.shortPinyin !== undefined) {
        shortPinyins += 1;
        assert.match(school.shortPinyin, /^[a-z]+$/, `${school.name} 的 shortPinyin 应为小写拼音`);
        assert.equal(
          school.shortPinyin.length > 0,
          true,
          `${school.name} 的 shortPinyin 不该为空串（没把握时应当整个字段不产出）`,
        );
      }
    } else {
      assert.equal(school.shortPinyin, undefined, `${school.name} 没有简称就不该有简称拼音`);
    }
  }
  assert.ok(shortNames >= 380, `带简称的条目偏少：${shortNames}`);
  // 绝大多数简称都能注音；极少数（拼音表未覆盖的汉字）整个字段不产出，宁可没有也不给半截拼音
  assert.ok(
    shortPinyins >= shortNames - 10 && shortPinyins <= shortNames,
    `简称全拼覆盖异常：${shortPinyins}/${shortNames}`,
  );
});

test('按标签筛选', () => {
  const hit = searchSchools('', { tags: ['985'] });
  assert.ok(hit.length >= 30, `985 学校数量偏少：${hit.length}`);
  assert.ok(names(hit).includes('清华大学'));
  for (const school of hit) assert.ok(school.tags.includes('985'), `${school.name} 没有 985 标签`);

  const both = searchSchools('', { tags: ['211', '本科'] });
  assert.ok(both.length > 0);
  for (const school of both) {
    assert.ok(school.tags.includes('211'));
    assert.ok(school.tags.includes('本科'));
  }
  assert.ok(hit.length < listSchools().length, '筛选应当真的收窄结果');
});

test('按省份筛选并支持简写', () => {
  const full = searchSchools('', { province: '北京市' });
  assert.ok(full.length > 50, `北京市学校数量偏少：${full.length}`);
  for (const school of full) assert.equal(school.province, '北京市');

  const short = searchSchools('', { province: '北京' });
  assert.equal(short.length, full.length, '「北京」应当等价于「北京市」');

  const withCategory = searchSchools('', { province: '北京市', category: '理工' });
  assert.ok(withCategory.length > 0);
  for (const school of withCategory) {
    assert.equal(school.province, '北京市');
    assert.equal(school.category, '理工');
  }
  assert.equal(
    searchSchools('', { province: '北京市', category: '理工类' }).length,
    withCategory.length,
    '门类带不带「类」等价',
  );
});

test('空查询返回全部，筛选条件仍然生效', () => {
  assert.equal(searchSchools('').length, listSchools().length);
  assert.equal(searchSchools('   ').length, listSchools().length);
  const filtered = searchSchools('   ', { province: '广东省' });
  assert.ok(filtered.length > 0 && filtered.length < listSchools().length);
});

test('字段缺失的条目不会崩', () => {
  const macau = searchSchools('澳门大学')[0];
  assert.equal(macau?.name, '澳门大学');
  assert.equal(macau?.tags.length, 0, '港澳台条目没有来源标签');
  assert.equal(macau?.category, undefined);
  assert.equal(macau?.city, undefined);
  assert.ok(names(searchSchools('aomen')).includes('澳门大学'), '只有拼音的条目也能检索到');
  assert.equal(getSchool('不存在的-id'), undefined);

  for (const school of listSchools()) {
    assert.equal(typeof school.name, 'string');
    assert.ok(Array.isArray(school.tags));
    assert.equal(school.system, undefined, '教务系统一律留空');
    assert.ok(
      school.shortPinyin === undefined || typeof school.shortPinyin === 'string',
      `${school.name} 的 shortPinyin 只允许缺失或字符串`,
    );
  }
});

test('标签与省份清单可用于筛选 UI', () => {
  assert.ok(SCHOOL_TAGS.includes('985'));
  assert.ok(SCHOOL_TAGS.includes('211'));
  assert.ok(SCHOOL_TAGS.includes('双一流'));
  assert.equal(new Set(SCHOOL_TAGS).size, SCHOOL_TAGS.length, '标签清单不应重复');

  const provinces = listProvinces();
  assert.ok(provinces.length >= 30, `省级行政区数量偏少：${provinces.length}`);
  assert.ok(provinces.includes('北京市'));
  assert.ok(provinces.includes('广东省'));
  assert.equal(new Set(provinces).size, provinces.length);
});

test('搜索结果稳定且不返回重复项', () => {
  const first = names(searchSchools('大学'));
  const second = names(searchSchools('大学'));
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length, '同一所学校不应出现两次');
  const ids = searchSchools('大学').map((school) => school.id);
  assert.equal(new Set(ids).size, ids.length);
});
