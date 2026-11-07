import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSETS_REPO,
  DOWNLOAD_SOURCE_LABEL,
  MIRRORS,
  assetsFileUrl,
  assetsMirrorUrl,
  latestVersionJsonUrl,
  presetContentsUrl,
  presetSnapshotUrl,
  presetVersionUrl,
  releaseApiUrl,
  releasePageUrl,
  releasesApiUrl,
  versionJsonAssetUrl,
} from '../src/lib/download-source.ts';
import {
  describeProbe,
  describeSourceLine,
  manualResolution,
  resetDownloadSourceCache,
  resolveDownloadSource,
} from '../src/lib/download-selection.ts';
import {
  PROBE_ASSET_BYTES,
  PROBE_TIMEOUT_MS,
  pickProbeFile,
  probeAssetChunk,
  probeSource,
} from '../src/lib/download-probe.ts';

const GITEE_VERSION_JSON = 'https://gitee.com/muyangplus/dawn-tick/releases/download/v0.6.5/version.json';
const GITHUB_VERSION_JSON = latestVersionJsonUrl('github');
const GITEE_MIRROR = assetsMirrorUrl('gitee', 'release');
const GITHUB_MIRROR = assetsMirrorUrl('github', 'release');
const PORTABLE = 'DawnTick-0.6.5-release-windows-x64-portable.zip';
const GITEE_PORTABLE = assetsFileUrl('gitee', 'release', PORTABLE);
const GITHUB_PORTABLE = assetsFileUrl('github', 'release', PORTABLE);

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/** mirror.json：只放便携包，探测用它做 256KB 测速。 */
function mirrorJson(channel: 'dev' | 'beta' | 'release', version = '0.6.5'): Record<string, unknown> {
  return {
    schema: 1,
    channel,
    version,
    tag: `v${version}`,
    commit: 'abcdef1',
    releasedAt: 1_760_000_000_000,
    notes: `渠道 ${channel} · 提交 abcdef1`,
    files: {
      windowsSetup: {
        name: `DawnTick-${version}-${channel}-windows-x64-setup.exe`,
        size: 100,
        sha256: 'a'.repeat(64),
      },
      windowsPortable: { name: `DawnTick-${version}-${channel}-windows-x64-portable.zip`, size: 90, sha256: 'b'.repeat(64) },
    },
    checksums: 'SHA256SUMS.txt',
  };
}

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface StubOptions {
  /** 每条请求的耗时（毫秒） */
  delay?: (url: string) => number;
  /** 返回 Response；抛错表示不可达；`'hang'` 表示永不返回 */
  respond: (url: string) => Response | 'throw' | 'hang';
}

/** 记录请求并按地址给不同延迟：用来构造可比较的探测耗时。 */
function stubFetch(options: StubOptions): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = async (input: unknown): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    await sleep(options.delay?.(url) ?? 0);
    const result = options.respond(url);
    if (result === 'throw') throw new Error('offline');
    if (result === 'hang') return new Promise<Response>(() => {});
    return result;
  };
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

/** 两个源都返回 mirror.json + 便携包（供需要「探测成功」的用例复用）。 */
function healthyResponses(url: string): Response | 'throw' {
  if (url === GITEE_MIRROR || url === GITHUB_MIRROR) return response(mirrorJson('release'));
  if (url === GITEE_PORTABLE || url === GITHUB_PORTABLE) return streamResponse(512 * 1024);
  return response({}, false, 404);
}

