import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ANDROID_ABI,
  ensureAndroidAbi,
  normalizeAndroidAbi,
  parseAndroidAbi,
  preferredAndroidAbi,
  setAndroidAbiDetectorForTests,
  setAndroidAbiForTests,
} from '../src/lib/android-abi.ts';

/** 每个用例结束都恢复默认，避免测试间污染模块级缓存。 */
function resetAbi(): void {
  setAndroidAbiDetectorForTests(null);
  setAndroidAbiForTests(null);
}

test('ABI 解析：primary 优先，abis 兜底，认不出用 arm64', () => {
  assert.equal(normalizeAndroidAbi('arm64-v8a'), 'arm64-v8a');
  assert.equal(normalizeAndroidAbi(' ARM64-V8A '), 'arm64-v8a');
  assert.equal(normalizeAndroidAbi('armeabi-v7a'), 'armeabi-v7a');
  assert.equal(normalizeAndroidAbi('x86_64'), null);
  assert.equal(normalizeAndroidAbi(7), null);

  assert.equal(parseAndroidAbi({ primary: 'armeabi-v7a', abis: ['armeabi-v7a'] }), 'armeabi-v7a');
  assert.equal(parseAndroidAbi({ primary: 'x86_64', abis: ['x86_64', 'arm64-v8a'] }), 'arm64-v8a');
  assert.equal(parseAndroidAbi({ abis: ['armeabi-v7a', 'arm64-v8a'] }), 'armeabi-v7a');
  assert.equal(parseAndroidAbi({ primary: '', abis: [] }), DEFAULT_ANDROID_ABI);
  assert.equal(parseAndroidAbi(null), 'arm64-v8a');
  assert.equal(parseAndroidAbi('armeabi-v7a'), 'arm64-v8a', '非对象一律回退');
});

test('ensureAndroidAbi：v7 设备写入首选 ABI，且同一次会话只探测一次', async () => {
  resetAbi();
  let calls = 0;
  try {
    setAndroidAbiDetectorForTests(async () => {
      calls += 1;
      return { primary: 'armeabi-v7a', abis: ['armeabi-v7a', 'arm64-v8a'] };
    });
    await ensureAndroidAbi();
    await ensureAndroidAbi();
    assert.equal(calls, 1, '重复检查更新不重复调原生');
    assert.equal(preferredAndroidAbi(), 'armeabi-v7a');
  } finally {
    resetAbi();
  }
  assert.equal(preferredAndroidAbi(), 'arm64-v8a', '恢复默认后回到 arm64');
});

test('ensureAndroidAbi：插件缺失（返回 null）时默认 arm64，不抛错', async () => {
  resetAbi();
  try {
    setAndroidAbiDetectorForTests(async () => null);
    await ensureAndroidAbi();
    assert.equal(preferredAndroidAbi(), 'arm64-v8a');
  } finally {
    resetAbi();
  }
});

test('ensureAndroidAbi：原生调用失败时默认 arm64，不抛错', async () => {
  resetAbi();
  try {
    setAndroidAbiDetectorForTests(async () => {
      throw new Error('not implemented');
    });
    await ensureAndroidAbi();
    assert.equal(preferredAndroidAbi(), 'arm64-v8a');
  } finally {
    resetAbi();
  }
});

test('ensureAndroidAbi：3 秒超时按 arm64 回退（测试用短超时）', async () => {
  resetAbi();
  try {
    setAndroidAbiDetectorForTests(() => new Promise(() => {}), 10);
    const started = Date.now();
    await ensureAndroidAbi();
    assert.equal(preferredAndroidAbi(), 'arm64-v8a');
    assert.ok(Date.now() - started < 1_000, '超时后立即返回，不阻塞更新检查');
  } finally {
    resetAbi();
  }
});

test('setAndroidAbiForTests：直接固定首选 ABI，不清空探测结果就不重新探测', async () => {
  resetAbi();
  try {
    setAndroidAbiForTests('armeabi-v7a');
    await ensureAndroidAbi();
    assert.equal(preferredAndroidAbi(), 'armeabi-v7a');
  } finally {
    resetAbi();
  }
});
