import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOWNLOAD_SOURCE_LABEL,
  MIRRORS,
  PROBE_TIMEOUT_MS,
  describeProbe,
  describeSourceLine,
  latestVersionJsonUrl,
  manualResolution,
  presetContentsUrl,
  presetSnapshotUrl,
  presetVersionUrl,
  probeSource,
  releaseApiUrl,
  releasePageUrl,
  releasesApiUrl,
  resetDownloadSourceCache,
  resolveDownloadSource,
  versionJsonAssetUrl,
} from '../src/lib/download-source.ts';

const GITEE_VERSION_JSON = 'https://gitee.com/muyangplus/dawn-tick/releases/download/v0.6.5/version.json';
const GITHUB_VERSION_JSON = latestVersionJsonUrl('github');
const GITEE_API_LATEST = releaseApiUrl('gitee', 'release');

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function releaseWithVersionJson(url = GITEE_VERSION_JSON): Record<string, unknown> {
  return {
    tag_name: 'v0.6.5',
    assets: [{ name: 'version.json', browser_download_url: url }],
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

test('镜像地址表：GitHub 与 Gitee 的仓库 / raw / API / 发布页各就各位', () => {
  assert.equal(MIRRORS.github.repo, 'muyangplus/dawn-tick');
  assert.equal(MIRRORS.gitee.repo, 'muyangplus/dawn-tick');
  assert.equal(MIRRORS.github.presets, 'muyangplus/dawn-tick-presets');
  assert.equal(MIRRORS.gitee.presets, 'muyangplus/dawn-tick-presets');
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
  assert.equal(releaseApiUrl('gitee', 'release'), GITEE_API_LATEST);
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

test('从发布资产里取 version.json 的下载地址，缺资产返回 null', () => {
  assert.equal(versionJsonAssetUrl(releaseWithVersionJson()), GITEE_VERSION_JSON);
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
      delay: (url) => (url.startsWith('https://gitee.com/') ? giteeDelay : url === GITHUB_VERSION_JSON ? githubDelay : 0),
      respond: (url) => {
        if (url === GITEE_API_LATEST) return response(releaseWithVersionJson());
        if (url === GITEE_VERSION_JSON || url === GITHUB_VERSION_JSON) return response({ version: '0.6.5' });
        return response({}, false, 404);
      },
    });

  const giteeFast = bothReachable(2, 40);
  const resolved = await resolveDownloadSource('auto', giteeFast.fetchImpl);
  assert.equal(resolved.source, 'gitee');
  assert.equal(resolved.reason, 'latency');
  assert.equal(resolved.probes.length, 2);
  const gitee = resolved.probes.find((probe) => probe.source === 'gitee');
  const github = resolved.probes.find((probe) => probe.source === 'github');
  assert.equal(gitee?.ok, true);
  assert.equal(gitee?.degraded, false);
  assert.ok((gitee?.latencyMs ?? Infinity) < (github?.latencyMs ?? 0));

  const githubFast = bothReachable(40, 2);
  const resolvedAgain = await resolveDownloadSource('auto', githubFast.fetchImpl, { fresh: true });
  assert.equal(resolvedAgain.source, 'github');
  assert.equal(resolvedAgain.reason, 'latency');
});

test('Gitee 不可达时选 GitHub；GitHub 不可达时选 Gitee', async () => {
  resetDownloadSourceCache();
  const giteeDown = stubFetch({
    respond: (url) => {
      if (url.startsWith('https://gitee.com/')) return 'throw';
      if (url === GITHUB_VERSION_JSON) return response({ version: '0.6.5' });
      return response({}, false, 404);
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
      if (url === GITEE_API_LATEST) return response(releaseWithVersionJson());
      if (url === GITEE_VERSION_JSON) return response({ version: '0.6.5' });
      return response({}, false, 404);
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

test('Gitee 暂无 Releases：退化成仓库可达探测并标记 degraded', async () => {
  resetDownloadSourceCache();
  const stub = stubFetch({
    respond: (url) => {
      if (url === GITEE_API_LATEST) return response({ message: '404 Not Found' }, false, 404);
      if (url === 'https://gitee.com/muyangplus/dawn-tick/raw/main/package.json') return response({ name: 'dawn-tick' });
      return response({}, false, 404);
    },
  });
  const probe = await probeSource('gitee', stub.fetchImpl);
  assert.equal(probe.ok, true);
  assert.equal(probe.degraded, true);
  assert.equal(
    stub.calls.includes('https://gitee.com/muyangplus/dawn-tick/raw/main/package.json'),
    true,
    '回退探测走 raw package.json',
  );
});

test('自动探测结果按会话缓存 10 分钟，fresh 强制刷新', async () => {
  resetDownloadSourceCache();
  let clock = 0;
  const stub = stubFetch({
    respond: (url) => {
      if (url === GITEE_API_LATEST) return response(releaseWithVersionJson());
      if (url === GITEE_VERSION_JSON || url === GITHUB_VERSION_JSON) return response({ version: '0.6.5' });
      return response({}, false, 404);
    },
  });
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
    { source: 'gitee' as const, ok: true, latencyMs: 120, degraded: false, error: null, url: 'x' },
    { source: 'github' as const, ok: true, latencyMs: 480, degraded: false, error: null, url: 'y' },
  ];
  assert.equal(
    describeSourceLine({ preference: 'auto', source: 'gitee', reason: 'latency', probes, cached: false }),
    '自动：Gitee（120ms） · GitHub（480ms）',
  );
  assert.equal(describeProbe(probes[1]!), 'GitHub（480ms）');
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
    '自动：Gitee（90ms，暂无 Releases） · GitHub（不可用）；该源暂无 Releases，下载时自动回退另一个源',
  );
  assert.equal(
    describeSourceLine(manualResolution('github', [])),
    '手动：GitHub',
  );
  assert.equal(
    describeSourceLine(manualResolution('gitee', [probes[0]!])),
    '手动：Gitee（探测：Gitee（120ms））',
  );
  assert.equal(describeSourceLine(null), '正在探测下载源…');
  assert.equal(DOWNLOAD_SOURCE_LABEL.gitee, 'Gitee');
});
