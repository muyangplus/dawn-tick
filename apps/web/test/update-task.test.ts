import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  IDLE_UPDATE_TASK,
  createUpdateTaskStore,
  isUpdateTaskBusy,
  reduceUpdateTask,
} from '../src/lib/update-task.ts';
import {
  INITIAL_UPDATE_STATE,
  planUpdateDownload,
  type UpdateDownloadHost,
} from '../src/lib/update-download.ts';
import type { UpdateManifest } from '../src/update.ts';

const URL = 'https://example.com/DawnTick-0.6.0-release-windows-x64-setup.exe';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function manifestWith(assets: UpdateManifest['assets']): UpdateManifest {
  return { channel: 'release', version: '0.6.0', assets };
}

/** 下载计划：小文件走单流，store 的映射与任务编排才是这些用例的重点。 */
function planFor(bytes: Uint8Array): ReturnType<typeof planUpdateDownload> {
  return planUpdateDownload(
    manifestWith({ windows: { url: URL, size: bytes.length, sha256: digestOf(bytes) } }),
    'windows',
  );
}

function streamResponse(data: Uint8Array): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(data.length) }),
    body: stream,
  } as unknown as Response;
}

interface HostCalls {
  writes: Array<{ name: string; bytes: Uint8Array }>;
  installs: string[];
}

function fakeHost(needsPermission = false): { host: UpdateDownloadHost; calls: HostCalls } {
  const calls: HostCalls = { writes: [], installs: [] };
  const host: UpdateDownloadHost = {
    readChecksum: async () => null,
    write: async (name, bytes) => {
      calls.writes.push({ name, bytes });
      return `C:\\data\\${name}`;
    },
    install: async (path) => {
      calls.installs.push(path);
      return { needsPermission };
    },
  };
  return { host, calls };
}

// —— 生命周期 ——

test('后台任务：下载 → 校验 → ready（不自动安装）→ 安装', async () => {
  const bytes = bytesOf('dawn tick update');
  const plan = planFor(bytes);
  assert.equal(plan.kind, 'download');
  const { host, calls } = fakeHost();
  const store = createUpdateTaskStore();
  const statuses: string[] = [];
  store.subscribe(() => statuses.push(store.getState().status));

  const pending = store.start({ version: '0.6.0', plan, host, fetchImpl: async () => streamResponse(bytes) });
  assert.equal(store.getState().status, 'downloading', 'start 同步进入下载中');
  assert.equal(isUpdateTaskBusy(store.getState()), true);

  const final = await pending;
  assert.equal(final.status, 'ready');
  assert.equal(final.installed, false);
  assert.equal(final.progress, 1);
  assert.equal(final.action, 'install');
  assert.equal(final.path, 'C:\\data\\DawnTick-update.exe');
  assert.ok(statuses.includes('verifying'), '经过校验阶段');
  assert.equal(calls.installs.length, 0, 'deferInstall：就绪不自动拉起安装器');
  assert.equal(calls.writes.length, 1);

  await store.install();
  assert.equal(store.getState().installed, true);
  assert.equal(store.getState().installing, false);
  assert.match(store.getState().message ?? '', /安装程序已启动/);
  assert.deepEqual(calls.installs, ['C:\\data\\DawnTick-update.exe']);
});

test('后台任务：失败后用同一份输入重试成功', async () => {
  const bytes = bytesOf('retry me');
  const plan = planFor(bytes);
  const { host } = fakeHost();
  const store = createUpdateTaskStore();
  let attempts = 0;

  const failed = await store.start({
    version: '0.6.0',
    plan,
    host,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return streamResponse(bytes);
    },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'offline');

  const retried = await store.retry();
  assert.equal(retried.status, 'ready');
  assert.equal(attempts, 2, '重试复用上一次的计划与 host');
});

