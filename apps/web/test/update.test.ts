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
import { CHANNEL_LABEL } from '../src/channel.ts';

function manifestResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** GitHub 发布接口的响应体：资产名与发布流程一致（`DawnTick-<版本>-<渠道>-…`）。 */
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

test('发现新版本时返回清单与下载信息', async () => {
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () => manifestResponse(releaseBody()),
  });
  assert.equal(status.feed, 'release');
  assert.equal(status.available, true);
  assert.equal(status.latest, '0.2.0');
  assert.equal(status.manifest?.assets?.windows?.url, 'https://example.com/setup.exe');
  assert.equal(status.manifest?.assets?.android?.url, 'https://example.com/app.apk');
  assert.equal(status.manifest?.assets?.web?.url, 'https://example.com/web.zip');
  assert.equal(status.manifest?.channel, 'release');
  assert.equal(status.error, null);
});

test('同版本或更旧版本不算更新', async () => {
  const same = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.2.0',
    fetchImpl: async () => manifestResponse(releaseBody({ assets: [] })),
  });
  assert.equal(same.available, false);

  const older = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.3.0',
    fetchImpl: async () => manifestResponse(releaseBody({ assets: [] })),
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
      fetchImpl: async () => manifestResponse(releaseBody({ tag_name: `v${latest}`, assets: [] })),
    });
    assert.equal(status.available, expected, `当前 ${current}、远端 ${latest} 应${expected ? '' : '不'}提示`);
  }
});

test('提示渠道取发布本身的渠道，不取接收测试版开关', async () => {
  // 正式版用户打开「接收测试版」后，查到更高的正式版：仍然显示正式版
  const stable = await checkForUpdate({
    channel: 'release',
    receiveBeta: true,
    currentVersion: '0.1.0',
    fetchImpl: async () =>
      manifestResponse([releaseBody({ tag_name: 'v0.2.0', prerelease: false, assets: [] })]),
  });
  assert.equal(stable.feed, 'beta', '查询源是发布列表');
  assert.equal(stable.manifest?.channel, 'release', '发布本身是正式版');
  assert.equal(releaseChannelOf(stable), 'release');
  assert.equal(CHANNEL_LABEL[releaseChannelOf(stable)], '正式版');

  // 测试版用户查到 beta 预发布：显示测试版
  const beta = await checkForUpdate({
    channel: 'beta',
    receiveBeta: true,
    currentVersion: '0.1.0-beta.1',
    fetchImpl: async () =>
      manifestResponse([
        releaseBody({ tag_name: 'v0.2.0-beta.1', prerelease: true, assets: [] }),
      ]),
  });
  assert.equal(beta.manifest?.channel, 'beta');
  assert.equal(releaseChannelOf(beta), 'beta');
  assert.equal(CHANNEL_LABEL[releaseChannelOf(beta)], '测试版');

  // 没有清单时退回本次查询的源
  assert.equal(releaseChannelOf({ feed: 'dev', manifest: null }), 'dev');
});

test('渠道不一致的清单被忽略', async () => {
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    // 回退源（version.json）给出的是别的渠道的清单
    fetchImpl: async (input) => {
      if (isGitHubApi(input)) throw new Error('fetch failed');
      return manifestResponse({ channel: 'dev', version: '9.9.9' });
    },
  });
  assert.equal(status.available, false);
  assert.match(String(status.error), /渠道/);
});

test('打开接收测试版后 release 用户能看到 beta 版', async () => {
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: true,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      assert.equal(String(input), UPDATE_RELEASES_API, '开关打开后查的是发布列表');
      return manifestResponse([
        releaseBody({
          tag_name: 'v0.1.0',
          body: '正式版',
          prerelease: false,
          assets: [
            {
              name: 'DawnTick-0.1.0-release-windows-x64-setup.exe',
              size: 90,
              browser_download_url: 'https://example.com/stable.exe',
            },
          ],
        }),
        releaseBody({
          tag_name: 'v0.2.0-beta.1',
          body: '渠道 beta · 来源 beta · 提交 9c1de44',
          prerelease: true,
          assets: [
            {
              name: 'DawnTick-0.2.0-beta.1-beta-windows-x64-setup.exe',
              size: 120,
              browser_download_url: 'https://example.com/beta.exe',
            },
          ],
        }),
      ]);
    },
  });
  assert.equal(status.feed, 'beta');
  assert.equal(status.available, true);
  assert.equal(status.latest, '0.2.0-beta.1');
  assert.equal(status.manifest?.channel, 'beta');
});

