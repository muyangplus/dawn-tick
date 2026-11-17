import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPDATE_API_FEEDS,
  UPDATE_FEEDS,
  UPDATE_RELEASES_API,
  checkForUpdate,
  compareVersions,
  defaultReceiveBeta,
  pickBetaCandidate,
  releaseChannelOf,
  resolveFeed,
  resolveReceiveBeta,
} from '../src/update.ts';
import { assetsVersionUrl } from '../src/lib/download-source.ts';
import { setAndroidAbiForTests } from '../src/lib/android-abi.ts';
import { CHANNEL_LABEL } from '../src/channel.ts';

const VERSION_RELEASE = assetsVersionUrl('github', 'release');
const VERSION_BETA = assetsVersionUrl('github', 'beta');
const VERSION_DEV = assetsVersionUrl('github', 'dev');
const GITEE_VERSION_RELEASE = assetsVersionUrl('gitee', 'release');

function manifestResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function fileSuffix(suffix: string, version: string, channel: string, size: number, sha: string): Record<string, unknown> {
  return { name: `DawnTick-${version}-${channel}${suffix}`, size, sha256: sha };
}

/** version.json v2：与发布脚本 `tools/release/version-json.mjs` 的产物一致。 */
function versionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const version = typeof overrides['version'] === 'string' ? overrides['version'] : '0.2.0';
  const channel = typeof overrides['channel'] === 'string' ? overrides['channel'] : 'release';
  return {
    schema: 2,
    channel,
    version,
    tag: `v${version}`,
    commit: '4f2a1cd',
    releasedAt: 1_760_000_000_000,
    notes: '渠道 release · 来源 main · 提交 4f2a1cd',
    files: {
      windowsSetup: fileSuffix('-windows-x64-setup.exe', version, channel, 120, 'a'.repeat(64)),
      windowsPortable: fileSuffix('-windows-x64-portable.zip', version, channel, 90, 'b'.repeat(64)),
      android: fileSuffix('-android-arm64-v8a.apk', version, channel, 60, 'c'.repeat(64)),
      android32: fileSuffix('-android-armeabi-v7a.apk', version, channel, 55, 'e'.repeat(64)),
      web: fileSuffix('-web.zip', version, channel, 30, 'd'.repeat(64)),
    },
    checksums: 'SHA256SUMS.txt',
    ...overrides,
  };
}

/** 旧 GitHub Release 响应：仅作为 assets version.json 不可达时的兼容兜底。 */
function releaseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v0.2.0',
    name: 'DawnTick 0.2.0',
    body: '渠道 release · 来源 main · 提交 4f2a1cd',
    published_at: '2026-05-02T00:00:00Z',
    prerelease: false,
    draft: false,
    assets: [
      {
        name: 'DawnTick-0.2.0-release-windows-x64-setup.exe',
        size: 120,
        browser_download_url: 'https://example.com/setup.exe',
      },
      {
        name: 'DawnTick-0.2.0-release-android.apk',
        size: 60,
        browser_download_url: 'https://example.com/app.apk',
      },
      {
        name: 'DawnTick-0.2.0-release-web.zip',
        size: 30,
        browser_download_url: 'https://example.com/web.zip',
      },
    ],
    ...overrides,
  };
}

function isGitHubApi(input: unknown): boolean {
  return String(input).startsWith('https://api.github.com/');
}

test('版本比较遵循语义化规则', () => {
  assert.ok(compareVersions('0.2.0', '0.1.9') > 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.ok(compareVersions('1.0.0', '1.0.0-beta.1') > 0, '正式版高于同号预发布版');
  assert.ok(compareVersions('1.0.0-beta.2', '1.0.0-beta.1') > 0);
  assert.ok(compareVersions('1.0.0-beta.10', '1.0.0-beta.9') > 0, '预发布序号按数值比较');
  assert.ok(compareVersions('v0.1.1', '0.1.0') > 0, '允许 v 前缀');
});

test('版本顺序：0.1.1-beta.2 > 0.1.1-beta.1 > 0.1.0 > 0.1.0-beta.N', () => {
  const chain = ['0.1.1-beta.2', '0.1.1-beta.1', '0.1.0', '0.1.0-beta.9', '0.1.0-beta.1'];
  for (let index = 0; index < chain.length - 1; index += 1) {
    const higher = chain[index] ?? '';
    const lower = chain[index + 1] ?? '';
    assert.ok(compareVersions(higher, lower) > 0, `${higher} 应高于 ${lower}`);
    assert.ok(compareVersions(lower, higher) < 0, `${lower} 应低于 ${higher}`);
  }
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0, '同版本相等');
});

