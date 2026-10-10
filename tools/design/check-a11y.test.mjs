import test from 'node:test';
import assert from 'node:assert/strict';
import { AA_TEXT, contrastRatio, ensureContrast, mix, parseHex, pickTextOn } from '../../apps/web/src/design/contrast.ts';
import { PRESETS, TAP_MIN, courseTint } from '../../apps/web/src/design/tokens.ts';
import { checkStaticTokens, runChecks } from './check-a11y.mjs';

test('对比度计算', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#FFFFFF')), 21);
  assert.equal(contrastRatio('#123456', '#123456').toFixed(2), '1.00');
  assert.equal(parseHex('#fff').r, 255);
  assert.throws(() => parseHex('红色'), /非法颜色值/);
  assert.throws(() => parseHex('#12345'), /非法颜色值/);
});

test('候选前景色取更优者', () => {
  assert.equal(pickTextOn('#FFFFFF').color, '#111111');
  assert.equal(pickTextOn('#111111').color, '#FFFFFF');
});

test('混色与达标修正', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
  const fixed = ensureContrast('#FF6B4A', '#FFF7F2', AA_TEXT);
  assert.ok(contrastRatio(fixed, '#FFF7F2') >= AA_TEXT, `${fixed} 应达标`);
});

test('原色在浅底上不达标是已知事实，故文字走 strong 变体', () => {
  const vividLight = PRESETS.vivid.light;
  assert.ok(contrastRatio(vividLight.primary, vividLight.bg) < AA_TEXT);
  assert.ok(contrastRatio(vividLight.primaryStrong, vividLight.bg) >= AA_TEXT);
});

test('四套主题的语义配对全部达标', () => {
  const { failures } = runChecks();
  assert.deepEqual(failures, []);
});

test('styles.css 静态令牌与 tokens.ts 一致', () => {
  assert.deepEqual(checkStaticTokens(), []);
});

test('课程色块内文字达标', () => {
  for (const [preset, tokens] of Object.entries(PRESETS)) {
    for (const mode of ['light', 'dark']) {
      const colors = tokens[mode];
      for (const color of tokens.courses) {
        const tint = courseTint(colors.surface, color);
        assert.ok(
          contrastRatio(colors.text, tint) >= AA_TEXT,
          `${preset}/${mode} ${color} 块内文字不达标`,
        );
      }
    }
  }
});

test('触控下限不小于 44px', () => {
  assert.ok(TAP_MIN >= 44);
});