test('镜像地址表：主仓库 / 预设仓库 / 独立 assets 仓库各就各位', () => {
  assert.equal(MIRRORS.github.repo, 'muyangplus/dawn-tick');
  assert.equal(MIRRORS.gitee.repo, 'muyangplus/dawn-tick');
  assert.equal(MIRRORS.github.presets, 'muyangplus/dawn-tick-presets');
  assert.equal(MIRRORS.gitee.presets, 'muyangplus/dawn-tick-presets');
  assert.equal(MIRRORS.github.assets, ASSETS_REPO, '产物放独立 assets 仓库');
  assert.equal(MIRRORS.gitee.assets, ASSETS_REPO);
  assert.equal(ASSETS_REPO, 'muyangplus/dawn-tick-assets');
  assert.equal(
    releasesApiUrl('github'),
    'https://api.github.com/repos/muyangplus/dawn-tick/releases?per_page=30',
  );
  assert.equal(
    releasesApiUrl('gitee'),
    'https://gitee.com/api/v5/repos/muyangplus/dawn-tick/releases?per_page=30',
  );
  assert.equal(releaseApiUrl('github', 'dev'), 'https://api.github.com/repos/muyangplus/dawn-tick/releases/tags/dev-latest');
  assert.equal(releaseApiUrl('gitee', 'dev'), 'https://gitee.com/api/v5/repos/muyangplus/dawn-tick/releases/tags/dev-latest');
  assert.equal(releaseApiUrl('gitee', 'release'), 'https://gitee.com/api/v5/repos/muyangplus/dawn-tick/releases/latest');
  assert.equal(releaseApiUrl('gitee', 'beta'), releasesApiUrl('gitee'));
  assert.equal(releasePageUrl('gitee'), 'https://gitee.com/muyangplus/dawn-tick/releases');
  assert.equal(GITHUB_VERSION_JSON, 'https://github.com/muyangplus/dawn-tick/releases/latest/download/version.json');

  assert.equal(presetVersionUrl('github'), 'https://raw.githubusercontent.com/muyangplus/dawn-tick-presets/main/version.json');
  assert.equal(presetVersionUrl('gitee'), 'https://gitee.com/muyangplus/dawn-tick-presets/raw/main/version.json');
  assert.equal(
    presetSnapshotUrl('gitee', '0.2.0'),
    'https://gitee.com/muyangplus/dawn-tick-presets/raw/main/snapshot/presets-0.2.0.json',
  );
  assert.equal(
    presetContentsUrl('gitee', 'version.json'),
    'https://gitee.com/api/v5/repos/muyangplus/dawn-tick-presets/contents/version.json',
  );
});

test('assets 地址拼接：渠道分支 + raw 基地址，文件名按 URL 编码', () => {
  assert.equal(
    assetsMirrorUrl('github', 'beta'),
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/beta/mirror.json',
  );
  assert.equal(
    assetsMirrorUrl('gitee', 'release'),
    'https://gitee.com/muyangplus/dawn-tick-assets/raw/release/mirror.json',
  );
  assert.equal(
    assetsFileUrl('gitee', 'dev', 'DawnTick-0.6.6-dev-android.apk'),
    'https://gitee.com/muyangplus/dawn-tick-assets/raw/dev/DawnTick-0.6.6-dev-android.apk',
  );
  assert.equal(
    assetsFileUrl('github', 'release', 'SHA256SUMS.txt'),
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/release/SHA256SUMS.txt',
  );
  assert.throws(() => assetsFileUrl('github', 'release', '  '), /文件名为空/);
  // 三个渠道各一条分支：dev→dev、beta→beta、release→release
  for (const feed of ['dev', 'beta', 'release'] as const) {
    assert.match(assetsMirrorUrl('github', feed), new RegExp(`/dawn-tick-assets/${feed}/mirror\\.json$`));
  }
});

test('从旧发布资产里取 version.json 的下载地址（GitHub 兼容兜底），缺资产返回 null', () => {
  assert.equal(versionJsonAssetUrl({ assets: [{ name: 'version.json', browser_download_url: GITEE_VERSION_JSON }] }), GITEE_VERSION_JSON);
  assert.equal(versionJsonAssetUrl({ assets: [{ name: 'Version.JSON', browser_download_url: 'u' }] }), 'u');
  assert.equal(versionJsonAssetUrl({ assets: [{ name: 'OTHER.txt', browser_download_url: 'u' }] }), null);
  assert.equal(versionJsonAssetUrl({ assets: [] }), null);
  assert.equal(versionJsonAssetUrl(null), null);
  assert.equal(versionJsonAssetUrl({}), null);
});

