import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL, CHANNEL_LABEL, FEATURES, appVersion, featureVisible, type Channel } from '../src/channel.ts';

test('未注入渠道时默认开发版', () => {
  assert.equal(CHANNEL, 'dev');
  assert.equal(CHANNEL_LABEL.dev, '开发版');
});

test('诊断入口在正式版隐藏', () => {
  assert.equal(featureVisible('diagnostics', 'dev'), true);
  assert.equal(featureVisible('diagnostics', 'beta'), true);
  assert.equal(featureVisible('diagnostics', 'release'), false);
});

test('功能表只保留诊断入口', () => {
  assert.deepEqual(Object.keys(FEATURES), ['diagnostics']);
});

test('功能表的渠道取值都在渠道集合内', () => {
  const channels: readonly Channel[] = ['dev', 'beta', 'release'];
  for (const [id, list] of Object.entries(FEATURES)) {
    assert.ok(list.length > 0, `${id} 未声明任何渠道`);
    for (const channel of list) {
      assert.ok(channels.includes(channel), `${id} 含未知渠道 ${channel}`);
    }
  }
});

test('版本号为构建时取值，缺失时回退', () => {
  assert.match(appVersion(), /^\d+\.\d+\.\d+/);
});
