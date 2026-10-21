import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { UpdateManifest } from '../src/update.ts';
import {
  INITIAL_UPDATE_STATE,
  digestMatches,
  downloadBytes,
  formatDownloadProgress,
  installerFileName,
  isUpdateBusy,
  parseSha256,
  planUpdateDownload,
  reduceUpdateState,
  runUpdateDownload,
  sha256Hex,
  type UpdateDownloadHost,
  type UpdateDownloadState,
} from '../src/lib/update-download.ts';
import { joinPath } from '../src/lib/update-install.ts';

/** 发布清单：资产名与发布流程一致（`DawnTick-<版本>-<渠道>-…`）。 */
function manifestWith(assets: UpdateManifest['assets']): UpdateManifest {
  return { channel: 'release', version: '0.5.0', assets };
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 流式响应：把字节切成多块，模拟真实下载的进度回调。 */
function streamResponse(chunks: Uint8Array[], total?: number): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = new Headers(total === undefined ? {} : { 'content-length': String(total) });
  return { ok: true, status: 200, headers, body: stream } as unknown as Response;
}

interface HostCalls {
  writes: Array<{ name: string; bytes: Uint8Array }>;
  installs: string[];
  checksumUrls: string[];
}

function fakeHost(options: { checksum?: string | null; needsPermission?: boolean } = {}): {
  host: UpdateDownloadHost;
  calls: HostCalls;
} {
  const calls: HostCalls = { writes: [], installs: [], checksumUrls: [] };
  const host: UpdateDownloadHost = {
    readChecksum: async (url) => {
      calls.checksumUrls.push(url);
      return options.checksum ?? null;
    },
    write: async (name, bytes) => {
      calls.writes.push({ name, bytes });
      return `C:\\data\\${name}`;
    },
    install: async (path) => {
      calls.installs.push(path);
      return { needsPermission: options.needsPermission === true };
    },
  };
  return { host, calls };
}

const WINDOWS_ASSET = {
  url: 'https://example.com/download/DawnTick-0.5.0-release-windows-x64-setup.exe',
  size: 12,
  checksumUrl: 'https://example.com/download/DawnTick-0.5.0-release-windows-x64-setup.exe.sha256',
};

// —— 渠道 → 资产选择 ——

test('桌面取 Windows 安装包，Android 取 APK，Web 只提示刷新', () => {
  const manifest = manifestWith({
    windows: WINDOWS_ASSET,
    android: { url: 'https://example.com/download/DawnTick-0.5.0-release-android.apk', size: 9 },
    web: { url: 'https://example.com/download/DawnTick-0.5.0-release-web.zip' },
  });

  const windows = planUpdateDownload(manifest, 'windows');
  assert.equal(windows.kind, 'download');
  if (windows.kind !== 'download') return;
  assert.equal(windows.target.url, WINDOWS_ASSET.url);
  assert.equal(windows.target.fileName, 'DawnTick-update.exe', '固定落盘名，重复下载覆盖旧包');
  assert.equal(windows.target.checksumUrl, WINDOWS_ASSET.checksumUrl);

  const android = planUpdateDownload(manifest, 'android');
  assert.equal(android.kind, 'download');
  if (android.kind !== 'download') return;
  assert.equal(android.target.fileName, 'DawnTick-update.apk');

  assert.deepEqual(planUpdateDownload(manifest, 'web'), { kind: 'refresh' });
});

test('缺资产或不是安装包时给可读原因', () => {
  const missing = planUpdateDownload(manifestWith({}), 'windows');
  assert.equal(missing.kind, 'unavailable');
  if (missing.kind === 'unavailable') assert.match(missing.reason, /没有提供 Windows 安装包/);

  const portable = planUpdateDownload(
    manifestWith({ windows: { url: 'https://example.com/download/DawnTick-0.5.0-release-windows-x64-portable.zip' } }),
    'windows',
  );
  assert.equal(portable.kind, 'unavailable');
  if (portable.kind === 'unavailable') assert.match(portable.reason, /不是安装包/);

  const noWeb = planUpdateDownload(null, 'android');
  assert.equal(noWeb.kind, 'unavailable');

  assert.equal(installerFileName('windows', 'https://x/DawnTick-0.5.0-release-windows-x64-setup.exe'), 'DawnTick-update.exe');
  assert.equal(installerFileName('windows', 'https://x/setup.MSI'), 'DawnTick-update.msi');
  assert.equal(installerFileName('android', 'https://x/app.apk?download=1'), 'DawnTick-update.apk');
  assert.equal(installerFileName('android', 'https://x/app.zip'), null);
});