test('两边都可达时选完成耗时更低的源（Gitee 快、GitHub 快各验一次）', async () => {
  resetDownloadSourceCache();
  const bothReachable = (giteeDelay: number, githubDelay: number): ReturnType<typeof stubFetch> =>
    stubFetch({
      delay: (url) => (url.startsWith('https://gitee.com/') ? giteeDelay : url.startsWith('https://raw.githubusercontent.com/') ? githubDelay : 0),
      respond: healthyResponses,
    });

  // 延迟差拉大，避免并行测试文件时定时器抖动影响「谁更快」的判定
  const giteeFast = bothReachable(10, 150);
  const resolved = await resolveDownloadSource('auto', giteeFast.fetchImpl);
  assert.equal(resolved.source, 'gitee');
  assert.equal(resolved.reason, 'latency');
  assert.equal(resolved.probes.length, 2);
  assert.ok(giteeFast.calls.includes(GITEE_MIRROR), '先读 Gitee 的 mirror.json');
  assert.ok(giteeFast.calls.includes(GITEE_PORTABLE), '再用便携包 256KB 测速');
  const gitee = resolved.probes.find((probe) => probe.source === 'gitee');
  const github = resolved.probes.find((probe) => probe.source === 'github');
  assert.equal(gitee?.ok, true);
  assert.equal(gitee?.degraded, false);
  assert.equal(gitee?.kind, 'asset');

  const githubFast = bothReachable(150, 10);
  const resolvedAgain = await resolveDownloadSource('auto', githubFast.fetchImpl, { fresh: true });
  assert.equal(resolvedAgain.source, 'github');
  assert.equal(resolvedAgain.reason, 'latency');
});

test('Gitee 不可达时选 GitHub；GitHub 不可达时选 Gitee', async () => {
  resetDownloadSourceCache();
  const giteeDown = stubFetch({
    respond: (url) => {
      if (url.startsWith('https://gitee.com/')) return 'throw';
      return healthyResponses(url);
    },
  });
  const withoutGitee = await resolveDownloadSource('auto', giteeDown.fetchImpl);
  assert.equal(withoutGitee.source, 'github');
  assert.equal(withoutGitee.reason, 'fallback');
  assert.equal(withoutGitee.probes.find((probe) => probe.source === 'gitee')?.ok, false);

  resetDownloadSourceCache();
  const githubDown = stubFetch({
    respond: (url) => {
      if (url.startsWith('https://github.com/') || url.startsWith('https://raw.githubusercontent.com/') || url.startsWith('https://api.github.com/')) {
        return 'throw';
      }
      return healthyResponses(url);
    },
  });
  const withoutGithub = await resolveDownloadSource('auto', githubDown.fetchImpl);
  assert.equal(withoutGithub.source, 'gitee');
  assert.equal(withoutGithub.reason, 'fallback');
  assert.equal(withoutGithub.probes.find((probe) => probe.source === 'github')?.ok, false);
});

test('两边都不可达时回退 GitHub', async () => {
  resetDownloadSourceCache();
  const down = stubFetch({ respond: () => 'throw' });
  const resolved = await resolveDownloadSource('auto', down.fetchImpl);
  assert.equal(resolved.source, 'github');
  assert.equal(resolved.reason, 'default-github');
  assert.deepEqual(
    resolved.probes.map((probe) => probe.ok),
    [false, false],
  );
});

test('探测超时按不可达处理，不会一直等', async () => {
  resetDownloadSourceCache();
  const hang = stubFetch({ respond: () => 'hang' });
  const single = await probeSource('github', hang.fetchImpl, { timeoutMs: 20 });
  assert.equal(single.ok, false);
  assert.equal(single.error, '探测超时');
  assert.ok(single.latencyMs >= 20);

  const resolved = await resolveDownloadSource('auto', hang.fetchImpl, { timeoutMs: 20 });
  assert.equal(resolved.source, 'github');
  assert.equal(resolved.reason, 'default-github');
  assert.ok(PROBE_TIMEOUT_MS >= 1000, '默认超时留够慢网络的时间');
});

