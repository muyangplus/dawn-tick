import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAIR_LINK_PREFIX,
  PAIR_PAYLOAD_NAME_MAX,
  PAIR_PAYLOAD_SCHEMA,
  formatPairPayload,
  formatPairingText,
  parsePairPayload,
} from '../src/lan-pair-payload.ts';

const LINK =
  'dawn-tick://pair?schema=1&host=192.168.1.23&port=8765&code=123456&name=PC';

function ok(text: string) {
  const result = parsePairPayload(text);
  assert.equal(result.ok, true, `应能解析：${text} → ${result.ok ? '' : result.error}`);
  if (!result.ok) throw new Error(result.error);
  return result.payload;
}

function errorOf(text: string): string {
  const result = parsePairPayload(text);
  assert.equal(result.ok, false, `不应解析：${text}`);
  return result.ok ? '' : result.error;
}

test('标准链接：格式固定、可往返解析', () => {
  assert.equal(PAIR_LINK_PREFIX, 'dawn-tick://pair');
  assert.equal(PAIR_PAYLOAD_SCHEMA, 1);
  const text = formatPairPayload({ host: '192.168.1.23', port: 8765, code: '123456', name: 'PC' });
  assert.equal(text, LINK);
  assert.deepEqual(ok(text), { host: '192.168.1.23', port: 8765, code: '123456', name: 'PC' });
  assert.equal(ok(text).name, 'PC');
});

test('标准链接：无设备名时不带 name，中文名做 URL 编码后仍可还原', () => {
  const noName = formatPairPayload({ host: '10.0.0.8', port: 9000, code: '654321' });
  assert.equal(noName, 'dawn-tick://pair?schema=1&host=10.0.0.8&port=9000&code=654321');
  assert.deepEqual(ok(noName), { host: '10.0.0.8', port: 9000, code: '654321' });

  const chinese = formatPairPayload({ host: '192.168.1.5', port: 8765, code: '000000', name: '书房 电脑' });
  assert.match(chinese, /name=%E4%B9%A6%E6%88%BF/);
  assert.equal(ok(chinese).name, '书房 电脑');
});

test('人类可读文本：`IP:端口 配对码` 与 `IP:端口#配对码`', () => {
  assert.deepEqual(ok('192.168.1.23:8765 123456'), {
    host: '192.168.1.23',
    port: 8765,
    code: '123456',
  });
  assert.deepEqual(ok('192.168.1.23:8765#123456'), {
    host: '192.168.1.23',
    port: 8765,
    code: '123456',
  });
  assert.deepEqual(ok('  http://10.0.0.2:9000 654321  '), {
    host: '10.0.0.2',
    port: 9000,
    code: '654321',
  });
  assert.deepEqual(ok('192.168.1.23:8765\n123456'), {
    host: '192.168.1.23',
    port: 8765,
    code: '123456',
  });
  assert.equal(formatPairingText(ok('192.168.1.23:8765#123456')), '192.168.1.23:8765 123456');
});

test('整段 URL 编码后的文本与变体链接都能解析', () => {
  const encoded = encodeURIComponent(LINK);
  assert.notEqual(encoded, LINK);
  assert.deepEqual(ok(encoded), ok(LINK));
  assert.deepEqual(ok('dawn-tick:pair?schema=1&host=192.168.1.23&port=8765&code=123456'), {
    host: '192.168.1.23',
    port: 8765,
    code: '123456',
  });
  assert.deepEqual(ok('HTTP://192.168.1.23:8765/pair?code=123456&host=192.168.1.23&port=8765'), {
    host: '192.168.1.23',
    port: 8765,
    code: '123456',
  });
  // 缺省端口按 8765
  assert.deepEqual(ok('dawn-tick://pair?schema=1&host=192.168.1.23&code=123456'), {
    host: '192.168.1.23',
    port: 8765,
    code: '123456',
  });
  assert.equal(ok('dawn-tick://pair?host=localhost&port=8765&code=123456').host, '127.0.0.1');
});

test('错误输入给出可读原因', () => {
  assert.match(errorOf(''), /配对信息为空/);
  assert.match(errorOf('随便写的东西'), /无法识别配对信息/);
  assert.match(errorOf('dawn-tick://pair?schema=2&host=192.168.1.23&port=8765&code=123456'), /版本 2 不受支持/);
  assert.match(errorOf('dawn-tick://pair?schema=1&port=8765&code=123456'), /没有对方地址/);
  assert.match(errorOf('dawn-tick://pair?schema=1&host=192.168.1.23&port=8765'), /没有配对码/);
  assert.match(errorOf('dawn-tick://pair?schema=1&host=192.168.1.23&port=0&code=123456'), /端口不正确/);
  assert.match(errorOf('dawn-tick://pair?schema=1&host=192.168.1.23&port=8765&code=12345'), /6 位数字/);
  assert.match(errorOf('192.168.1.23:8765 12345'), /6 位数字/);
  assert.match(errorOf('8.8.8.8:8765 123456'), /不是局域网 IPv4/);
  assert.match(errorOf('example.com:8765 123456'), /无法识别配对信息/);
  assert.match(errorOf('192.168.1.23:8765'), /没有配对码/);
});

test('设备名去空白、限长，避免二维码溢出', () => {
  const payload = formatPairPayload({
    host: '192.168.1.23',
    port: 8765,
    code: '123456',
    name: '  a  very   long   device   name  ',
  });
  assert.equal(ok(payload).name, 'a very long device name');
  const long = formatPairPayload({
    host: '192.168.1.23',
    port: 8765,
    code: '123456',
    name: 'x'.repeat(200),
  });
  assert.equal(ok(long).name?.length, PAIR_PAYLOAD_NAME_MAX);
});
