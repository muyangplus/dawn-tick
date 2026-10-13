import test from 'node:test';
import assert from 'node:assert/strict';
import { fromBase64Utf8, toBase64Utf8 } from '../src/base64.ts';

test('Base64 往返保持 UTF-8 文本', () => {
  const samples = [
    '',
    'abc',
    '晓刻 DawnTick',
    '{"format":"dawn-tick-backup","modules":["courses"]}',
    '换行\n与\t制表符',
    '😀 emoji 混排',
  ];
  for (const sample of samples) {
    assert.equal(fromBase64Utf8(toBase64Utf8(sample)), sample, sample);
  }
});

test('Base64 与标准实现一致', () => {
  assert.equal(toBase64Utf8('abc'), 'YWJj');
  assert.equal(toBase64Utf8('ab'), 'YWI=');
  assert.equal(toBase64Utf8('a'), 'YQ==');
  assert.equal(toBase64Utf8('晓刻'), Buffer.from('晓刻', 'utf8').toString('base64'));
});

test('Base64 解析容忍空白与 URL 安全字符', () => {
  const text = '{"a":1}';
  const standard = toBase64Utf8(text);
  assert.equal(fromBase64Utf8(`  ${standard.slice(0, 4)}\n${standard.slice(4)} `), text);
  const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(fromBase64Utf8(urlSafe), text);
});

test('Base64 非法输入抛错', () => {
  assert.throws(() => fromBase64Utf8('abc'), /长度/);
  assert.throws(() => fromBase64Utf8('!!!!'), /不合法字符/);
  assert.equal(fromBase64Utf8(''), '');
});
