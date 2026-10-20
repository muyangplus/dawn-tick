import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
    scope: 'settings',
    title: id,
    defaultZone: zone,
    defaultOrder: order,
    defaultVisible: true,
    render: () => null,
  });
}

const idsOf = (layout: LayoutConfig, zone: CardZone): string[] =>
  cardsInZone('settings', layout, zone).map((card) => card.def.id);

test('卡片默认按主列在前、侧列在后解析', () => {
  assert.deepEqual(
    resolveCards('settings', {}).map((card) => card.def.id),
    ['layout-test-a', 'layout-test-c', 'layout-test-b'],
  );
  assert.deepEqual(idsOf({}, 'main'), ['layout-test-a', 'layout-test-c']);
  assert.deepEqual(idsOf({}, 'side'), ['layout-test-b']);
});

test('切到侧列后卡片离开主列并落在侧列末尾', () => {
  const next = setCardZone({}, 'settings', 'layout-test-a', 'side');
  assert.deepEqual(idsOf(next, 'main'), ['layout-test-c']);
  assert.deepEqual(idsOf(next, 'side'), ['layout-test-b', 'layout-test-a']);
  // 再切回主列：落在主列末尾，原侧列只剩一张
  const back = setCardZone(next, 'settings', 'layout-test-a', 'main');
  assert.deepEqual(idsOf(back, 'main'), ['layout-test-c', 'layout-test-a']);
  assert.deepEqual(idsOf(back, 'side'), ['layout-test-b']);
});

test('上移下移只在同一区域内交换，不跨主列与侧列', () => {
  const moved = moveCard({}, 'settings', 'layout-test-a', 'down');
  assert.deepEqual(idsOf(moved, 'main'), ['layout-test-c', 'layout-test-a']);
  // 侧列只有一张卡：无处可移，配置保持不变
  assert.deepEqual(moveCard({}, 'settings', 'layout-test-b', 'up'), {});
  assert.deepEqual(moveCard({}, 'settings', 'layout-test-b', 'down'), {});
});

test('卡片布局入口全仓唯一：每页只在顶部留一个，卡内不再重复', () => {
  const ENTRY = 'setLayoutOpen(true)';
  const pagesWithEntry = sourceFiles(SRC_DIR)
    .filter((file) => readFileSync(file, 'utf8').includes(ENTRY))
    .map((file) => file.slice(SRC_DIR.length + 1).replace(/\\/g, '/'))
    .sort();
  assert.deepEqual(pagesWithEntry, ['screens/devices-view.tsx', 'screens/settings-view.tsx']);

  const settings = readSource('screens/settings-view.tsx');
  const devices = readSource('screens/devices-view.tsx');
  for (const [name, source] of [
    ['设置页', settings],
    ['设备与同步页', devices],
  ] as const) {
    assert.equal(source.split(ENTRY).length - 1, 1, `${name}只能有顶部一个卡片布局入口`);
    assert.equal(source.split('<CardLayoutDialog').length - 1, 1, `${name}只应挂一个卡片布局对话框`);
    assert.ok(!source.includes('打开卡片布局'), `${name}卡片内不应再有第二个入口`);
  }
  // A-11：外观卡正文已拆到独立组件，断言跟着组件走
  const appearance = readSource('screens/settings/appearance-card.tsx');
  assert.ok(
    appearance.includes('卡片显隐在顶部「卡片布局」'),
    '外观卡要写明「卡片显隐在顶部「卡片布局」」',
  );
});

test('设置页与设备与同步页消费 card.zone：主列/侧列两列布局由区域决定', () => {
  const pages = [
    ['设置页', 'screens/settings-view.tsx', 'settings', 'settings-grid'],
    ['设备与同步页', 'screens/devices-view.tsx', 'devices', 'devices-grid'],
  ] as const;
  for (const [name, file, scope, gridRole] of pages) {
    const source = readSource(file);
    assert.ok(source.includes(`cardsInZone('${scope}', layout, 'main')`), `${name}主列要按区域取卡片`);
    assert.ok(source.includes(`cardsInZone('${scope}', layout, 'side')`), `${name}侧列要按区域取卡片`);
    assert.ok(source.includes('desktop:grid-cols-[2fr_1fr]'), `${name}侧列要在宽屏变右栏两列`);
    assert.ok(source.includes(`data-role="${gridRole}"`), `${name}要有可断言的布局容器`);
  }
});
