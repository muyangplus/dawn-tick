import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { UpdateManifest } from '../src/update.ts';
import type { UpdateDownloadHost } from '../src/lib/update-download.ts';
import {
  dismissUpdateTask,
  setUpdateHostFactoryForTests,
  startAutomaticUpdate,
  updateTaskSnapshot,
} from '../src/lib/update-task.ts';

/**
 * 「默认一次点击」的底层保证：下载 + 校验完成后自动进入安装链路。
 * 这里只验证状态机与调用顺序，网络、写盘与安装器都用注入的假出口。
 */

const CONTENT = new TextEncoder().encode('dawn-tick one-click payload');
const NAME = 'DawnTick-0.8.0-release-windows-x64-setup.exe';
const PORTABLE_NAME = 'DawnTick-0.8.0-release-windows-x64-portable.zip';

function digest(): string {
  return createHash('sha256').update(CONTENT).digest('hex');
}

function manifest(): UpdateManifest {
  return {
    channel: 'release',
    version: '0.8.0',
    checksumsUrl: 'https://example.com/download/SHA256SUMS.txt',
    assets: {
      windows: { url: `https://example.com/download/${NAME}`, name: NAME, size: CONTENT.length },
      windowsPortable: {
        url: `https://example.com/download/${PORTABLE_NAME}`,
        name: PORTABLE_NAME,
        size: CONTENT.length,
      },
    },
  };
}

interface Calls {
  writes: string[];
  installs: string[];
  portables: string[];
  exits: number;
}

function fakeHost(): { host: UpdateDownloadHost; calls: Calls } {
  const calls: Calls = { writes: [], installs: [], portables: [], exits: 0 };
  const host: UpdateDownloadHost = {
    fetchImpl: async () =>
      new Response(CONTENT, { status: 200, headers: { 'content-length': String(CONTENT.length) } }),
    readChecksum: async () => `${digest()}  ${NAME}\n${digest()}  ${PORTABLE_NAME}\n`,
    write: async (name) => {
      calls.writes.push(name);
      return `C:\\Temp\\${name}`;
    },
    install: async (path) => {
      calls.installs.push(path);
      return { needsPermission: false };
    },
    installPortable: async (path) => {
      calls.portables.push(path);
      return 'C:\\Temp\\dawn-tick-update.cmd';
    },
    exitForUpdate: async () => {
      calls.exits += 1;
    },
  };
  return { host, calls };
}

function reset(): void {
  setUpdateHostFactoryForTests(null);
  dismissUpdateTask();
  assert.equal(updateTaskSnapshot().status, 'idle');
}

test('一键更新：安装版下载校验后自动交给安装器，无需再点安装', async () => {
  reset();
  const { host, calls } = fakeHost();
  try {
    const final = await startAutomaticUpdate(manifest(), { platform: 'windows', installKind: 'installed', host });
    assert.equal(final.status, 'ready');
    assert.equal(final.installed, true, '下载完成后自动安装');
    assert.deepEqual(calls.writes, ['DawnTick-update.exe']);
    assert.deepEqual(calls.installs, ['C:\\Temp\\DawnTick-update.exe']);
    assert.equal(final.message, '安装程序已启动，请按提示完成安装');
  } finally {
    reset();
  }
});

test('一键更新：便携版下载校验后准备替换脚本并退出应用', async () => {
  reset();
  const { host, calls } = fakeHost();
  try {
    const installing: boolean[] = [];
    const final = await startAutomaticUpdate(
      manifest(),
      { platform: 'windows', installKind: 'portable', host },
      { onInstalling: () => installing.push(true) },
    );
    assert.deepEqual(calls.writes, ['DawnTick-update.zip']);
    assert.deepEqual(calls.portables, ['C:\\Temp\\DawnTick-update.zip']);
    assert.equal(calls.exits, 1, '准备就绪后自动退出，让替换脚本覆盖 exe');
    assert.deepEqual(calls.installs, [], '便携版不启动系统安装器');
    assert.equal(final.installed, true);
    assert.deepEqual(installing, [true], '界面能收到「开始安装」的时机');
  } finally {
    reset();
  }
});

test('一键更新：下载失败不进入安装，保留可读原因', async () => {
  reset();
  const { host, calls } = fakeHost();
  const failing: UpdateDownloadHost = {
    ...host,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  };
  try {
    const final = await startAutomaticUpdate(manifest(), { platform: 'windows', installKind: 'installed', host: failing });
    assert.equal(final.status, 'failed');
    assert.match(String(final.error), /offline/);
    assert.deepEqual(calls.installs, [], '下载失败不启动安装器');
    assert.deepEqual(calls.writes, []);
  } finally {
    reset();
  }
});

test('一键更新：Web 渠道标记为已刷新，不调用安装器', async () => {
  reset();
  const { host, calls } = fakeHost();
  try {
    const final = await startAutomaticUpdate(manifest(), { platform: 'web', host });
    assert.equal(final.installed, true);
    assert.match(String(final.message), /刷新页面/);
    assert.deepEqual(calls.installs, []);
  } finally {
    reset();
  }
});

test('测试出口工厂：弹窗不传 host 时也能用桩替换下载与安装', async () => {
  reset();
  const { host, calls } = fakeHost();
  setUpdateHostFactoryForTests(() => host);
  try {
    const final = await startAutomaticUpdate(manifest(), { platform: 'windows', installKind: 'installed' });
    assert.equal(final.installed, true);
    assert.deepEqual(calls.installs, ['C:\\Temp\\DawnTick-update.exe']);
  } finally {
    reset();
  }
});
