import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceGroupSummaries,
  type DeviceGroupSummaryInput,
} from '../src/screens/devices-group-summaries.ts';

/** 桌面 + 正式版 + 已有一份快照的完整状态。 */
function input(overrides: Partial<DeviceGroupSummaryInput> = {}): DeviceGroupSummaryInput {
  return {
    storageKind: 'SQLite',
    storageLocation: 'default',
    persistent: null,
    snapshotCount: 1,
    version: '0.6.3',
    channelLabel: '正式版',
    webdavConfigured: false,
    logLevel: 'trace',
    logEnabled: true,
    ...overrides,
  };
}

test('设备分组摘要按当前状态拼成一行', () => {
  assert.deepEqual(deviceGroupSummaries(input()), {
    storage: 'SQLite · 默认位置',
    backup: '最近 1 份快照',
    update: '0.6.3 · 正式版',
    webdav: '未配置',
    lan: '同局域网直传',
    maintenance: '日志级别 trace',
    about: 'v0.6.3',
  });
});

test('存储摘要优先数据目录，其次浏览器持久化，都拿不到时只留存储类型', () => {
  assert.equal(deviceGroupSummaries(input({ storageLocation: 'custom' })).storage, 'SQLite · 自定义位置');
  // 浏览器端没有数据目录：用持久化授权说明
  assert.equal(
    deviceGroupSummaries(input({ storageKind: 'IndexedDB', storageLocation: null, persistent: true })).storage,
    'IndexedDB · 已持久化',
  );
  assert.equal(
    deviceGroupSummaries(input({ storageKind: 'IndexedDB', storageLocation: null, persistent: false })).storage,
    'IndexedDB · 未持久化',
  );
  // 未申请 / 不支持的平台不编造状态
  assert.equal(
    deviceGroupSummaries(input({ storageKind: 'IndexedDB', storageLocation: null, persistent: null })).storage,
    'IndexedDB',
  );
});

test('没有快照时摘要不显示「0 份」', () => {
  assert.equal(deviceGroupSummaries(input({ snapshotCount: 0 })).backup, '暂无快照');
  assert.equal(deviceGroupSummaries(input({ snapshotCount: 12 })).backup, '最近 12 份快照');
});

test('WebDAV 摘要区分已配置与未配置', () => {
  assert.equal(deviceGroupSummaries(input({ webdavConfigured: true })).webdav, '已配置');
  assert.equal(deviceGroupSummaries(input({ webdavConfigured: false })).webdav, '未配置');
});

test('诊断日志关闭时在摘要里补「已关闭」', () => {
  assert.equal(deviceGroupSummaries(input({ logEnabled: false })).maintenance, '日志级别 trace · 已关闭');
  assert.equal(deviceGroupSummaries(input({ logLevel: 'error' })).maintenance, '日志级别 error');
});

test('更新与关于摘要都带版本，渠道文案来自构建常量', () => {
  const summaries = deviceGroupSummaries(input({ version: '1.2.3', channelLabel: '开发版' }));
  assert.equal(summaries.update, '1.2.3 · 开发版');
  assert.equal(summaries.about, 'v1.2.3');
});
