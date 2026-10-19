import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMobileWidgets, pinWidget, readMobileWidgetStates } from '../src/widget-pin.ts';
import { readNotifyStatus } from '../src/permissions.ts';

test('非安卓平台没有桌面小组件', async () => {
  assert.equal(hasMobileWidgets(), false);
  assert.deepEqual(await pinWidget('next'), {
    status: 'unsupported',
    reason: '当前平台没有桌面小组件',
  });
  assert.equal(await readMobileWidgetStates(), null);
});

test('非安卓平台的通知状态按浏览器权限报告', async () => {
  const status = await readNotifyStatus(null);
  assert.equal(status.appEnabled, false);
  assert.equal(status.runtime, 'unsupported');
  assert.equal(status.channelMuted, false);
  assert.equal(status.channelName, null);
  assert.equal(status.asked, false);
});
