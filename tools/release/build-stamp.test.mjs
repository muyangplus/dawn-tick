import test from 'node:test';
import assert from 'node:assert/strict';
import { baseVersion, buildStamp, stampVersion, versionCodeOf } from './build-stamp.mjs';

test('构建时间戳为 yyyyMMddHHmm', () => {
  const date = new Date(2025, 9, 13, 14, 30, 59);
  assert.equal(buildStamp(date), '202510131430');
});

test('dev 版本带时间戳，其他渠道保持语义版本', () => {
  const date = new Date(2025, 9, 13, 14, 30);
  assert.equal(stampVersion('0.1.0', 'dev', date), '0.1.0.202510131430');
  assert.equal(stampVersion('0.1.0', 'beta', date), '0.1.0');
  assert.equal(stampVersion('0.1.0', 'release', date), '0.1.0');
});

test('versionCode 随时间单调递增且在 32 位内', () => {
  const early = versionCodeOf(new Date(2025, 0, 1, 0, 0));
  const later = versionCodeOf(new Date(2025, 0, 1, 0, 5));
  assert.equal(later - early, 5);
  assert.ok(later > 0 && later < 2_147_483_647);
});

test('比较版本时忽略构建时间戳', () => {
  assert.equal(baseVersion('0.1.0.202510131430'), '0.1.0');
  assert.equal(baseVersion('0.2.0'), '0.2.0');
  assert.equal(baseVersion('1.2.3.202501010000'), '1.2.3');
});