test('Gitee 镜像未同步：mirror.json 404 后退化成仓库可达并标记 degraded', async () => {
  resetDownloadSourceCache();
  const stub = stubFetch({
    respond: (url) => {
      if (url === GITEE_MIRROR) return response({ message: '404 Not Found' }, false, 404);
      if (url === 'https://gitee.com/muyangplus/dawn-tick/raw/main/package.json') return response({ name: 'dawn-tick' });
      return response({}, false, 404);
    },
  });
  const probe = await probeSource('gitee', stub.fetchImpl);
  assert.equal(probe.ok, true);
  assert.equal(probe.degraded, true);
  assert.equal(probe.kind, 'reachability');
  assert.equal(
    stub.calls.includes('https://gitee.com/muyangplus/dawn-tick/raw/main/package.json'),
    true,
    '回退探测走主仓库 raw package.json',
  );
});

test('Gitee 镜像未同步（降级）时自动选健康的 GitHub', async () => {
  resetDownloadSourceCache();
  // Gitee 镜像 404 但仓库可达（degraded）；GitHub 健康但更慢
  const stub = stubFetch({
    delay: (url) => (url.startsWith('https://gitee.com/') ? 5 : 80),
    respond: (url) => {
      if (url === GITEE_MIRROR) return response({}, false, 404);
      if (url === 'https://gitee.com/muyangplus/dawn-tick/raw/main/package.json') return response({ name: 'dawn-tick' });
      return healthyResponses(url);
    },
  });
  const resolved = await resolveDownloadSource('auto', stub.fetchImpl);
  assert.equal(resolved.source, 'github', '降级源不能提供完整更新，回退健康的 GitHub');
  assert.equal(resolved.probes.find((probe) => probe.source === 'gitee')?.degraded, true);
  assert.equal(resolved.probes.find((probe) => probe.source === 'github')?.degraded, false);
});

test('自动探测结果按会话缓存 10 分钟，fresh 强制刷新', async () => {
  resetDownloadSourceCache();
  let clock = 0;
  const stub = stubFetch({ respond: healthyResponses });
  const first = await resolveDownloadSource('auto', stub.fetchImpl, { now: () => clock });
  assert.equal(first.cached, false);
  const requestsAfterFirst = stub.calls.length;
  assert.ok(requestsAfterFirst > 0);

  clock = 60_000;
  const second = await resolveDownloadSource('auto', stub.fetchImpl, { now: () => clock });
  assert.equal(second.cached, true);
  assert.equal(stub.calls.length, requestsAfterFirst, '10 分钟内不再发请求');

  const fresh = await resolveDownloadSource('auto', stub.fetchImpl, { now: () => clock, fresh: true });
  assert.equal(fresh.cached, false);
  assert.ok(stub.calls.length > requestsAfterFirst, '重新检测会重新探测');

  const afterExpiry = await resolveDownloadSource('auto', stub.fetchImpl, { now: () => clock });
  assert.equal(afterExpiry.cached, true);
  clock = 60_000 + 10 * 60_000;
  const expired = await resolveDownloadSource('auto', stub.fetchImpl, { now: () => clock });
  assert.equal(expired.cached, false, '超过 10 分钟缓存失效');
});

test('手动指定优先于探测：不发明细请求', async () => {
  resetDownloadSourceCache();
  const never = stubFetch({ respond: () => 'throw' });
  const gitee = await resolveDownloadSource('gitee', never.fetchImpl);
  assert.equal(gitee.source, 'gitee');
  assert.equal(gitee.reason, 'manual');
  assert.deepEqual(gitee.probes, []);
  assert.equal(never.calls.length, 0);

  const github = await resolveDownloadSource('github', never.fetchImpl);
  assert.equal(github.source, 'github');
  assert.equal(never.calls.length, 0);
});