test('dev 构建时间戳不参与版本比较', () => {
  assert.equal(compareVersions('0.1.0.202610132203', '0.1.0'), 0, '同一基础版本视为相同');
  assert.equal(compareVersions('0.1.0', '0.1.0.202610132203'), 0);
  assert.ok(compareVersions('0.2.0', '0.1.0.202610132203') > 0, '更高基础版本仍是更新');
  assert.ok(compareVersions('0.1.0.202610132203', '0.1.9') < 0);
});

test('dev 渠道永远只查 dev 源', () => {
  assert.equal(resolveFeed('dev', true), 'dev');
  assert.equal(resolveFeed('dev', false), 'dev');
  assert.equal(defaultReceiveBeta('dev'), false);
});

test('release 与 beta 按开关决定源，beta 默认开', () => {
  assert.equal(resolveFeed('release', false), 'release');
  assert.equal(resolveFeed('release', true), 'beta');
  assert.equal(resolveFeed('beta', true), 'beta');
  assert.equal(resolveFeed('beta', false), 'release');
  assert.equal(defaultReceiveBeta('beta'), true);
  assert.equal(defaultReceiveBeta('release'), false);
  assert.equal(resolveReceiveBeta(null, 'beta'), true);
  assert.equal(resolveReceiveBeta(null, 'release'), false);
  assert.equal(resolveReceiveBeta(false, 'beta'), false, '显式关闭优先于默认值');
});

// —— assets version.json v2 取源（首选） ——

test('缺省下载源仍是 GitHub：请求 release 分支的 version.json 并标明来源', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      seen.push(String(input));
      return manifestResponse(versionBody());
    },
  });
  assert.deepEqual(seen, [VERSION_RELEASE]);
  assert.equal(status.source, 'github');
  assert.equal(status.fallbackFrom, undefined);
  assert.equal(status.error, null);
});

test('发现新版本：版本 / 渠道 / 说明 / 时间来自清单，下载地址是同源 raw 绝对 URL', async () => {
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () => manifestResponse(versionBody()),
  });
  assert.equal(status.available, true);
  assert.equal(status.latest, '0.2.0');
  assert.equal(status.manifest?.channel, 'release');
  assert.equal(status.manifest?.commit, '4f2a1cd');
  assert.equal(status.manifest?.releasedAt, 1_760_000_000_000);
  assert.match(String(status.manifest?.notes), /渠道 release/);
  assert.equal(
    status.manifest?.assets?.windows?.url,
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/release/DawnTick-0.2.0-release-windows-x64-setup.exe',
    'windows 默认给安装包',
  );
  assert.equal(
    status.manifest?.assets?.windowsPortable?.url,
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/release/DawnTick-0.2.0-release-windows-x64-portable.zip',
  );
  assert.equal(
    status.manifest?.assets?.android?.url,
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/release/DawnTick-0.2.0-release-android-arm64-v8a.apk',
  );
  assert.equal(
    status.manifest?.assets?.web?.url,
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/release/DawnTick-0.2.0-release-web.zip',
  );
  assert.equal(
    status.manifest?.checksumsUrl,
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/release/SHA256SUMS.txt',
    '校验文件与产物同源同分支',
  );
  assert.equal(status.manifest?.assets?.windows?.sha256, 'a'.repeat(64), '清单直接带摘要');
});

test('armeabi-v7a 设备检查更新时选 v7 包', async () => {
  try {
    setAndroidAbiForTests('armeabi-v7a');
    const status = await checkForUpdate({
      channel: 'release',
      receiveBeta: false,
      currentVersion: '0.1.0',
      fetchImpl: async () => manifestResponse(versionBody()),
    });
    assert.match(String(status.manifest?.assets?.android?.url), /-android-armeabi-v7a\.apk$/);
    assert.equal(status.manifest?.assets?.android?.size, 55);
  } finally {
    setAndroidAbiForTests(null);
  }
});

