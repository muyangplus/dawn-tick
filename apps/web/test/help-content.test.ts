import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HELP_CATEGORIES,
  HELP_ENTRY_COUNT,
  findHelpEntry,
  searchHelp,
} from '../src/help/help-content.ts';

/** 帮助页的内容与搜索契约：分类齐全、每条可引导、搜索覆盖标题/关键词/正文。 */

const SETTINGS_GROUPS = new Set(['semesters', 'reminders', 'appearance', 'timetable', 'slots', 'widget', 'time']);
const DEVICES_GROUPS = new Set(['storage', 'backup', 'update', 'webdav', 'lan', 'maintenance', 'about']);

test('帮助分类覆盖八类常见问题，分类与条目 id 都唯一', () => {
  assert.equal(HELP_CATEGORIES.length, 8);
  assert.equal(new Set(HELP_CATEGORIES.map((category) => category.id)).size, 8);
  const entryIds = HELP_CATEGORIES.flatMap((category) => category.entries.map((entry) => entry.id));
  assert.equal(new Set(entryIds).size, entryIds.length);
  assert.equal(HELP_ENTRY_COUNT, entryIds.length);
});

test('每条帮助都有标题、一句话说明、关键词与至少两步引导', () => {
  for (const category of HELP_CATEGORIES) {
    assert.ok(category.title.length > 0, category.id);
    assert.ok(category.description.length > 0, category.id);
    for (const entry of category.entries) {
      assert.ok(entry.title.length > 0, entry.id);
      assert.ok(entry.summary.length > 0, entry.id);
      assert.ok(entry.keywords.length >= 2, `${entry.id} 关键词`);
      assert.ok(entry.steps.length >= 2, `${entry.id} 步骤`);
      assert.ok(entry.steps.every((step) => step.trim().length > 0), `${entry.id} 空步骤`);
    }
  }
});

test('「去设置」目标都落在真实存在的分组', () => {
  for (const category of HELP_CATEGORIES) {
    for (const entry of category.entries) {
      const target = entry.goTo;
      if (target === undefined) continue;
      const groups = target.page === 'settings' ? SETTINGS_GROUPS : DEVICES_GROUPS;
      assert.ok(groups.has(target.group), `${entry.id} → ${target.page}/${target.group}`);
      assert.ok(target.label.length > 0, entry.id);
    }
  }
});

test('搜索按标题、关键词与正文过滤，结果计数随之变化', () => {
  const byTitle = searchHelp('一键更新');
  assert.ok(byTitle.total >= 1);
  assert.ok(byTitle.categories.some((category) => category.entries.some((entry) => entry.id === 'update-one-click')));

  const byKeyword = searchHelp('GitHub');
  assert.ok(byKeyword.total >= 1);
  assert.ok(byKeyword.categories.some((category) => category.entries.some((entry) => entry.id === 'update-source')));

  // 只出现在步骤正文里的词也能命中
  const byBody = searchHelp('安全快照');
  assert.ok(byBody.total >= 1);
  assert.ok(byBody.categories.some((category) => category.entries.some((entry) => entry.id === 'backup-snapshot')));
});

test('空查询返回全部；无命中返回空分类与 0 条', () => {
  const all = searchHelp('   ');
  assert.equal(all.total, HELP_ENTRY_COUNT);
  assert.equal(all.categories.length, HELP_CATEGORIES.length);
  const none = searchHelp('绝对不存在的帮助关键词zzz');
  assert.equal(none.total, 0);
  assert.equal(none.categories.length, 0);
});

test('内容覆盖产品要求的关键主题', () => {
  const expectations: ReadonlyArray<readonly [string, string]> = [
    ['下载源', 'update-source'],
    ['Gitee', 'update-source'],
    ['扫码配对', 'lan-pair'],
    ['导出诊断日志', 'about-diagnostics'],
    ['恢复快照', 'backup-snapshot'],
    ['导入教务', 'import-timetable'],
    ['悬浮窗', 'widget'],
    ['主窗口', 'widget'],
  ];
  for (const [query, id] of expectations) {
    const result = searchHelp(query);
    const hit = result.categories.some((category) => category.entries.some((entry) => entry.id === id));
    assert.ok(hit, `${query} 应命中 ${id}`);
  }
  assert.ok(findHelpEntry('update-source') !== null);
  assert.equal(findHelpEntry('缺失的条目'), null);
});
