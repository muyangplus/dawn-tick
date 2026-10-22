import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { UpdateManifest } from '../src/update.ts';
import type { UpdateDownloadHost } from '../src/lib/update-download.ts';
import {
  IDLE_UPDATE_TASK,
  cancelUpdateTask,
  dismissUpdateTask,
  installUpdateTask,
  isUpdateTaskBusy,
  retryUpdateTask,
  startBackgroundUpdate,
  subscribeUpdateTask,
  updateTaskSnapshot,
} from '../src/lib/update-task.ts';

const CONTENT = new TextEncoder().encode('dawn-tick background update payload');
const WINDOWS_URL = 'https://example.com/download/DawnTick-0.7.0-release-windows-x64-setup.exe';

function digest(): string {
  return createHash('sha256').update(CONTENT).digest('hex');
}

const WINDOWS_NAME = 'DawnTick-0.7.0-release-windows-x64-setup.exe';
const ANDROID_NAME = 'DawnTick-0.7.0-release-android.apk';

function manifest(assets: UpdateManifest['assets'] = {}): UpdateManifest {
  return {
    channel: 'release',
    version: '0.7.0',
    checksumsUrl: 'https://example.com/download/SHA256SUMS.txt',
    assets: {
      windows: { url: WINDOWS_URL, name: WINDOWS_NAME, size: CONTENT.length },
      android: {
        url: 'https://example.com/download/DawnTick-0.7.0-release-android.apk',
        name: ANDROID_NAME,
        size: CONTENT.length,
      },
      ...assets,
    },
  };
}

interface HostOptions {
  checksum?: string | null;
  needsPermission?: boolean;
  failFirst?: boolean;
}

interface HostCalls {
  writes: string[];
  installs: string[];
}

function fakeHost(options: HostOptions = {}): { host: UpdateDownloadHost; calls: HostCalls } {
  const calls: HostCalls = { writes: [], installs: [] };
  let fetchCount = 0;
  const host: UpdateDownloadHost = {
    fetchImpl: async () => {
      fetchCount += 1;
      if (options.failFirst === true && fetchCount === 1) throw new Error('offline');
      return new Response(CONTENT, {
        status: 200,
        headers: { 'content-length': String(CONTENT.length) },
      });
    },
    readChecksum: async () =>
      options.checksum === undefined
        ? `${digest()}  ${WINDOWS_NAME}\n${digest()}  ${ANDROID_NAME}\n`
        : options.checksum,
    write: async (name) => {
      calls.writes.push(name);
      return `C:\\data\\${name}`;
    },
    install: async (path) => {
      calls.installs.push(path);
      return { needsPermission: options.needsPermission === true };
    },
  };
  return { host, calls };
}

/** 每个用例都从干净的单例开始：这本身就是「模块级 store」的语义。 */
function reset(): void {
  dismissUpdateTask();
  assert.equal(updateTaskSnapshot().status, IDLE_UPDATE_TASK.status);
}

test('后台任务：下载 → 校验 → ready，安装留给用户点击', async () => {
  reset();
  const { host, calls } = fakeHost();
  const statuses: string[] = [];
  const unsubscribe = subscribeUpdateTask(() => statuses.push(updateTaskSnapshot().status));
  try {
    const final = await startBackgroundUpdate(manifest(), { platform: 'windows', host });
    assert.equal(final.status, 'ready');
    assert.equal(final.version, '0.7.0');
    assert.equal(final.channel, 'release');
    assert.equal(final.progress?.percent, 1);
    assert.equal(final.error, null);
    assert.equal(final.installed, false, '下载完成不等于已安装');
    assert.equal(final.target?.fileName, 'DawnTick-update.exe');
    assert.equal(final.target?.path, 'C:\\data\\DawnTick-update.exe');
    assert.equal(final.target?.installerLabel, 'Windows 安装程序');
    assert.equal(final.message, '安装包已下载并通过校验，可以安装了');
    assert.deepEqual(calls.writes, ['DawnTick-update.exe']);
    assert.deepEqual(calls.installs, [], 'ready 阶段不自动安装');
    assert.ok(statuses.includes('downloading'));
    assert.ok(statuses.includes('verifying'));
    assert.equal(statuses.at(-1), 'ready');
  } finally {
    unsubscribe();
  }
});

test('ready 后安装：交给平台安装器，重复点击不再触发', async () => {
  reset();
  const { host, calls } = fakeHost();
  await startBackgroundUpdate(manifest(), { platform: 'windows', host });
  await installUpdateTask();
  assert.deepEqual(calls.installs, ['C:\\data\\DawnTick-update.exe']);
  assert.equal(updateTaskSnapshot().installed, true);
  assert.equal(updateTaskSnapshot().status, 'ready');
  assert.equal(updateTaskSnapshot().message, '安装程序已启动，请按提示完成安装');
  await installUpdateTask();
  assert.equal(calls.installs.length, 1, '已安装过就不再重复启动安装器');
});

test('Android 未授权「安装未知应用」：ready 后安装转为失败并保留路径', async () => {
  reset();
  const { host } = fakeHost({ needsPermission: true });
  await startBackgroundUpdate(manifest(), { platform: 'android', host });
  assert.equal(updateTaskSnapshot().status, 'ready');
  await installUpdateTask();
  assert.equal(updateTaskSnapshot().status, 'failed');
  assert.equal(updateTaskSnapshot().needsPermission, true);
  assert.match(String(updateTaskSnapshot().error), /允许安装未知应用/);
  assert.equal(updateTaskSnapshot().target?.fileName, 'DawnTick-update.apk');
});

