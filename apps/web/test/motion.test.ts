import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 动效规范的静态断言（I-15）：
 * - 新增动效统一走 styles.css 的时长令牌，单条时长 ≤ 240ms
 * - 只用 transform / opacity / filter 等合成属性（折叠高度是唯一例外）
 * - [data-motion=off] 与系统 reduced-motion 压到 1ms、延迟归零
 * - 视图根节点与卡片列表的动效类始终存在，避免组件里漏挂
 */
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const BLOCK_START = '/* ══ I-15 动效增强 开始';
const BLOCK_END = '/* ══ I-15 动效增强 结束';

function motionBlock(): string {
  const start = styles.indexOf(BLOCK_START);
  const end = styles.indexOf(BLOCK_END);
  assert.ok(start !== -1 && end > start, 'styles.css 缺少 I-15 动效块标记');
  return styles.slice(start, end);
}

function tokenDuration(name: string): number {
  const match = new RegExp(`--dt-motion-${name}:\\s*(\\d+)ms`).exec(styles);
  assert.ok(match !== null, `缺少动效令牌 --dt-motion-${name}`);
  return Number(match[1]);
}

test('动效令牌齐备且时长不超过 240ms', () => {
  const fast = tokenDuration('fast');
  const base = tokenDuration('base');
  const slow = tokenDuration('slow');
  assert.ok(fast >= 100 && fast <= 160, `fast=${fast}ms 不在 100–160ms`);
  assert.ok(base > fast && base <= 180, `base=${base}ms 应大于 fast 且 ≤180ms`);
  assert.ok(slow > base && slow <= 240, `slow=${slow}ms 应大于 base 且 ≤240ms`);

  const block = motionBlock();
  const literal = [...block.matchAll(/(\d+)ms/g)].map((match) => Number(match[1]));
  assert.ok(literal.length > 0, '动效块里没有任何时长');
  assert.ok(
    literal.every((ms) => ms <= 240),
    `动效块出现超过 240ms 的时长：${literal.filter((ms) => ms > 240).join(', ')}`,
  );
});

test('新增动效只用合成属性，折叠高度用 Radix 变量', () => {
  const block = motionBlock();
  // transition 里不允许出现会触发布局的 width / height / margin / top / left
  for (const match of block.matchAll(/transition:\s*([^;]+);/g)) {
    assert.doesNotMatch(
      match[1] ?? '',
      /\b(width|height|margin|padding|top|right|bottom|left)\b/,
      `transition 用了布局属性：${match[1]}`,
    );
  }
  assert.match(
    block,
    /height:\s*var\(--radix-collapsible-content-height\)/,
    '折叠高度应使用 Radix 提供的高度变量',
  );
  // 卡片/按钮/列表动画都只动 transform 与 opacity
  for (const match of block.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\s*\}/g)) {
    const name = match[1] ?? '';
    const body = match[2] ?? '';
    if (name === 'dt-collapse-open') continue;
    assert.doesNotMatch(body, /\b(width|height|margin|padding|top|left)\s*:/, `${name} 动了布局属性`);
  }
});

test('设备与同步页卡片按序淡入，延迟只覆盖前 6 项且不超过 120ms', () => {
  const block = motionBlock();
  assert.match(block, /\.dt-stagger\s*>\s*\*\s*\{[^}]*animation:/, '缺少 .dt-stagger 子项动画');
  assert.match(block, /\.dt-stagger\s*>\s*\*\s*\{[^}]*backwards/, 'stagger 不能用 forwards/both，否则会压住卡片 hover');
  const stagger = block.slice(block.indexOf('.dt-stagger >'));
  const delays = [...stagger.matchAll(/animation-delay:\s*(\d+)ms/g)].map((match) => Number(match[1]));
  assert.ok(delays.length >= 6, `只有 ${delays.length} 条 stagger 延迟`);
  assert.ok(Math.max(...delays) <= 120, `stagger 最大延迟 ${Math.max(...delays)}ms 超过 120ms`);
  assert.match(block, /:nth-child\(n \+ 6\)\s*\{\s*animation-delay:/, '第 7 项起应封顶到最后一级延迟');
});

test('关闭动效时动画与过渡压到 1ms，且延迟归零', () => {
  assert.match(
    styles,
    /\[data-motion='off'\] \*,[\s\S]*?animation-duration:\s*1ms !important;/,
    '缺少 data-motion=off 的动画停用规则',
  );
  assert.match(
    styles,
    /\[data-motion='off'\] \*,[\s\S]*?transition-duration:\s*1ms !important;/,
    '缺少 data-motion=off 的过渡停用规则',
  );
  assert.match(
    styles,
    /\[data-motion='off'\] \*,[\s\S]*?animation-delay:\s*0ms !important;/,
    'data-motion=off 下 stagger 延迟也应归零',
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-motion='system'\]/,
    '缺少系统 reduced-motion 的停用规则',
  );
});

test('组件挂载的动效类与视图根节点过渡类都已定义', () => {
  for (const selector of [
    '.dt-view-enter',
    '.dt-card-motion',
    '.dt-btn-motion',
    '.dt-stagger',
    '.dt-collapse[data-state=',
    '.dt-toast[data-mounted=',
    '.dt-nav-bottom[aria-current=',
  ]) {
    assert.ok(styles.includes(selector), `styles.css 缺少 ${selector}`);
  }
});
