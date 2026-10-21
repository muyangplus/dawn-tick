import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESETS, cssVariables } from '../src/design/tokens.ts';
import { miniShellClassName } from '../src/mini/background.ts';

/**
 * 悬浮窗配色（R-04）的静态断言：
 * - 设置里的浅色/深色/透明映射为外壳类名；
 * - 浅色/深色只切换 `--mini-*` 别名到对应模式的预设令牌，不在样式里写死颜色；
 * - 透明背景跟随当前主题，不切换模式令牌；
 * - applyTheme 写出的 `--dt-light-*` / `--dt-dark-*` 两套令牌与 tokens.ts 一致。
 */
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function ruleBody(selector: string): string {
  const match = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(styles);
  assert.ok(match !== null, `styles.css 缺少 ${selector} 规则`);
  return match[1] ?? '';
}

test('悬浮窗背景设置映射为外壳类名', () => {
  assert.equal(miniShellClassName('bar', 'light'), 'mini mini-bar mini-bg-light');
  assert.equal(miniShellClassName('today', 'dark'), 'mini mini-today mini-bg-dark');
  assert.equal(miniShellClassName('minimal', 'transparent'), 'mini mini-minimal mini-bg-transparent');
  assert.equal(miniShellClassName('combo', 'light'), 'mini mini-combo mini-bg-light');
});

test('浅色背景只引用浅色模式令牌，不写死颜色', () => {
  const body = ruleBody('.mini-bg-light');
  assert.match(body, /--mini-surface:\s*var\(--dt-light-surface/);
  assert.match(body, /--mini-text:\s*var\(--dt-light-text/);
  assert.match(body, /--mini-primary-strong:\s*var\(--dt-light-primary-strong/);
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}/, '浅色覆盖不应写死十六进制颜色');
  assert.doesNotMatch(body, /var\(--dt-dark-/, '浅色覆盖不应引用深色令牌');
});

test('深色背景只引用深色模式令牌，不写死颜色', () => {
  const body = ruleBody('.mini-bg-dark');
  assert.match(body, /--mini-surface:\s*var\(--dt-dark-surface/);
  assert.match(body, /--mini-text:\s*var\(--dt-dark-text/);
  assert.match(body, /--mini-primary-strong:\s*var\(--dt-dark-primary-strong/);
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}/, '深色覆盖不应写死十六进制颜色');
  assert.doesNotMatch(body, /var\(--dt-light-/, '深色覆盖不应引用浅色令牌');
});

test('透明背景跟随当前主题：只降低不透明度', () => {
  const body = ruleBody('.mini-bg-transparent');
  assert.match(body, /background:\s*color-mix\(in srgb, var\(--mini-surface\) 55%, transparent\)/);
  assert.doesNotMatch(body, /--mini-surface:/, '透明背景不应切换模式令牌');
});

test('悬浮窗外壳统一用 --mini-* 别名并显式继承文字色', () => {
  const body = ruleBody('.mini');
  assert.match(body, /color:\s*var\(--mini-text\)/);
  assert.match(body, /background:[\s\S]*var\(--mini-surface\)/);
  assert.match(body, /border:\s*1px solid var\(--mini-border\)/);
  // 别名默认取当前主题令牌，不在类里重复写颜色
  for (const name of ['surface', 'surface-muted', 'border', 'text', 'muted', 'primary', 'primary-strong']) {
    assert.match(body, new RegExp(`--mini-${name}:\\s*var\\(--dt-`), `缺少 --mini-${name} 别名`);
  }
});

test('两套模式令牌随预设写入根节点', () => {
  const variables = cssVariables('mono', 'light');
  assert.equal(variables['--dt-light-surface'], PRESETS.mono.light.surface);
  assert.equal(variables['--dt-light-text'], PRESETS.mono.light.text);
  assert.equal(variables['--dt-light-primary-strong'], PRESETS.mono.light.primaryStrong);
  assert.equal(variables['--dt-dark-surface'], PRESETS.mono.dark.surface);
  assert.equal(variables['--dt-dark-text'], PRESETS.mono.dark.text);
  assert.equal(variables['--dt-dark-primary-strong'], PRESETS.mono.dark.primaryStrong);
  // 当前模式的旧变量名不变
  assert.equal(variables['--dt-surface'], PRESETS.mono.light.surface);
});