// —— SHA-256 校验 ——

test('sha256 解析与比对：支持裸摘要与 `摘要  文件名`', async () => {
  const bytes = bytesOf('dawn-tick');
  const digest = digestOf(bytes);
  assert.equal(parseSha256(digest), digest);
  assert.equal(parseSha256(`${digest.toUpperCase()}  DawnTick-setup.exe\n`), digest);
  assert.equal(parseSha256('not-a-digest'), null);
  assert.equal(await sha256Hex(bytes), digest);
  assert.equal(digestMatches(digest.toUpperCase(), digest), true);
  assert.equal(digestMatches('0'.repeat(64), digest), false);
});

test('下载成功：流式进度 → 校验 → 写盘 → 启动安装器', async () => {
  const content = 'hello update';
  const bytes = bytesOf(content);
  const checksum = `${digestOf(bytes)}  DawnTick-setup.exe\n`;
  const { host, calls } = fakeHost({ checksum });
  const states: UpdateDownloadState[] = [];
  const plan = planUpdateDownload(manifestWith({ windows: WINDOWS_ASSET }), 'windows');

  const final = await runUpdateDownload({
    plan,
    host: { ...host, fetchImpl: async () => streamResponse([bytesOf('hello '), bytesOf('update')], bytes.length) },
    onState: (state) => states.push(state),
  });

  assert.equal(final.phase, 'done');
  assert.equal(final.message, '安装程序已启动，请按提示完成安装');
  assert.equal(final.path, 'C:\\data\\DawnTick-update.exe');
  assert.equal(states[0]?.phase, 'downloading');
  assert.ok(states.some((state) => state.phase === 'verifying'), '经过校验阶段');
  assert.ok(states.some((state) => state.phase === 'installing'), '经过写盘阶段');
  assert.equal(states.at(-1)?.phase, 'done');
  assert.equal(states.find((state) => state.progress === 1)?.total, bytes.length, '进度用 content-length');
  assert.deepEqual(calls.writes.map((item) => item.name), ['DawnTick-update.exe']);
  assert.equal(new TextDecoder().decode(calls.writes[0]?.bytes), content);
  assert.deepEqual(calls.checksumUrls, [WINDOWS_ASSET.checksumUrl]);
  assert.deepEqual(calls.installs, ['C:\\data\\DawnTick-update.exe']);
});

test('没有 content-length 时用清单里的 size 显示进度', async () => {
  const content = '123456789012';
  const bytes = bytesOf(content);
  assert.equal(bytes.length, WINDOWS_ASSET.size);
  const { host } = fakeHost({ checksum: digestOf(bytes) });
  const plan = planUpdateDownload(manifestWith({ windows: WINDOWS_ASSET }), 'windows');
  const states: UpdateDownloadState[] = [];

  const final = await runUpdateDownload({
    plan,
    host,
    fetchImpl: async () => streamResponse([bytesOf(content.slice(0, 6)), bytesOf(content.slice(6))]),
    onState: (state) => states.push(state),
  });

  assert.equal(final.phase, 'done');
  const progress = states.filter((state) => state.phase === 'downloading' && state.received > 0).at(-1);
  assert.equal(progress?.total, WINDOWS_ASSET.size);
  assert.equal(progress?.progress, 1);
});

