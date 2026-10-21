import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHref,
  parseInline,
  parseMarkdown,
} from '../src/components/ui/markdown-model.ts';

test('块级：### 标题、无序列表与段落', () => {
  assert.deepEqual(parseMarkdown('### 更新内容\n\n- 修复导入\n- 新增提醒\n\n普通段落'), [
    { kind: 'heading', level: 3, text: '更新内容' },
    { kind: 'list', ordered: false, items: ['修复导入', '新增提醒'] },
    { kind: 'paragraph', text: '普通段落' },
  ]);
});

test('块级：有序列表与不同列表类型分段', () => {
  assert.deepEqual(parseMarkdown('1. 第一步\n2. 第二步\n\n- 附注'), [
    { kind: 'list', ordered: true, items: ['第一步', '第二步'] },
    { kind: 'list', ordered: false, items: ['附注'] },
  ]);
});

test('块级：标题级别只在 1–3，空串不产生块', () => {
  assert.deepEqual(parseMarkdown('# 一级\n\n## 二级\n\n### 三级'), [
    { kind: 'heading', level: 1, text: '一级' },
    { kind: 'heading', level: 2, text: '二级' },
    { kind: 'heading', level: 3, text: '三级' },
  ]);
  assert.deepEqual(parseMarkdown('  \n\n'), []);
});

test('行内：粗体、行内代码、显式链接与裸链接', () => {
  assert.deepEqual(
    parseInline('**修复** `npm` [仓库](https://github.com/muyangplus/dawn-tick) 与 https://example.com/a'),
    [
      { kind: 'strong', text: '修复' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'npm' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: '仓库', href: 'https://github.com/muyangplus/dawn-tick', external: true },
      { kind: 'text', text: ' 与 ' },
      { kind: 'link', text: 'https://example.com/a', href: 'https://example.com/a', external: true },
    ],
  );
});

test('行内：Full Changelog 行的裸链接成为外部链接', () => {
  assert.deepEqual(parseInline('**Full Changelog**: https://github.com/muyangplus/dawn-tick/compare/v0.4.1...v0.5.0'), [
    { kind: 'strong', text: 'Full Changelog' },
    { kind: 'text', text: ': ' },
    {
      kind: 'link',
      text: 'https://github.com/muyangplus/dawn-tick/compare/v0.4.1...v0.5.0',
      href: 'https://github.com/muyangplus/dawn-tick/compare/v0.4.1...v0.5.0',
      external: true,
    },
  ]);
});

test('链接：站内路径与锚点不算外部，危险协议按纯文本', () => {
  assert.deepEqual(classifyHref('/settings'), { href: '/settings', external: false });
  assert.deepEqual(classifyHref('#readme'), { href: '#readme', external: false });
  assert.equal(classifyHref('javascript:alert'), null);
  assert.equal(classifyHref('data:text/html,x'), null);
  assert.deepEqual(parseInline('[坏链接](javascript:alert)'), [{ kind: 'text', text: '坏链接' }]);
});

test('HTML 标签只作为文本 token，不产生可执行结构', () => {
  assert.deepEqual(parseInline('<img src=x onerror=alert(1)>'), [
    { kind: 'text', text: '<img src=x onerror=alert(1)>' },
  ]);
  assert.deepEqual(parseMarkdown('<script>alert(1)</script>')[0], {
    kind: 'paragraph',
    text: '<script>alert(1)</script>',
  });
});
