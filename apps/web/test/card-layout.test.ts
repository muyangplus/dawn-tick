import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cardsInZone,
  defineCard,
  moveCard,
  resolveCards,
  setCardZone,
  type CardZone,
  type LayoutConfig,
} from '../src/screens/cards/registry.ts';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

function readSource(relative: string): string {
  return readFileSync(join(SRC_DIR, relative), 'utf8');
}

/** 递归列出 src 下的 .ts/.tsx，供「布局入口全仓唯一」扫描用。 */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** 测试用的三张假卡片：两张主列、一张侧列，保证两列都有内容。 */
const TEST_CARDS: ReadonlyArray<readonly [string, CardZone, number]> = [
  ['layout-test-a', 'main', 0],
  ['layout-test-b', 'side', 1],
  ['layout-test-c', 'main', 2],
];

for (const [id, zone, order] of TEST_CARDS) {
  defineCard({
    id,
    scope: 'schedule',
    title: id,
    defaultZone: zone,
    defaultOrder: order,
    defaultVisible: true,
    render: () => null,
  });
}

const idsOf = (layout: LayoutConfig, zone: CardZone): string[] =>
  cardsInZone('schedule', layout, zone).map((card) => card.def.id);

test('卡片默认按主列在前、侧列在后解析', () => {
  assert.deepEqual(
    resolveCards('schedule', {}).map((card) => card.def.id),
    ['layout-test-a', 'layout-test-c', 'layout-test-b'],
  );
  assert.deepEqual(idsOf({}, 'main'), ['layout-test-a', 'layout-test-c']);
  assert.deepEqual(idsOf({}, 'side'), ['layout-test-b']);
});

test('切到侧列后卡片离开主列并落在侧列末尾', () => {
  const next = setCardZone({}, 'schedule', 'layout-test-a', 'side');
  assert.deepEqual(idsOf(next, 'main'), ['layout-test-c']);
  assert.deepEqual(idsOf(next, 'side'), ['layout-test-b', 'layout-test-a']);
  // 再切回主列：落在主列末尾，原侧列只剩一张
  const back = setCardZone(next, 'schedule', 'layout-test-a', 'main');
  assert.deepEqual(idsOf(back, 'main'), ['layout-test-c', 'layout-test-a']);
  assert.deepEqual(idsOf(back, 'side'), ['layout-test-b']);
});

test('上移下移只在同一区域内交换，不跨主列与侧列', () => {
  const moved = moveCard({}, 'schedule', 'layout-test-a', 'down');
  assert.deepEqual(idsOf(moved, 'main'), ['layout-test-c', 'layout-test-a']);
  // 侧列只有一张卡：无处可移，配置保持不变
  assert.deepEqual(moveCard({}, 'schedule', 'layout-test-b', 'up'), {});
  assert.deepEqual(moveCard({}, 'schedule', 'layout-test-b', 'down'), {});
});

test('卡片布局入口只剩设备与同步页顶部一处', () => {
  const ENTRY = 'setLayoutOpen(true)';
  const pagesWithEntry = sourceFiles(SRC_DIR)
    .filter((file) => readFileSync(file, 'utf8').includes(ENTRY))
    .map((file) => file.slice(SRC_DIR.length + 1).replace(/\\/g, '/'))
    .sort();
  // 设置页改成分组导航后不再有卡片布局入口
  assert.deepEqual(pagesWithEntry, ['screens/devices-view.tsx']);

  const devices = readSource('screens/devices-view.tsx');
  assert.equal(devices.split(ENTRY).length - 1, 1, '设备与同步页只能有顶部一个卡片布局入口');
  assert.equal(devices.split('<CardLayoutDialog').length - 1, 1, '设备与同步页只应挂一个卡片布局对话框');
  assert.ok(!devices.includes('打开卡片布局'), '设备与同步页卡片内不应再有第二个入口');
});

test('设备与同步页消费 card.zone：主列/侧列两列布局由区域决定', () => {
  const source = readSource('screens/devices-view.tsx');
  assert.ok(source.includes("cardsInZone('devices', layout, 'main')"), '设备页主列要按区域取卡片');
  assert.ok(source.includes("cardsInZone('devices', layout, 'side')"), '设备页侧列要按区域取卡片');
  assert.ok(source.includes('desktop:grid-cols-[2fr_1fr]'), '设备页侧列要在宽屏变右栏两列');
  assert.ok(source.includes('data-role="devices-grid"'), '设备页要有可断言的布局容器');
});

test('设置页改用分组导航：七组交给 GroupedSettings，不再走卡片注册表与手风琴', () => {
  const source = readSource('screens/settings-view.tsx');
  assert.ok(source.includes('<GroupedSettings'), '设置页要渲染 GroupedSettings');
  assert.ok(source.includes('pageTitle="设置"'), '分组导航的页面标题应为「设置」');
  assert.ok(source.includes('ariaLabel="设置分组"'), '分组清单要有无障碍名称「设置分组」');

  for (const id of ['semesters', 'reminders', 'appearance', 'timetable', 'slots', 'widget', 'time']) {
    assert.ok(source.includes(`id: '${id}'`), `设置页分组清单缺少 ${id}`);
  }
  for (const removed of [
    'CollapsibleCard',
    'useCardAccordion',
    'cardsInZone',
    'CardLayoutDialog',
    'settings-cards.tsx',
    'dt-stagger',
  ]) {
    assert.ok(!source.includes(removed), `设置页不应再引用 ${removed}`);
  }
  // 提醒分组的通知状态仍由页面持有，顶部提示条与分组内容共用同一份
  assert.ok(source.includes('useNotifyPermission'), '设置页仍要持有通知权限状态');
  assert.ok(source.includes('data-role="settings-actions"'), '顶部导入快捷动作要保留');

  assert.equal(
    existsSync(join(SRC_DIR, 'screens/cards/settings-cards.tsx')),
    false,
    '设置页卡片注册表应已删除',
  );
});