test('状态行文案：自动列出两个源的耗时，降级源给出回退说明', () => {
  const probes = [
    { source: 'gitee' as const, ok: true, latencyMs: 120, degraded: false, error: null, url: 'x', kind: 'asset' as const, bytes: PROBE_ASSET_BYTES },
    { source: 'github' as const, ok: true, latencyMs: 480, degraded: false, error: null, url: 'y', kind: 'asset' as const, bytes: PROBE_ASSET_BYTES },
  ];
  assert.equal(
    describeSourceLine({ preference: 'auto', source: 'gitee', reason: 'latency', probes, cached: false }),
    '自动：Gitee（120ms / 256KB） · GitHub（480ms / 256KB）',
  );
  assert.equal(describeProbe(probes[1]!), 'GitHub（480ms / 256KB）');
  assert.equal(
    describeSourceLine({
      preference: 'auto',
      source: 'gitee',
      reason: 'fallback',
      probes: [
        { source: 'gitee', ok: true, latencyMs: 90, degraded: true, error: null, url: 'x' },
        { source: 'github', ok: false, latencyMs: 2500, degraded: false, error: '探测超时', url: 'y' },
      ],
      cached: false,
    }),
    '自动：Gitee（90ms，镜像未同步） · GitHub（不可用）；该源镜像未同步，下载时自动回退另一个源',
  );
  assert.equal(
    describeSourceLine(manualResolution('github', [])),
    '手动：GitHub',
  );
  assert.equal(
    describeSourceLine(manualResolution('gitee', [probes[0]!])),
    '手动：Gitee（探测：Gitee（120ms / 256KB））',
  );
  assert.equal(describeSourceLine(null), '正在探测下载源…');
  assert.equal(DOWNLOAD_SOURCE_LABEL.gitee, 'Gitee');
});

// —— 256KB 资产分块探测（mirror.json 太小，改用真实便携包） ——

function streamResponse(totalBytes: number, chunkBytes = 32 * 1024): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

test('pickProbeFile：优先便携 zip，其次 apk / web / 安装程序', () => {
  const files = {
    windowsSetup: { name: 'setup.exe', size: 1, sha256: 'a'.repeat(64) },
    android: { name: 'app.apk', size: 1, sha256: 'b'.repeat(64) },
    windowsPortable: { name: 'portable.zip', size: 1, sha256: 'c'.repeat(64) },
    web: { name: 'web.zip', size: 1, sha256: 'd'.repeat(64) },
  };
  assert.equal(pickProbeFile(files)?.name, 'portable.zip');
  assert.equal(pickProbeFile({ android: files.android })?.name, 'app.apk');
  assert.equal(pickProbeFile({ web: files.web })?.name, 'web.zip');
  assert.equal(pickProbeFile({ windowsSetup: files.windowsSetup })?.name, 'setup.exe');
  assert.equal(pickProbeFile({}), null);
});

test('probeAssetChunk：读满 256KB 即停止并计时', async () => {
  const clock = { value: 0 };
  const result = await probeAssetChunk('https://example.com/portable.zip', (async () => {
    clock.value += 120;
    return streamResponse(1024 * 1024);
  }) as unknown as typeof fetch, {
    now: () => clock.value,
    maxBytes: 256 * 1024,
    timeoutMs: 2000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.bytes, 256 * 1024);
  assert.ok(result.latencyMs >= 120);
});

test('probeAssetChunk：请求超时给出可读原因', async () => {
  const fetchImpl = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const result = await probeAssetChunk('https://example.com/slow.zip', fetchImpl, { timeoutMs: 20 });
  assert.equal(result.ok, false);
  assert.equal(result.error, '探测超时');
});

test('probeSource：读 mirror.json 后用便携包 256KB 分块探测并标记 asset', async () => {
  resetDownloadSourceCache();
  const stub = stubFetch({ respond: healthyResponses });
  const probe = await probeSource('gitee', stub.fetchImpl, { timeoutMs: 2000 });
  assert.equal(probe.ok, true);
  assert.equal(probe.degraded, false);
  assert.equal(probe.kind, 'asset');
  assert.equal(probe.bytes, 256 * 1024);
  assert.deepEqual(stub.calls.slice(0, 2), [GITEE_MIRROR, GITEE_PORTABLE], '先清单、再真实资产');
});
