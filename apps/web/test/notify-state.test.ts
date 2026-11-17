import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFY_STATE_LABEL, isNotifyAbnormal, notifyNextStep, notifyStateOf } from '../src/notify-state.ts';
import { fail } from '../src/copy/zh.ts';
import type { NotifyStatus } from '../src/permissions.ts';

const base: NotifyStatus = {
  source: 'android',
  appEnabled: true,
  runtime: 'granted',
  channelMuted: false,
  channelName: null,
  channelId: null,
  asked: true,
};

test('通知权限六态一一对应', () => {
  assert.equal(notifyStateOf(base).label, '已允许');
  assert.equal(notifyStateOf({ ...base, runtime: 'prompt', asked: false }).label, '未申请');
  assert.equal(notifyStateOf({ ...base, runtime: 'denied' }).label, '已拒绝');
  assert.equal(notifyStateOf({ ...base, runtime: 'permanently-denied' }).label, '已拒绝且不再询问');
  assert.equal(notifyStateOf({ ...base, appEnabled: false }).label, '通知已关闭');
  assert.equal(
    notifyStateOf({ ...base, channelMuted: true, channelId: 'class', channelName: '课前提醒' }).label,
    '通知渠道已静音',
  );
  // 六态之外只允许「读取中 / 不支持」，不另造词
  assert.deepEqual(Object.values(NOTIFY_STATE_LABEL).toSorted(), [
    '未申请',
    '已允许',
    '已拒绝',
    '已拒绝且不再询问',
    '当前环境不支持通知',
    '通知已关闭',
    '通知渠道已静音',
    '通知状态不可读',
    '读取中…',
  ].toSorted());
});

test('桌面端只按通知插件能报的三态显示', () => {
  const tauri: NotifyStatus = {
    ...base,
    source: 'tauri',
    runtime: 'granted',
  };
  assert.equal(notifyStateOf(tauri).label, '已允许');
  assert.equal(notifyStateOf({ ...tauri, runtime: 'prompt', asked: false }).label, '未申请');
  assert.equal(notifyStateOf({ ...tauri, runtime: 'denied' }).label, '已拒绝');
  // 桌面读不到应用级开关/渠道，不能假装成「通知已关闭」
  assert.equal(notifyStateOf({ ...tauri, appEnabled: false, channelMuted: true }).label, '已允许');
  assert.equal(notifyStateOf({ ...tauri, runtime: 'unsupported' }).label, '当前环境不支持通知');
  assert.equal(notifyStateOf({ ...tauri, runtime: 'unreadable' }).label, '通知状态不可读');
});

test('权限异常给出下一步且只在异常时提示', () => {
  assert.equal(isNotifyAbnormal(notifyStateOf({ ...base, runtime: 'denied' })), true);
  assert.equal(isNotifyAbnormal(notifyStateOf({ ...base, appEnabled: false })), true);
  assert.equal(isNotifyAbnormal(notifyStateOf(base)), false);
  assert.equal(isNotifyAbnormal(notifyStateOf({ ...base, runtime: 'prompt', asked: false })), false);
  assert.equal(notifyNextStep(notifyStateOf({ ...base, runtime: 'denied' })), '重新申请通知权限');
  assert.equal(notifyNextStep(notifyStateOf({ ...base, runtime: 'permanently-denied' })), '去系统设置开启');
});

test('失败句式统一为「xx失败：原因。下一步」', () => {
  assert.equal(fail('保存', '磁盘只读', '请换一个位置'), '保存失败：磁盘只读。请换一个位置');
  assert.equal(fail('重启', null, '请手动重新打开应用'), '重启失败。请手动重新打开应用');
  assert.equal(fail('备份', '  '), '备份失败。');
});
