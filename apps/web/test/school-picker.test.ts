/**
 * SchoolPicker 的**纯逻辑**测试：筛选、按省份分组、适配徽标判定、学校作息定位、
 * 「请求适配」地址。
 *
 * 为什么只测逻辑：node --test 直接在 Node 里跑源码，而 Node 的类型剥离不支持 `.tsx`
 * （JSX 是语法，不是类型），组件渲染断言只能放冒烟（`apps/web/smoke/entry.tsx`）。
 * 逻辑本身住在 `src/screens/school-picker-model.ts`，组件只是把它渲染出来。
 *
 * 排序口径**不在这里重复实现**：断言直接依赖 core `searchSchools` 的既定排序
 * （精确 > 前缀 > 包含；同分 985 > 211 > 双一流 > 其他），避免两套排序漂移。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PRESET_VERSION, MemoryStorage, findTimetable, type SchoolEntry } from '@dawn-tick/core';
import {
  OTHER_PROVINCE,
  PRESET_ISSUE_NEW_URL,
  REQUEST_SCHOOL_TEMPLATE,
  SCHOOL_RENDER_LIMIT,
  adapterBadgeText,
  adapterInfo,
  extraSchoolTags,
  filterSchools,
  groupSchoolsByProvince,
  limitSchools,
  loadPresetContext,
  matchingEntrySchools,
  primarySchoolTags,
  provinceOptions,
  requestSchoolUrl,
  resolveSchoolTimetable,
  schoolSubtitle,
  type PresetContext,
  type School,
} from '../src/screens/school-picker-model.ts';

/** 目录里的真实学校（跑的是 2659 所那份数据，不是造出来的假条目）。 */
function findByName(name: string): School {
  const school = filterSchools(name).find((item) => item.name === name);
  assert.ok(school !== undefined, `目录里应该有 ${name}`);
  return school;
}

async function builtinContext(): Promise<PresetContext> {
  return loadPresetContext(new MemoryStorage());
}

test('筛选行只露出 985 / 211 / 双一流，其余折叠', () => {
  assert.deepEqual(primarySchoolTags(), ['985', '211', '双一流']);
  const extra = extraSchoolTags();
  assert.ok(extra.length > 10, `折叠标签应该有剩余项，实际 ${extra.length}`);
  for (const tag of ['985', '211', '双一流']) {
    assert.ok(!extra.includes(tag), `${tag} 不该同时出现在折叠标签里`);
  }
  // 标签表缺项时按顺序补齐（补齐项按码元序，结果稳定），保证筛选行不会是空的
  assert.deepEqual(primarySchoolTags(['双一流', '本科', '专科']), ['双一流', '专科', '本科']);
});

test('搜索排序沿用 core 的 searchSchools（精确 > 前缀 > 包含，同分先看层次）', () => {
  assert.equal(filterSchools('清华')[0]?.name, '清华大学');
  assert.equal(filterSchools('beida')[0]?.name, '北京大学', '简称全拼要能压过校名全拼');
  assert.equal(filterSchools('qhdx')[0]?.name, '清华大学', '缩写撞车时同分先出 985');
  assert.equal(filterSchools('北京大学')[0]?.name, '北京大学');
  assert.equal(filterSchools('这所学校肯定不存在').length, 0, '搜不到就是空结果（界面据此显示空态）');
});

test('985 与地区筛选可叠加，且只保留满足条件的学校', () => {
  const elite = filterSchools('', { tag: '985' });
  assert.equal(elite.length, 39);
  assert.ok(elite.every((school) => school.tags.includes('985')));

  const jiangsu = filterSchools('', { province: '江苏' });
  assert.ok(jiangsu.length > 100, `江苏学校数量异常：${jiangsu.length}`);
  assert.ok(jiangsu.every((school) => (school.province ?? '').startsWith('江苏')));

  const both = filterSchools('', { tag: '985', province: '北京' });
  assert.ok(both.length > 0 && both.length < elite.length);
  assert.ok(both.every((school) => school.tags.includes('985') && school.province === '北京市'));
  assert.ok(both.some((school) => school.name === '清华大学'));
});

test('结果按省份分组：已知省份跟下拉同序，没有省份的归「其他」且排最后', () => {
  const fixture: School[] = [
    { id: 'a1', name: '甲大学', tags: [], province: '江苏省' },
    { id: 'a2', name: '乙大学', tags: [], province: '北京市' },
    { id: 'a3', name: '丙大学', tags: [] },
    { id: 'a4', name: '丁大学', tags: [], province: '某未知省' },
    { id: 'a5', name: '戊大学', tags: [], province: '北京市' },
  ];
  const groups = groupSchoolsByProvince(fixture, ['北京市', '江苏省']);
  assert.deepEqual(
    groups.map((group) => group.province),
    ['北京市', '江苏省', '某未知省', OTHER_PROVINCE],
  );
  assert.deepEqual(groups[0]?.schools.map((school) => school.name), ['乙大学', '戊大学'], '组内保持传入顺序');
  assert.deepEqual(groups.at(-1)?.schools.map((school) => school.name), ['丙大学']);

  // 真实数据：搜「清华」的两所都在北京市那一组
  const real = groupSchoolsByProvince(filterSchools('清华'));
  assert.equal(real[0]?.province, '北京市');
  assert.ok(real[0]?.schools.some((school) => school.name === '清华大学'));

  assert.deepEqual(provinceOptions(), provinceOptions());
  assert.ok(provinceOptions().includes('江苏省') && provinceOptions().includes('北京市'));
});