test('只有便携包时 windows 退回便携 zip，windowsPortable 仍单独保留', async () => {
  const files = {
    windowsPortable: fileSuffix('-windows-x64-portable.zip', '0.2.0', 'release', 90, 'b'.repeat(64)),
  };
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () => manifestResponse(versionBody({ files })),
  });
  assert.match(String(status.manifest?.assets?.windows?.url), /-windows-x64-portable\.zip$/);
  assert.equal(status.manifest?.assets?.windowsPortable?.url, status.manifest?.assets?.windows?.url);
});

test('同版本或更旧版本不算更新', async () => {
  const same = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.2.0',
    fetchImpl: async () => manifestResponse(versionBody({ version: '0.2.0' })),
  });
  assert.equal(same.available, false);

  const older = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.3.0',
    fetchImpl: async () => manifestResponse(versionBody({ version: '0.2.0' })),
  });
  assert.equal(older.available, false, '不允许降级');
});

test('判定：只有远端版本严格大于当前版本才提示', async () => {
  const cases: Array<[current: string, latest: string, expected: boolean]> = [
    ['0.2.0', '0.2.0', false],
    ['0.3.0', '0.2.0', false],
    ['0.1.9', '0.2.0', true],
    ['0.2.0-beta.1', '0.2.0', true],
    ['0.2.0', '0.2.0-beta.1', false],
  ];
  for (const [current, latest, expected] of cases) {
    const status = await checkForUpdate({
      channel: 'release',
      receiveBeta: false,
      currentVersion: current,
      fetchImpl: async () => manifestResponse(versionBody({ version: latest })),
    });
    assert.equal(status.available, expected, `当前 ${current}、远端 ${latest} 应${expected ? '' : '不'}提示`);
  }
});

test('提示渠道取清单里的渠道：beta 分支显示测试版', async () => {
  const beta = await checkForUpdate({
    channel: 'beta',
    receiveBeta: true,
    currentVersion: '0.1.0-beta.1',
    fetchImpl: async (input) => {
      assert.equal(String(input), VERSION_BETA, '接收测试版时读 beta 分支');
      return manifestResponse(versionBody({ channel: 'beta', version: '0.2.0-beta.1' }));
    },
  });
  assert.equal(beta.feed, 'beta');
  assert.equal(beta.manifest?.channel, 'beta');
  assert.equal(releaseChannelOf(beta), 'beta');
  assert.equal(CHANNEL_LABEL[releaseChannelOf(beta)], '测试版');

  // 没勾「接收测试版」时只读 release 分支
  const stable = await checkForUpdate({
    channel: 'beta',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      assert.equal(String(input), VERSION_RELEASE);
      return manifestResponse(versionBody());
    },
  });
  assert.equal(stable.manifest?.channel, 'release');
  assert.equal(releaseChannelOf(stable), 'release');
  assert.equal(releaseChannelOf({ feed: 'dev', manifest: null }), 'dev');
});

test('清单渠道与查询渠道不一致时忽略，不跨渠道兜底', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      seen.push(String(input));
      return manifestResponse(versionBody({ channel: 'dev' }));
    },
  });
  assert.equal(status.available, false);
  assert.equal(status.latest, null);
  assert.match(String(status.error), /渠道/);
  assert.deepEqual(seen, [VERSION_RELEASE], '渠道不一致是配置问题，不再回退旧 Releases');
});

test('dev 渠道读 dev 分支：滚动标签没有语义化版本，版本从清单拿', async () => {
  const status = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      assert.equal(String(input), VERSION_DEV);
      return manifestResponse(
        versionBody({
          channel: 'dev',
          version: '0.1.1',
          tag: 'dev-latest',
          commit: 'b7e140a',
          notes: '渠道 dev · 来源 dev · 提交 b7e140a',
        }),
      );
    },
  });
  assert.equal(status.feed, 'dev');
  assert.equal(status.latest, '0.1.1');
  assert.equal(status.manifest?.channel, 'dev');
  assert.equal(status.manifest?.commit, 'b7e140a');
});

// —— 网络异常 / 旧 Releases 兼容兜底（仅 GitHub） ——

test('网络与格式异常都有可读原因', async () => {
  const failure = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(failure.available, false);
  assert.match(String(failure.error), /offline/);

  const badShape = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () => manifestResponse({ version: 123 }),
  });
  assert.match(String(badShape.error), /格式/);

  const httpError = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () => manifestResponse({}, false, 404),
  });
  // 404 走 API 口径（旧文案「更新源返回 404」只用于其他非 2xx 状态）
  assert.equal(httpError.error, '该渠道还没有发布记录');
});

