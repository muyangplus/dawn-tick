import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeScanError,
  isScanAvailable,
  parseScannedPayload,
  scanCodeOnce,
  scannedScheme,
  setScanStubForTests,
} from '../src/lib/scan.ts';

test('parseScannedPayload：标准配对链接 → pair', () => {
  const parsed = parseScannedPayload(
    'dawn-tick://pair?schema=1&host=192.168.1.5&port=8765&code=123456&name=PC',
  );
  assert.equal(parsed.kind, 'pair');
  assert.deepEqual(parsed.kind === 'pair' ? parsed.payload : null, {
    host: '192.168.1.5',
    port: 8765,
    code: '123456',
    name: 'PC',
  });
  // http(s) 配对链接与纯端口文本也能识别
  assert.equal(
    parseScannedPayload('http://192.168.1.5:8765/pair?host=192.168.1.5&port=8765&code=654321').kind,
    'pair',
  );
  assert.equal(parseScannedPayload('192.168.1.5:8765 123456').kind, 'pair');
});

test('parseScannedPayload：普通文本 / 未知 scheme 保留内容并给说明', () => {
  const text = parseScannedPayload('hello world');
  assert.equal(text.kind, 'text');
  assert.equal(text.kind === 'text' ? text.text : '', 'hello world');
  assert.equal(text.kind === 'text' ? text.scheme : 'x', null);

  const link = parseScannedPayload('https://example.com/a?b=1');
  assert.equal(link.kind, 'text');
  assert.equal(link.kind === 'text' ? link.scheme : 'x', 'https');

  const unknown = parseScannedPayload('tel:10086');
  assert.equal(unknown.kind, 'text');
  assert.equal(unknown.kind === 'text' ? unknown.scheme : 'x', 'tel');
  assert.match(unknown.kind === 'text' ? (unknown.note ?? '') : '', /暂不支持 tel:\/\//);

  const malformedPair = parseScannedPayload('dawn-tick://pair?schema=1&host=1.2.3.4&code=12');
  assert.equal(malformedPair.kind, 'text');
  assert.match(malformedPair.kind === 'text' ? (malformedPair.note ?? '') : '', /不能作为配对信息/);

  const empty = parseScannedPayload('   ');
  assert.equal(empty.kind, 'text');
  assert.match(empty.kind === 'text' ? (empty.note ?? '') : '', /扫码结果为空/);
});

test('scannedScheme 只认开头的合法 scheme', () => {
  assert.equal(scannedScheme('dawn-tick://pair'), 'dawn-tick');
  assert.equal(scannedScheme('HTTPS://example.com'), 'https');
  assert.equal(scannedScheme('192.168.1.5:8765 123456'), null);
  assert.equal(scannedScheme('hello: world'), 'hello');
});

test('scanCodeOnce 使用通用扫码桩；取消返回 null，非 Android 给可读原因', async () => {
  setScanStubForTests({ scan: async () => 'dawn-tick://pair?schema=1&host=10.0.0.2&port=8765&code=111111' });
  try {
    assert.equal(isScanAvailable(), true);
    assert.equal(await scanCodeOnce(), 'dawn-tick://pair?schema=1&host=10.0.0.2&port=8765&code=111111');
  } finally {
    setScanStubForTests(null);
  }
  await assert.rejects(scanCodeOnce(), /只在安卓版可用/);

  setScanStubForTests({ scan: async () => null, available: true });
  try {
    assert.equal(await scanCodeOnce(), null);
  } finally {
    setScanStubForTests(null);
  }
  assert.equal(isScanAvailable(), false);
  assert.equal(describeScanError('scan canceled.'), '已取消扫码');
});