test('结果区只渲染前若干所，避免一次铺 2600 多行', () => {
  const all = filterSchools('');
  assert.ok(all.length > SCHOOL_RENDER_LIMIT, `目录应有 ${SCHOOL_RENDER_LIMIT} 所以上`);
  assert.equal(limitSchools(all).length, SCHOOL_RENDER_LIMIT);

  const few = filterSchools('清华');
  assert.equal(limitSchools(few).length, few.length);
});

test('适配徽标：预设索引里有该系统且有解析脚本才算「已适配」', async () => {
  const context = await builtinContext();
  assert.equal(context.version, BUILTIN_PRESET_VERSION);
  assert.equal(context.kind, 'builtin');
  assert.ok(context.index !== null, `内置索引应该可用：${context.problem ?? ''}`);

  const usts = findByName('苏州科技大学');
  const adapted = adapterInfo(context, usts);
  assert.equal(adapted.adapted, true);
  assert.equal(adapted.systemId, 'jwglxt');
  assert.equal(adapterBadgeText(adapted, context.version), `已适配 ${context.version}`);

  // 目录里没有收录的学校 → 暂未适配（不编造「部分可用/失效」）
  const qinghua = findByName('清华大学');
  const missing = adapterInfo(context, qinghua);
  assert.equal(missing.adapted, false);
  assert.equal(adapterBadgeText(missing, context.version), '暂未适配');
  assert.match(missing.reason, /没有该校教务系统/);

  // 系统存在但没有解析脚本 → 仍然暂未适配，原因说清楚
  const urpSchool: School = { id: 'x1', name: '某校', tags: [], system: 'urp' };
  const noParser = adapterInfo(context, urpSchool);
  assert.equal(noParser.adapted, false);
  assert.equal(noParser.systemId, 'urp');
  assert.match(noParser.reason, /还没有解析脚本/);

  // 索引读不到 / 还没读完：一律暂未适配，不给假徽标
  const broken: PresetContext = {
    version: '1.1.0',
    kind: 'cached',
    index: null,
    problem: '索引坏了',
    snapshot: null,
  };
  assert.equal(adapterInfo(broken, usts).adapted, false);
  assert.equal(adapterInfo(broken, usts).reason, '索引坏了');
  assert.equal(adapterInfo(null, usts).adapted, false);
});

test('学校作息定位：索引 + 快照清单 + 生效预设三者齐备才算有专属作息', async () => {
  const context = await builtinContext();
  const usts = findByName('苏州科技大学');
  const resolution = resolveSchoolTimetable(context, usts);
  assert.equal(resolution.found, true);
  assert.equal(resolution.timetableId, 'usts');
  assert.equal(resolution.sourcePath, 'presets/schools/usts/timetable.json');
  assert.deepEqual(resolution.periods, findTimetable('usts')?.periods);
  assert.ok(resolution.periods.length >= 10);

  // 索引里没有这所学校 → 调用方应回退内置通用作息并提示
  const qinghua = findByName('清华大学');
  const missing = resolveSchoolTimetable(context, qinghua);
  assert.equal(missing.found, false);
  assert.deepEqual(missing.periods, []);
  assert.match(missing.reason, /没有这所学校/);

  // 索引给不出路径 → 同样回退
  const generic: PresetContext = {
    version: '9.9.9',
    kind: 'cached',
    index: {
      _generated: true,
      version: '9.9.9',
      schemaVersion: 1,
      schools: [{ id: 'usts', name: '苏州科技大学', system: 'jwglxt', timetablePath: '', configPath: null }],
      systems: [],
    },
    problem: null,
    snapshot: null,
  };
  assert.equal(resolveSchoolTimetable(generic, usts).found, false);
  assert.match(resolveSchoolTimetable(generic, usts).reason, /没有作息路径/);
});

test('请求适配地址集中在一处，标题带上校名', () => {
  const url = requestSchoolUrl('清华大学');
  assert.ok(url.startsWith(PRESET_ISSUE_NEW_URL));
  assert.ok(url.includes(`template=${REQUEST_SCHOOL_TEMPLATE}`));
  assert.ok(url.includes('title='));
  assert.ok(decodeURIComponent(url).includes('清华大学'));

  const generic = requestSchoolUrl();
  assert.ok(generic.includes(`template=${REQUEST_SCHOOL_TEMPLATE}`));
  assert.ok(decodeURIComponent(generic).includes('提交学校信息'));
  assert.equal(requestSchoolUrl('  '), generic, '空白校名按通用入口处理');
});

test('已保存的教务条目补成一组，且不与目录结果重名', () => {
  const entries: SchoolEntry[] = [
    { id: 'usts', name: '苏州科技大学', system: 'jwglxt', url: 'https://jwgl.usts.edu.cn/', source: 'builtin' },
    { id: 'user-a', name: '我的学校', system: 'other', url: 'jw.mine.edu.cn', source: 'user' },
  ];
  const directory = filterSchools('');
  const extra = matchingEntrySchools(entries, '', directory);
  assert.deepEqual(extra.map((school) => school.name), ['我的学校'], '目录里有的同名学校不重复补一行');
  assert.equal(extra[0]?.system, 'other', '合成行要带上教务系统，适配判定才能按系统维度走');

  assert.deepEqual(matchingEntrySchools([], '我的', directory), []);
  assert.deepEqual(matchingEntrySchools(entries, '苏州科技大学', directory), []);
});

test('次要行是「标签 · 门类」，空标签不留下孤零零的分隔符', () => {
  const subtitle = schoolSubtitle(findByName('清华大学'));
  assert.ok(subtitle.includes('985') && subtitle.includes('综合'), subtitle);
  assert.equal(schoolSubtitle({ id: 'x', name: '无标签学校', tags: [] }), '');
});