test('GitHub 的 version.json 不可达时退回旧 Releases 接口（兼容兜底）', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      const url = String(input);
      seen.push(url);
      if (url === VERSION_RELEASE) throw new Error('fetch failed');
      return manifestResponse(releaseBody());
    },
  });
  assert.deepEqual(seen, [VERSION_RELEASE, UPDATE_API_FEEDS.release], '先 version.json，网络异常再回退发布接口');
  assert.equal(status.error, null);
  assert.equal(status.latest, '0.2.0');
  assert.equal(status.manifest?.assets?.windows?.url, 'https://example.com/setup.exe');
  assert.equal(status.manifest?.commit, '4f2a1cd');
});

test('旧 Releases 兜底也按设备 ABI 选拆分包', async () => {
  const splitAssets = [
    {
      name: 'DawnTick-0.2.0-release-android-arm64-v8a.apk',
      size: 60,
      browser_download_url: 'https://example.com/android-arm64.apk',
    },
    {
      name: 'DawnTick-0.2.0-release-android-armeabi-v7a.apk',
      size: 55,
      browser_download_url: 'https://example.com/android-v7.apk',
    },
  ];
  const read = async (): Promise<string | undefined> => {
    const status = await checkForUpdate({
      channel: 'release',
      receiveBeta: false,
      currentVersion: '0.1.0',
      fetchImpl: async (input) => {
        if (String(input) === VERSION_RELEASE) throw new Error('fetch failed');
        return manifestResponse(releaseBody({ assets: splitAssets }));
      },
    });
    return status.manifest?.assets?.android?.url;
  };
  try {
    setAndroidAbiForTests('armeabi-v7a');
    assert.equal(await read(), 'https://example.com/android-v7.apk');
    setAndroidAbiForTests('arm64-v8a');
    assert.equal(await read(), 'https://example.com/android-arm64.apk');
  } finally {
    setAndroidAbiForTests(null);
  }
});

test('旧 Releases 接口也异常时再回退同源 version.json 直连', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      const url = String(input);
      seen.push(url);
      if (url === VERSION_DEV) throw new Error('fetch failed');
      if (isGitHubApi(url)) throw new Error('fetch failed');
      return manifestResponse({ channel: 'dev', version: '0.2.0', notes: '回退清单' });
    },
  });
  assert.deepEqual(seen, [VERSION_DEV, UPDATE_API_FEEDS.dev, UPDATE_FEEDS.dev], '清单 → 发布接口 → 直连清单');
  assert.equal(status.error, null);
  assert.equal(status.latest, '0.2.0');
  assert.equal(status.manifest?.notes, '回退清单');
});

test('release 网络异常时回退发布内的 version.json，额外字段不影响解析', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      const url = String(input);
      seen.push(url);
      if (url === VERSION_RELEASE) throw new Error('fetch failed');
      if (isGitHubApi(url)) throw new Error('fetch failed');
      return manifestResponse({
        channel: 'release',
        version: '0.2.0',
        tag: 'v0.2.0',
        notes: '回退清单',
        artifacts: ['DawnTick-0.2.0-release-web.zip'],
      });
    },
  });
  assert.deepEqual(seen, [VERSION_RELEASE, UPDATE_API_FEEDS.release, UPDATE_FEEDS.release]);
  assert.equal(status.latest, '0.2.0');
  assert.equal(status.manifest?.channel, 'release');
});

test('beta 的 version.json 网络异常：只回退旧 beta 发布列表，不碰滚动标签', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'beta',
    receiveBeta: true,
    currentVersion: '0.1.0-beta.1',
    fetchImpl: async (input) => {
      const url = String(input);
      seen.push(url);
      if (url === VERSION_BETA) throw new Error('fetch failed');
      if (url === UPDATE_RELEASES_API) {
        return manifestResponse([
          releaseBody({ tag_name: 'v0.2.0-beta.1', prerelease: true }),
          releaseBody({ tag_name: 'v0.3.0', prerelease: false }),
        ]);
      }
      throw new Error('unexpected');
    },
  });
  // beta 渠道会顺带查 release 分支，用来判断是否有更高的正式版；release 缺失不影响 beta 结果
  assert.deepEqual(seen, [
    VERSION_BETA,
    UPDATE_RELEASES_API,
    VERSION_RELEASE,
    UPDATE_API_FEEDS.release,
    UPDATE_FEEDS.release,
  ]);
  assert.equal(status.latest, '0.3.0', '旧兜底仍保留 beta 列表「取较高者」的语义');
  assert.equal(status.manifest?.channel, 'release');
});