test('校验失败：不写盘、不安装，原因可读', async () => {
  const bytes = bytesOf('tampered');
  const { host, calls } = fakeHost({ checksum: '0'.repeat(64) });
  const plan = planUpdateDownload(manifestWith({ windows: WINDOWS_ASSET }), 'windows');

  const final = await runUpdateDownload({ plan, host, fetchImpl: async () => streamResponse([bytes]) });

  assert.equal(final.phase, 'failed');
  assert.match(String(final.error), /校验失败/);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.installs.length, 0);
});

test('没有校验文件时不安装（fail closed）', async () => {
  const bytes = bytesOf('unsigned');
  const { host, calls } = fakeHost({ checksum: null });
  const plan = planUpdateDownload(manifestWith({ windows: WINDOWS_ASSET }), 'windows');

  const final = await runUpdateDownload({ plan, host, fetchImpl: async () => streamResponse([bytes]) });

  assert.equal(final.phase, 'failed');
  assert.match(String(final.error), /没有提供校验文件/);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.installs.length, 0);
});

test('清单直接带 sha256 时不再拉取 .sha256 资产', async () => {
  const bytes = bytesOf('inline digest');
  const digest = digestOf(bytes);
  const { host, calls } = fakeHost();
  const plan = planUpdateDownload(
    manifestWith({ windows: { url: WINDOWS_ASSET.url, sha256: digest } }),
    'windows',
  );

  const final = await runUpdateDownload({ plan, host, fetchImpl: async () => streamResponse([bytes]) });

  assert.equal(final.phase, 'done');
  assert.deepEqual(calls.checksumUrls, []);
});

test('网络失败给可读原因，状态可重试（failed → start）', async () => {
  const { host } = fakeHost();
  const plan = planUpdateDownload(manifestWith({ windows: WINDOWS_ASSET }), 'windows');
  const final = await runUpdateDownload({
    plan,
    host,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });

  assert.equal(final.phase, 'failed');
  assert.equal(final.error, 'offline');
  const retried = reduceUpdateState(final, { type: 'start' });
  assert.equal(retried.phase, 'downloading');
  assert.equal(retried.error, null);
});

test('没有资产时不下载，直接给失败原因', async () => {
  const { host, calls } = fakeHost();
  const final = await runUpdateDownload({
    plan: planUpdateDownload(manifestWith({}), 'windows'),
    host,
  });
  assert.equal(final.phase, 'failed');
  assert.match(String(final.error), /没有提供 Windows 安装包/);
  assert.equal(calls.writes.length, 0);
});

test('Android 未授权「安装未知应用」：保留路径并提示授权后重试', async () => {
  const bytes = bytesOf('apk');
  const { host, calls } = fakeHost({ checksum: digestOf(bytes), needsPermission: true });
  const plan = planUpdateDownload(
    manifestWith({
      android: {
        url: 'https://example.com/download/DawnTick-0.5.0-release-android.apk',
        checksumUrl: 'https://example.com/download/DawnTick-0.5.0-release-android.apk.sha256',
      },
    }),
    'android',
  );

  const final = await runUpdateDownload({
    plan,
    host: { ...host, write: async () => 'file:///data/user/0/com.dawntick.app/cache/DawnTick-update.apk' },
    fetchImpl: async () => streamResponse([bytes]),
  });

  assert.equal(final.phase, 'failed');
  assert.equal(final.needsPermission, true);
  assert.match(String(final.error), /已跳转系统设置/);
  assert.equal(final.path, 'file:///data/user/0/com.dawntick.app/cache/DawnTick-update.apk');
  assert.equal(calls.installs.length, 1);
});

test('Web 渠道不下载：直接给出「刷新页面后生效」', async () => {
  const { host, calls } = fakeHost();
  const final = await runUpdateDownload({ plan: planUpdateDownload(manifestWith({}), 'web'), host });
  assert.equal(final.phase, 'done');
  assert.match(String(final.message), /刷新页面/);
  assert.equal(calls.writes.length, 0);
});

// —— 取消 ——