test('beta 列表里正式版更高时，测试版用户更新到正式版', async () => {
  const list = [
    releaseBody({
      tag_name: 'v0.2.0-beta.1',
      body: '渠道 beta · 来源 beta · 提交 1aac20a',
      prerelease: true,
      assets: [
        {
          name: 'DawnTick-0.2.0-beta.1-beta-android.apk',
          size: 100,
          browser_download_url: 'https://example.com/beta.apk',
        },
      ],
    }),
    releaseBody({
      tag_name: 'v0.3.0',
      body: '渠道 release · 来源 main · 提交 aaaaaaa',
      prerelease: false,
      assets: [
        {
          name: 'DawnTick-0.3.0-release-android.apk',
          size: 110,
          browser_download_url: 'https://example.com/stable.apk',
        },
      ],
    }),
  ];
  const status = await checkForUpdate({
    channel: 'beta',
    receiveBeta: true,
    currentVersion: '0.2.0-beta.1',
    fetchImpl: async () => manifestResponse(list),
  });
  assert.equal(status.feed, 'beta');
  assert.equal(status.latest, '0.3.0', '正式版版本更高时按正式版算');
  assert.equal(status.manifest?.channel, 'release', '清单渠道跟随实际来源');
  assert.equal(status.manifest?.assets?.android?.url, 'https://example.com/stable.apk');
  assert.equal(status.available, true);

  // 同号正式版高于预发布：测试版用户应当更到正式版
  const same = await checkForUpdate({
    channel: 'beta',
    receiveBeta: true,
    currentVersion: '0.2.0-beta.1',
    fetchImpl: async () => manifestResponse([releaseBody({ tag_name: 'v0.2.0', prerelease: false })]),
  });
  assert.equal(same.latest, '0.2.0');
  assert.equal(same.manifest?.channel, 'release');
  assert.equal(same.available, true, '0.2.0 高于 0.2.0-beta.1');
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

  const newerBeta = pickBetaCandidate([
    releaseBody({ tag_name: 'v0.1.0-beta.2', prerelease: true }),
    releaseBody({ tag_name: 'v0.2.0-beta.1', prerelease: true }),
    releaseBody({ tag_name: 'v0.1.9', prerelease: false }),
  ]);
  assert.equal(newerBeta?.channel, 'beta', 'beta 版本更高时按 beta 算');
  assert.equal(newerBeta?.record['tag_name'], 'v0.2.0-beta.1');
});

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

test('各渠道更新源各自独立：beta 只查发布列表', () => {
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
  assert.equal(UPDATE_API_FEEDS.beta, UPDATE_RELEASES_API, 'beta 首选取发布列表');
  assert.equal(UPDATE_API_FEEDS.release, 'https://api.github.com/repos/muyangplus/dawn-tick/releases/latest');
  assert.equal(new Set(Object.values(UPDATE_API_FEEDS)).size, 3);
});

// —— GitHub 发布接口取源（首选） ——

test('dev 从资产名取版本：滚动 tag（dev-latest）读不出语义化版本', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input, init) => {
      seen.push(String(input));
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.['accept'],
        'application/vnd.github+json',
        'API 请求头口径',
      );
      return manifestResponse({
        tag_name: 'dev-latest',
        name: 'dev-latest',
        body: '  渠道 dev · 来源 dev · 提交 b7e140a  ',
        published_at: '2026-05-01T12:00:00Z',
        prerelease: true,
        draft: false,
        assets: [
          {
            name: 'DawnTick-0.1.1-dev-windows-x64-portable.zip',
            size: 90,
            browser_download_url: 'https://example.com/portable.zip',
          },
          {
            name: 'DawnTick-0.1.1-dev-windows-x64-setup.exe',
            size: 120,
            browser_download_url: 'https://example.com/setup.exe',
          },
          {
            name: 'SHA256SUMS.txt',
            size: 128,
            browser_download_url: 'https://example.com/SHA256SUMS.txt',
          },
          {
            name: 'DawnTick-0.1.1-dev-android.apk',
            size: 60,
            browser_download_url: 'https://example.com/app.apk',
          },
          {
            name: 'DawnTick-0.1.1-dev-web.zip',
            size: 30,
            browser_download_url: 'https://example.com/web.zip',
          },

        ],
      });
    },
  });

  assert.deepEqual(seen, [UPDATE_API_FEEDS.dev], '首选命中时只发一次请求，不回退 version.json');
  assert.equal(status.error, null);
  assert.equal(status.feed, 'dev');
  assert.equal(status.latest, '0.1.1');
  assert.equal(status.available, true);
  assert.equal(status.manifest?.channel, 'dev');
  assert.equal(status.manifest?.notes, '渠道 dev · 来源 dev · 提交 b7e140a', 'notes 去掉首尾空白');
  assert.equal(status.manifest?.commit, 'b7e140a');
  assert.equal(status.manifest?.releasedAt, Date.parse('2026-05-01T12:00:00Z'));
  assert.equal(status.manifest?.assets?.windows?.url, 'https://example.com/setup.exe', 'windows 优先安装包');
  assert.equal(status.manifest?.assets?.windows?.size, 120);
  assert.equal(
    status.manifest?.checksumsUrl,
    'https://example.com/SHA256SUMS.txt',
    '合并校验文件挂到 checksumsUrl，供下载后校验',
  );
  assert.equal(
    status.manifest?.assets?.windows?.name,
    'DawnTick-0.1.1-dev-windows-x64-setup.exe',
    '保留发布时的原始文件名，用于在 SHA256SUMS.txt 里定位摘要',
  );
  assert.equal(status.manifest?.assets?.android?.size, 60);
  assert.equal(status.manifest?.assets?.web?.url, 'https://example.com/web.zip', 'SHA256SUMS.txt 不算静态包');
});