test('Gitee 只读 assets 仓库的 version.json：不回退 Gitee Releases', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    source: 'gitee',
    fetchImpl: async (input) => {
      const url = String(input);
      seen.push(url);
      if (url === GITEE_VERSION_RELEASE) return manifestResponse({ message: '404 Not Found' }, false, 404);
      return manifestResponse({}, false, 404);
    },
  });
  assert.deepEqual(seen, [GITEE_VERSION_RELEASE]);
  assert.equal(status.source, 'gitee');
  assert.equal(status.available, false);
  assert.equal(status.error, '该渠道还没有发布记录');
});

test('选中 Gitee 时清单与下载地址都来自 Gitee 的 assets raw', async () => {
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    source: 'gitee',
    fetchImpl: async (input, init) => {
      assert.equal(String(input), GITEE_VERSION_RELEASE);
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.['accept'],
        'application/json',
        'version.json 用普通 JSON accept',
      );
      return manifestResponse(versionBody());
    },
  });
  assert.equal(status.error, null);
  assert.equal(status.source, 'gitee');
  assert.equal(status.available, true);
  assert.equal(status.latest, '0.2.0');
  assert.equal(
    status.manifest?.assets?.windows?.url,
    'https://gitee.com/muyangplus/dawn-tick-assets/raw/release/DawnTick-0.2.0-release-windows-x64-setup.exe',
    '下载地址走 Gitee 的 assets raw',
  );
  assert.equal(
    status.manifest?.checksumsUrl,
    'https://gitee.com/muyangplus/dawn-tick-assets/raw/release/SHA256SUMS.txt',
  );
});

test('首选源失败时自动回退另一个源，并在结果里标明实际源', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    source: 'gitee',
    fallback: true,
    fetchImpl: async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.startsWith('https://gitee.com/')) return manifestResponse({ message: '404 Not Found' }, false, 404);
      return manifestResponse(versionBody());
    },
  });
  assert.deepEqual(seen, [GITEE_VERSION_RELEASE, VERSION_RELEASE], 'Gitee 失败后回退 GitHub 的 version.json');
  assert.equal(status.error, null);
  assert.equal(status.source, 'github', '回退后标明实际源');
  assert.equal(status.fallbackFrom, 'gitee');
  assert.equal(status.available, true);
  assert.match(String(status.manifest?.assets?.windows?.url), /^https:\/\/raw\.githubusercontent\.com\/muyangplus\/dawn-tick-assets\/release\//);
});

test('反向回退：GitHub 失败时选 Gitee', async () => {
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    source: 'github',
    fallback: true,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.startsWith('https://gitee.com/')) return manifestResponse(versionBody());
      return manifestResponse({}, false, 503);
    },
  });
  assert.equal(status.source, 'gitee');
  assert.equal(status.fallbackFrom, 'github');
  assert.equal(status.available, true);
});

test('两个源都失败时把两侧原因都交出去', async () => {
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    source: 'gitee',
    fallback: true,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.startsWith('https://gitee.com/')) return manifestResponse({ message: '404 Not Found' }, false, 404);
      return manifestResponse({}, false, 500);
    },
  });
  assert.equal(status.available, false);
  assert.equal(status.source, 'gitee', '都失败时保持首选源');
  assert.equal(status.fallbackFrom, undefined);
  assert.match(String(status.error), /Gitee：该渠道还没有发布记录/);
  assert.match(String(status.error), /GitHub：更新源返回 500/);
});

test('旧渠道常量保留给 GitHub 兼容兜底：dev 滚动标签 / release latest / beta 列表', () => {
  assert.match(UPDATE_FEEDS.dev ?? '', /dev-latest/);
  assert.equal(UPDATE_FEEDS.beta, undefined, 'beta 标签带版本号，没有固定直连源');
  assert.match(UPDATE_FEEDS.release ?? '', /releases\/latest\/download/);
  assert.equal(
    Object.values(UPDATE_FEEDS).filter((url) => url !== undefined).length,
    2,
    '只有 dev 与 release 有直连兜底',
  );

  assert.equal(
    UPDATE_API_FEEDS.dev,
    'https://api.github.com/repos/muyangplus/dawn-tick/releases/tags/dev-latest',
  );
  assert.equal(UPDATE_API_FEEDS.beta, UPDATE_RELEASES_API, 'beta 兜底取发布列表');
  assert.equal(UPDATE_API_FEEDS.release, 'https://api.github.com/repos/muyangplus/dawn-tick/releases/latest');
  assert.equal(new Set(Object.values(UPDATE_API_FEEDS)).size, 3);
});