test('后台任务：取消下载后状态为 cancelled，且可重新开始', async () => {
  const bytes = bytesOf('cancel me');
  const plan = planFor(bytes);
  const { host } = fakeHost();
  const store = createUpdateTaskStore();

  const pending = store.start({
    version: '0.6.0',
    plan,
    host,
    fetchImpl: (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  });
  assert.equal(store.getState().status, 'downloading');
  store.cancel();
  const cancelled = await pending;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(store.getState().status, 'cancelled');
  assert.equal(store.getState().bytesPerSecond, null);

  // 取消不是失败：重新下载走同一入口
  const restarted = await store.start({
    version: '0.6.0',
    plan,
    host,
    fetchImpl: async () => streamResponse(bytes),
  });
  assert.equal(restarted.status, 'ready');
});

test('后台任务：Web 渠道直接就绪，安装动作换成刷新页面', async () => {
  const { host } = fakeHost();
  let reloads = 0;
  const store = createUpdateTaskStore({
    reload: () => {
      reloads += 1;
    },
  });

  const ready = await store.start({ version: '0.6.0', plan: { kind: 'refresh' }, host });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.action, 'refresh');
  assert.equal(ready.progress, 1);
  assert.equal(reloads, 0, '就绪本身不刷新，等用户点「刷新页面」');

  await store.install();
  assert.equal(reloads, 1);
  assert.equal(store.getState().installed, true);
});

test('后台任务：没有可安装资产时直接失败，原因可读', async () => {
  const { host } = fakeHost();
  const store = createUpdateTaskStore();
  const final = await store.start({ version: '0.6.0', plan: planUpdateDownload(manifestWith({}), 'windows'), host });
  assert.equal(final.status, 'failed');
  assert.match(String(final.error), /没有提供 Windows 安装包/);
  assert.equal(final.version, '0.6.0');
});

test('后台任务：开始新任务会中止旧任务（单任务）', async () => {
  const bytes = bytesOf('task swap');
  const plan = planFor(bytes);
  const { host } = fakeHost();
  const store = createUpdateTaskStore();
  let firstSignal: AbortSignal | undefined;

  void store.start({
    version: '0.6.0',
    plan,
    host,
    fetchImpl: (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        firstSignal = (init as { signal?: AbortSignal } | undefined)?.signal;
        firstSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  });
  assert.equal(store.getState().status, 'downloading');

  const second = await store.start({
    version: '0.7.0',
    plan: { kind: 'refresh' },
    host,
  });
  assert.equal(firstSignal?.aborted, true, '旧任务的 signal 被中止');
  assert.equal(second.version, '0.7.0');
  assert.equal(second.action, 'refresh');
});

// —— 纯状态机 ——

test('reduceUpdateTask：下载状态映射与重置', () => {
  let state = reduceUpdateTask(IDLE_UPDATE_TASK, { type: 'start', version: '0.6.0', action: 'install' });
  assert.equal(state.status, 'downloading');
  assert.equal(state.version, '0.6.0');

  state = reduceUpdateTask(state, {
    type: 'download',
    state: { ...INITIAL_UPDATE_STATE, phase: 'verifying', progress: 1, message: '正在校验安装包…' },
  });
  assert.equal(state.status, 'verifying');
  assert.equal(state.progress, 1);

  state = reduceUpdateTask(state, {
    type: 'download',
    state: {
      ...INITIAL_UPDATE_STATE,
      phase: 'ready',
      progress: 1,
      path: 'C:\\x.exe',
      message: '安装包已下载并校验完成，可以安装',
    },
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.path, 'C:\\x.exe');
  assert.equal(state.installed, false);

  state = reduceUpdateTask(state, {
    type: 'download',
    state: { ...INITIAL_UPDATE_STATE, phase: 'installing', message: '正在启动安装程序…' },
  });
  assert.equal(state.installing, true);

  state = reduceUpdateTask(state, {
    type: 'download',
    state: {
      ...INITIAL_UPDATE_STATE,
      phase: 'done',
      message: '安装程序已启动，请按提示完成安装',
      path: 'C:\\x.exe',
    },
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.installed, true);
  assert.equal(state.installing, false);

  const failed = reduceUpdateTask(state, { type: 'failed', version: '0.6.0', error: '网络中断' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, '网络中断');

  const cancelled = reduceUpdateTask(failed, { type: 'cancelled' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.error, null);

  assert.equal(reduceUpdateTask(cancelled, { type: 'reset' }).status, 'idle');
});
