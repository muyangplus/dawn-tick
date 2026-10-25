import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeScanError,
  isScanAvailable,
  scanPairPayload,
  setPairScannerForTests,
  stopScan,
} from '../src/lan-pair-scan.ts';
import { parsePairPayload } from '../src/lan-pair-payload.ts';

test('Web / 桌面不可用，安卓桩可用', async () => {
  assert.equal(isScanAvailable(), false);
  await assert.rejects(scanPairPayload(), /只在安卓版可用/);
  await stopScan();

  setPairScannerForTests({ scan: async () => null });
  try {
    assert.equal(isScanAvailable(), true);
    assert.equal(await scanPairPayload(), null, '用户取消返回 null');
  } finally {
    setPairScannerForTests(null);
  }
  assert.equal(isScanAvailable(), false);
});

test('扫码结果交给同一套解析器：链接 / 文本都能配对', async () => {
  const scanned = 'dawn-tick://pair?schema=1&host=192.168.1.5&port=8765&code=123456&name=PC';
  setPairScannerForTests({ scan: async () => scanned });
  try {
    const text = await scanPairPayload();
    const parsed = parsePairPayload(text ?? '');
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok ? parsed.payload : null, {
      host: '192.168.1.5',
      port: 8765,
      code: '123456',
      name: 'PC',
    });
  } finally {
    setPairScannerForTests(null);
  }

  setPairScannerForTests({ scan: async () => '10.0.0.8:9000#654321' });
  try {
    const parsed = parsePairPayload((await scanPairPayload()) ?? '');
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok ? parsed.payload : null, { host: '10.0.0.8', port: 9000, code: '654321' });
  } finally {
    setPairScannerForTests(null);
  }
});

test('扫码失败给可读原因', async () => {
  setPairScannerForTests({
    scan: async () => {
      throw new Error('scan canceled.');
    },
  });
  try {
    await assert.rejects(scanPairPayload(), /已取消扫码/);
  } finally {
    setPairScannerForTests(null);
  }
  setPairScannerForTests({
    scan: async () => {
      throw new Error('User denied access to camera.');
    },
  });
  try {
    await assert.rejects(scanPairPayload(), /没有相机权限/);
  } finally {
    setPairScannerForTests(null);
  }
});

test('describeScanError：取消 / 权限 / 组件缺失 / 相机占用 / 原文', () => {
  assert.equal(describeScanError('scan canceled.'), '已取消扫码');
  assert.match(describeScanError('User denied access to camera.'), /没有相机权限/);
  assert.match(describeScanError('The Google Barcode Scanner Module is not available.'), /没有扫码组件/);
  assert.equal(describeScanError('Camera is in use by another app'), '相机正被其它应用占用，请关闭后重试');
  assert.equal(describeScanError('未知错误'), '未知错误');
  assert.match(describeScanError(''), /扫码失败/);
});