test('授权后重试只再交给安装器，不重新下载', async () => {
  reset();
  const { host, calls } = fakeHost();
  let permissionPending = true;
  const androidHost: UpdateDownloadHost = {
    ...host,
    install: async (path) => {
      calls.installs.push(path);
      const outcome = { needsPermission: permissionPending };
      permissionPending = false;
      return outcome;
    },
  };
  await startBackgroundUpdate(manifest(), { platform: 'android', host: androidHost });
  await installUpdateTask();
  assert.equal(updateTaskSnapshot().status, 'failed');
  const writesBefore = calls.writes.length;

  const retried = await retryUpdateTask();
  assert.equal(retried.status, 'ready');
  assert.equal(retried.installed, true);
  assert.equal(calls.writes.length, writesBefore, '安装包已落盘，重试不再下载');
  assert.equal(calls.installs.length, 2, '授权后再次交给安装器');
});

test('Web 渠道：下载完成即 ready，动作是刷新页面', async () => {
  reset();
  const { host, calls } = fakeHost();
  const final = await startBackgroundUpdate(manifest(), { platform: 'web', host });
  assert.equal(final.status, 'ready');
  assert.equal(final.progress, null);
  assert.equal(final.target?.platform, 'web');
  assert.equal(final.target?.fileName, null);
  assert.equal(final.target?.installerLabel, '刷新页面');
  assert.match(String(final.message), /刷新页面/);
  assert.deepEqual(calls.writes, []);
  await installUpdateTask();
  assert.equal(updateTaskSnapshot().installed, true);
  assert.equal(updateTaskSnapshot().message, '刷新页面后生效');
  assert.deepEqual(calls.installs, [], 'Web 不调用任何安装器');
});

test('没有可安装资产：failed + 可读原因', async () => {
  reset();
  const { host } = fakeHost();
  const final = await startBackgroundUpdate(
    { channel: 'release', version: '0.7.0', assets: {} },
    { platform: 'windows', host },
  );
  assert.equal(final.status, 'failed');
  assert.match(String(final.error), /没有提供 Windows 安装包/);
  assert.equal(final.target?.path, null);
});

test('校验失败：不写盘、不安装，任务保持 failed（fail closed）', async () => {
  reset();
  const { host, calls } = fakeHost({ checksum: `${'0'.repeat(64)}  ${WINDOWS_NAME}\n` });
  const final = await startBackgroundUpdate(manifest(), { platform: 'windows', host });
  assert.equal(final.status, 'failed');
  assert.match(String(final.error), /校验失败/);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(calls.installs, []);
});

test('失败可重试：沿用同一份清单与出口，重试后 ready', async () => {
  reset();
  const { host, calls } = fakeHost({ failFirst: true });
  const failed = await startBackgroundUpdate(manifest(), { platform: 'windows', host });
  assert.equal(failed.status, 'failed');
  assert.match(String(failed.error), /offline/);
  assert.equal(isUpdateTaskBusy(failed.status), false);

  const retried = await retryUpdateTask();
  assert.equal(retried.status, 'ready');
  assert.equal(retried.error, null);
  assert.deepEqual(calls.writes, ['DawnTick-update.exe']);
});

test('取消：任务回到 cancelled，不写盘不安装', async () => {
  reset();
  const { host, calls } = fakeHost();
  const stalled: UpdateDownloadHost = {
    ...host,
    fetchImpl: (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  };
  const pending = startBackgroundUpdate(manifest(), { platform: 'windows', host: stalled });
  await Promise.resolve();
  assert.equal(updateTaskSnapshot().status, 'downloading');
  assert.equal(isUpdateTaskBusy(updateTaskSnapshot().status), true);
  cancelUpdateTask();
  const final = await pending;
  assert.equal(final.status, 'cancelled');
  assert.equal(final.message, '已取消下载');
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(calls.installs, []);
});

test('后台任务不依赖界面：没有订阅者时也继续推进并保留进度', async () => {
  reset();
  const first = CONTENT.slice(0, 8);
  const rest = CONTENT.slice(8);
  const { host } = fakeHost();
  const slowStream: UpdateDownloadHost = {
    ...host,
    fetchImpl: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(first);
            await new Promise((resolve) => setTimeout(resolve, 10));
            controller.enqueue(rest);
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-length': String(CONTENT.length) } },
      ),
  };
  const pending = startBackgroundUpdate(manifest(), { platform: 'windows', host: slowStream });
  await new Promise((resolve) => setTimeout(resolve, 4));
  // 这里没有挂任何 React 组件：任务仍然在下载并保留进度（弹窗关闭后继续下载的底层保证）
  const midway = updateTaskSnapshot();
  assert.equal(midway.status, 'downloading');
  assert.ok((midway.progress?.received ?? 0) > 0, '关掉弹窗后进度仍在推进');
  const final = await pending;
  assert.equal(final.status, 'ready');
  assert.equal(final.progress?.received, CONTENT.length);
});

test('dismiss 清空任务：回到 idle 且不再显示', async () => {
  reset();
  const { host } = fakeHost();
  await startBackgroundUpdate(manifest(), { platform: 'windows', host });
  assert.equal(updateTaskSnapshot().status, 'ready');
  dismissUpdateTask();
  assert.deepEqual(updateTaskSnapshot(), IDLE_UPDATE_TASK);
});