test('取消下载：中止网络，回到 idle，不写盘不安装', async () => {
  const { host, calls } = fakeHost({ checksum: '0'.repeat(64) });
  const plan = planUpdateDownload(manifestWith({ windows: WINDOWS_ASSET }), 'windows');
  const controller = new AbortController();
  const states: UpdateDownloadState[] = [];

  const pending = runUpdateDownload({
    plan,
    host,
    signal: controller.signal,
    onState: (state) => states.push(state),
    fetchImpl: (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  });
  controller.abort();
  const final = await pending;

  assert.equal(final.phase, 'idle');
  assert.equal(final.message, '已取消下载');
  assert.equal(states.at(-1)?.phase, 'idle');
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.installs.length, 0);
});

test('流式下载中取消：已接收的数据不再继续，抛出可读取消原因', async () => {
  const controller = new AbortController();
  const first = bytesOf('partial');
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(first);
      // 取消时关流：正卡在 read() 上的下载立刻结束
      controller.signal.addEventListener('abort', () => streamController.close(), { once: true });
    },
  });
  const response = { ok: true, status: 200, headers: new Headers(), body: stream } as unknown as Response;

  const pending = downloadBytes({
    url: 'https://example.com/a.bin',
    signal: controller.signal,
    fetchImpl: async () => response,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();

  await assert.rejects(pending, /已取消下载/);
});

// —— 状态机 ——

test('状态机只接受合法转移', () => {
  const started = reduceUpdateState(INITIAL_UPDATE_STATE, { type: 'start' });
  assert.equal(started.phase, 'downloading');
  assert.equal(isUpdateBusy(started.phase), true);

  const verifying = reduceUpdateState(started, { type: 'verify' });
  assert.equal(verifying.phase, 'verifying');
  const installing = reduceUpdateState(verifying, { type: 'install' });
  assert.equal(installing.phase, 'installing');
  const done = reduceUpdateState(installing, { type: 'done', message: '安装程序已启动，请按提示完成安装' });
  assert.equal(done.phase, 'done');
  assert.equal(isUpdateBusy(done.phase), false);

  assert.deepEqual(reduceUpdateState(INITIAL_UPDATE_STATE, { type: 'progress', received: 1, total: 2 }), INITIAL_UPDATE_STATE);
  assert.deepEqual(reduceUpdateState(INITIAL_UPDATE_STATE, { type: 'install' }), INITIAL_UPDATE_STATE);
  assert.deepEqual(reduceUpdateState(done, { type: 'fail', error: 'x' }), done, '已完成后不再接受失败');

  const failed = reduceUpdateState(started, { type: 'fail', error: '网络中断' });
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.error, '网络中断');

  const cancelled = reduceUpdateState(verifying, { type: 'cancel' });
  assert.equal(cancelled.phase, 'idle');
  assert.equal(cancelled.message, '已取消下载');

  assert.equal(reduceUpdateState(started, { type: 'check' }).phase, 'downloading', '进行中不再进入 checking');
  assert.equal(reduceUpdateState(INITIAL_UPDATE_STATE, { type: 'check' }).phase, 'checking');
  assert.equal(reduceUpdateState(started, { type: 'reset' }).phase, 'idle');
});

test('路径拼接与进度文案', () => {
  assert.equal(joinPath('C:\\Users\\me\\AppData\\Local\\DawnTick', 'a.exe'), 'C:\\Users\\me\\AppData\\Local\\DawnTick\\a.exe');
  assert.equal(joinPath('/data/user/0/app/cache/', 'a.apk'), '/data/user/0/app/cache/a.apk');

  const downloading = { ...INITIAL_UPDATE_STATE, phase: 'downloading' as const, received: 1536, total: 2048, progress: 0.75 };
  assert.equal(formatDownloadProgress(downloading), '已下载 1.5 KB / 2.0 KB（75%）');
  const unknown = { ...INITIAL_UPDATE_STATE, phase: 'downloading' as const, received: 10 };
  assert.equal(formatDownloadProgress(unknown), '已下载 10 B');
  assert.equal(formatDownloadProgress({ ...INITIAL_UPDATE_STATE, phase: 'verifying', message: '正在校验安装包…' }), '正在校验安装包…');
});
