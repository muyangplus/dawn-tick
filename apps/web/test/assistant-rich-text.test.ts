import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInlines, parseRichText, type RichBlock } from '../src/assistant/rich-text.ts';

const text = (value: string) => ({ kind: 'text' as const, text: value });
const bold = (value: string) => ({ kind: 'bold' as const, text: value });
const code = (value: string) => ({ kind: 'code' as const, text: value });

// ---- 行内 ----

test('行内：粗体与代码拆成片段，前后文字保留', () => {
  assert.deepEqual(parseInlines('周一有**高等数学**，在 `A101` 上'), [
    text('周一有'),
    bold('高等数学'),
    text('，在 '),
    code('A101'),
    text(' 上'),
  ]);
  assert.deepEqual(parseInlines('**开头**与`结尾`'), [bold('开头'), text('与'), code('结尾')]);
});

test('行内：没有标记时整段是文字，空串没有片段', () => {
  assert.deepEqual(parseInlines('普通的一句话'), [text('普通的一句话')]);
  assert.deepEqual(parseInlines(''), []);
});

test('行内：没配对的标记按原文保留', () => {
  assert.deepEqual(parseInlines('3 * 4 = 12'), [text('3 * 4 = 12')]);
  assert.deepEqual(parseInlines('**没收尾'), [text('**没收尾')]);
  assert.deepEqual(parseInlines('一个 ` 反引号'), [text('一个 ` 反引号')]);
  assert.deepEqual(parseInlines('****'), [text('****')]);
});

test('行内：标记不跨行', () => {
  assert.deepEqual(parseInlines('**上\n下**'), [text('**上\n下**')]);
  assert.deepEqual(parseInlines('`上\n下`'), [text('`上\n下`')]);
});

// ---- 块 ----

test('块：空行分段，段内换行保留', () => {
  assert.deepEqual(parseRichText('第一行\n第二行\n\n第二段'), [
    { kind: 'paragraph', inlines: [text('第一行\n第二行')] },
    { kind: 'paragraph', inlines: [text('第二段')] },
  ]);
});

test('块：多个空行与首尾空行不产生空段，CRLF 按换行处理', () => {
  assert.deepEqual(parseRichText('\n\n甲\r\n\r\n\r\n乙\n\n'), [
    { kind: 'paragraph', inlines: [text('甲')] },
    { kind: 'paragraph', inlines: [text('乙')] },
  ]);
  assert.deepEqual(parseRichText(''), []);
  assert.deepEqual(parseRichText('  \n \n'), []);
});

test('块：- * • 开头的行合成无序列表，项内认行内标记', () => {
  const blocks = parseRichText('今天的课：\n- **高数** 8:00\n* 英语\n• 体育 `操场`');
  assert.deepEqual(blocks, [
    { kind: 'paragraph', inlines: [text('今天的课：')] },
    {
      kind: 'list',
      ordered: false,
      items: [[bold('高数'), text(' 8:00')], [text('英语')], [text('体育 '), code('操场')]],
    },
  ] satisfies RichBlock[]);
});

test('块：1. 1、 1) 开头的行合成有序列表', () => {
  assert.deepEqual(parseRichText('1. 新建课程\n2、 设为假日\n10) 调课'), [
    { kind: 'list', ordered: true, items: [[text('新建课程')], [text('设为假日')], [text('调课')]] },
  ]);
});

test('块：有序与无序相邻时分成两个列表；列表后的文字另起一段', () => {
  assert.deepEqual(parseRichText('- 甲\n- 乙\n1. 一\n2. 二\n结尾'), [
    { kind: 'list', ordered: false, items: [[text('甲')], [text('乙')]] },
    { kind: 'list', ordered: true, items: [[text('一')], [text('二')]] },
    { kind: 'paragraph', inlines: [text('结尾')] },
  ]);
});

test('块：空行隔开的同类列表分成两个', () => {
  assert.deepEqual(parseRichText('- 甲\n\n- 乙'), [
    { kind: 'list', ordered: false, items: [[text('甲')]] },
    { kind: 'list', ordered: false, items: [[text('乙')]] },
  ]);
});

test('块：缩进的列表项照样识别', () => {
  assert.deepEqual(parseRichText('  - 缩进\n    2. 也缩进'), [
    { kind: 'list', ordered: false, items: [[text('缩进')]] },
    { kind: 'list', ordered: true, items: [[text('也缩进')]] },
  ]);
});

test('块：标题变成单独一段粗体，前后段落断开', () => {
  assert.deepEqual(parseRichText('前言\n## 本周安排\n周一上课'), [
    { kind: 'paragraph', inlines: [text('前言')] },
    { kind: 'paragraph', inlines: [bold('本周安排')] },
    { kind: 'paragraph', inlines: [text('周一上课')] },
  ]);
  assert.deepEqual(parseRichText('# 一级'), [{ kind: 'paragraph', inlines: [bold('一级')] }]);
});

test('块：不像标记的行按原文显示', () => {
  // 没有空格的 # / - / 数字点 不是标题或列表
  assert.deepEqual(parseRichText('#话题\n-5 度\n3.5 分\n####### 七个井号'), [
    { kind: 'paragraph', inlines: [text('#话题\n-5 度\n3.5 分\n####### 七个井号')] },
  ]);
  assert.deepEqual(parseRichText('**没配对\n- 项 **也没配对'), [
    { kind: 'paragraph', inlines: [text('**没配对')] },
    { kind: 'list', ordered: false, items: [[text('项 **也没配对')]] },
  ]);
});

test('块：「1、」后不带空格也是有序列表项；「1.」「1)」后仍要空格', () => {
  assert.deepEqual(parseRichText('1、新建课程\n2、设为假日'), [
    { kind: 'list', ordered: true, items: [[text('新建课程')], [text('设为假日')]] },
  ]);
  assert.deepEqual(parseRichText('1.没空格\n2)也没空格'), [{ kind: 'paragraph', inlines: [text('1.没空格\n2)也没空格')] }]);
});

test('块：小数开头的行不是列表', () => {
  assert.deepEqual(parseRichText('2.5 小时'), [{ kind: 'paragraph', inlines: [text('2.5 小时')] }]);
});