test('beta 候选认 beta 预发布与纯版本号预发布：草稿 / rc / 滚动标签都跳过', () => {
  assert.equal(pickBetaCandidate([]), null);
  assert.equal(pickBetaCandidate([{ tag_name: 'dev-latest', prerelease: true }]), null);
  assert.equal(
    pickBetaCandidate([releaseBody({ tag_name: 'v0.3.0-rc.1', prerelease: true })]),
    null,
    '非 beta 的预发布不算候选',
  );
  assert.equal(pickBetaCandidate([releaseBody({ tag_name: 'v0.3.0', draft: true })]), null, '草稿不算候选');
  const plainBeta = pickBetaCandidate([releaseBody({ tag_name: 'v0.3.0', prerelease: true })]);
  assert.equal(plainBeta?.channel, 'beta', '不带序号的预发布版本号也算测试版候选');
  assert.equal(plainBeta?.record['tag_name'], 'v0.3.0');

  const picked = pickBetaCandidate([
    releaseBody({ tag_name: 'v0.1.0-beta.2', prerelease: true }),
    releaseBody({ tag_name: 'v0.1.0', prerelease: false }),
    releaseBody({ tag_name: 'v0.0.9-beta.9', prerelease: true }),
  ]);
  assert.equal(picked?.channel, 'release', '同号正式版高于预发布');
  assert.equal(picked?.record['tag_name'], 'v0.1.0');
});

test('beta 渠道：正式版更高时提示正式版更新', async () => {
  const fetchImpl = (async (input: unknown): Promise<Response> => {
    const url = String(input);
    if (url === VERSION_BETA) return manifestResponse(versionBody({ channel: 'beta', version: '0.6.8-beta.1' }));
    if (url === VERSION_RELEASE) return manifestResponse(versionBody({ channel: 'release', version: '0.6.9' }));
    return manifestResponse({}, false, 404);
  }) as unknown as typeof fetch;
  const status = await checkForUpdate({
    channel: 'beta',
    receiveBeta: true,
    currentVersion: '0.6.8-beta.1',
    fetchImpl,
    source: 'github',
  });
  assert.equal(status.available, true);
  assert.equal(status.latest, '0.6.9');
  assert.equal(releaseChannelOf(status), 'release');
});

test('beta 渠道：测试版更高时仍提示测试版', async () => {
  const fetchImpl = (async (input: unknown): Promise<Response> => {
    const url = String(input);
    if (url === VERSION_BETA) return manifestResponse(versionBody({ channel: 'beta', version: '0.6.9-beta.2' }));
    if (url === VERSION_RELEASE) return manifestResponse(versionBody({ channel: 'release', version: '0.6.8' }));
    return manifestResponse({}, false, 404);
  }) as unknown as typeof fetch;
  const status = await checkForUpdate({
    channel: 'beta',
    receiveBeta: true,
    currentVersion: '0.6.8',
    fetchImpl,
    source: 'github',
  });
  assert.equal(status.available, true);
  assert.equal(status.latest, '0.6.9-beta.2');
  assert.equal(releaseChannelOf(status), 'beta');
});

test('beta 渠道：release 分支缺失时仍按测试版检查', async () => {
  const fetchImpl = (async (input: unknown): Promise<Response> => {
    const url = String(input);
    if (url === VERSION_BETA) return manifestResponse(versionBody({ channel: 'beta', version: '0.6.9-beta.1' }));
    return manifestResponse({}, false, 404);
  }) as unknown as typeof fetch;
  const status = await checkForUpdate({
    channel: 'beta',
    receiveBeta: true,
    currentVersion: '0.6.8',
    fetchImpl,
    source: 'github',
  });
  assert.equal(status.available, true);
  assert.equal(status.latest, '0.6.9-beta.1');
  assert.equal(releaseChannelOf(status), 'beta');
});