test('windows 只有便携包时退回 portable.zip', async () => {
  const status = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () =>
      manifestResponse({
        tag_name: 'dev-latest',
        assets: [
          {
            name: 'DawnTick-0.1.1-dev-windows-x64-portable.zip',
            size: 90,
            browser_download_url: 'https://example.com/portable.zip',
          },
        ],
      }),
  });
  assert.equal(status.manifest?.assets?.windows?.url, 'https://example.com/portable.zip');
});

test('release 从 tag 取版本；/releases/latest 给到预发布或草稿时按无更新处理', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'release',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      seen.push(String(input));
      return manifestResponse(releaseBody({ assets: [] }));
    },
  });
  assert.deepEqual(seen, ['https://api.github.com/repos/muyangplus/dawn-tick/releases/latest']);
  assert.equal(status.latest, '0.2.0');
  assert.equal(status.available, true);
  assert.equal(status.manifest?.channel, 'release');
  assert.equal(status.manifest?.commit, '4f2a1cd');

  for (const flag of ['prerelease', 'draft'] as const) {
    const skipped = await checkForUpdate({
      channel: 'release',
      receiveBeta: false,
      currentVersion: '0.1.0',
      fetchImpl: async () => manifestResponse(releaseBody({ [flag]: true })),
    });
    assert.equal(skipped.error, null, `${flag} 不算失败`);
    assert.equal(skipped.available, false, `${flag} 视为无可用更新`);
    assert.equal(skipped.latest, null);
    assert.equal(skipped.manifest, null);
  }
});

test('API 状态错误各自给文案，且不回退 version.json', async () => {
  const cases: Array<[number, RegExp]> = [
    [404, /该渠道还没有发布记录/],
    [403, /GitHub 接口限流/],
    [429, /GitHub 接口限流/],
    [500, /更新源返回 500/],
  ];
  for (const [status, pattern] of cases) {
    const seen: string[] = [];
    const result = await checkForUpdate({
      channel: 'dev',
      receiveBeta: false,
      currentVersion: '0.1.0',
      fetchImpl: async (input) => {
        seen.push(String(input));
        return manifestResponse({}, false, status);
      },
    });
    assert.match(String(result.error), pattern, `状态 ${status} 的文案`);
    assert.equal(result.available, false);
    assert.equal(result.latest, null);
    assert.equal(seen.length, 1, `状态 ${status} 不回退 version.json`);
    assert.equal(seen[0], UPDATE_API_FEEDS.dev);
  }
});

test('API 返回的 JSON 无法解析或结构不符都给格式文案', async () => {
  const unparsable = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token <');
        },
      }) as unknown as Response,
  });
  assert.equal(unparsable.error, '更新清单格式不正确');

  const shapeless = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async () =>
      manifestResponse({ tag_name: 'dev-latest', assets: [{ name: 'README.txt', browser_download_url: 'x' }] }),
  });
  assert.equal(shapeless.error, '更新清单格式不正确');
});

// —— 网络异常才回退 version.json 直连 ——

test('API 网络异常时回退 version.json 直连', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      const url = String(input);
      seen.push(url);
      if (isGitHubApi(url)) throw new Error('fetch failed');
      return manifestResponse({ channel: 'dev', version: '0.2.0', notes: '回退清单' });
    },
  });

  assert.deepEqual(seen, [UPDATE_API_FEEDS.dev, UPDATE_FEEDS.dev], '先 API，再回退直连');
  assert.equal(status.error, null);
  assert.equal(status.latest, '0.2.0');
  assert.equal(status.available, true);
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
  assert.deepEqual(seen, [UPDATE_API_FEEDS.release, UPDATE_FEEDS.release], '先 API，再回退 releases/latest 直连');
  assert.equal(status.error, null);
  assert.equal(status.latest, '0.2.0');
  assert.equal(status.available, true);
  assert.equal(status.manifest?.channel, 'release');
});

test('beta 没有固定直连兜底：只查发布列表，网络异常时交回原始错误', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'beta',
    receiveBeta: true,
    currentVersion: '0.2.0-beta.1',
    fetchImpl: async (input) => {
      seen.push(String(input));
      throw new Error('fetch failed: api.github.com');
    },
  });
  assert.deepEqual(seen, [UPDATE_RELEASES_API], 'beta 只查发布列表，不再回退到不存在的滚动标签');
  assert.equal(status.available, false);
  assert.equal(status.latest, null);
  assert.equal(status.manifest, null);
  assert.match(String(status.error), /fetch failed: api\.github\.com/);
});

test('回退源也失败时把 API 的原始网络错误交出去', async () => {
  const seen: string[] = [];
  const status = await checkForUpdate({
    channel: 'dev',
    receiveBeta: false,
    currentVersion: '0.1.0',
    fetchImpl: async (input) => {
      seen.push(String(input));
      throw new Error('fetch failed: api.github.com');
    },
  });
  assert.equal(seen.length, 2, '两个地址都试过');
  assert.equal(status.available, false);
  assert.equal(status.latest, null);
  assert.match(String(status.error), /fetch failed: api\.github\.com/);
});
