import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECKSUMS_FILE, VERSION_JSON_FILE, writeVersionJson } from './version-json.mjs';
import {
  ASSET_SUFFIXES,
  CHANNEL_BRANCH,
  DEFAULT_ASSETS_REPO,
  channelBranch,
  describeGitFailure,
  loadVersionJson,
  publishAssets,
  readVersionJson,
  redact,
  remoteUrl,
  selectAssets,
  validateVersionJson,
} from './publish-assets.mjs';

const VERSION = '0.6.6';
const CHANNEL = 'release';
const PREFIX = `DawnTick-${VERSION}-${CHANNEL}`;
const TAG = `v${VERSION}`;
const RELEASED_AT = 1_760_000_000_000;

const PRODUCTS = [
  `${PREFIX}-windows-x64-setup.exe`,
  `${PREFIX}-windows-x64-portable.zip`,
  `${PREFIX}-android.apk`,
  `${PREFIX}-web.zip`,
];

/** 造一份与 out/ 实际文件一致的 v2 version.json；可额外塞入 mirror.json 验证它被忽略。 */
function seed({ channel = CHANNEL, omit = [], extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-assets-'));
  const prefix = `DawnTick-${VERSION}-${channel}`;
  const names = [
    `${prefix}-windows-x64-setup.exe`,
    `${prefix}-windows-x64-portable.zip`,
    `${prefix}-android.apk`,
    `${prefix}-web.zip`,
  ];
  for (const name of names) writeFileSync(join(dir, name), `内容：${name}\n`);
  writeFileSync(join(dir, CHECKSUMS_FILE), '校验清单\n');
  for (const name of extra) writeFileSync(join(dir, name), '旧清单，不应推送\n');
  writeVersionJson({
    outDir: dir,
    channel,
    version: VERSION,
    tag: TAG,
    notes: '发布说明',
    commit: 'abcdef1234567890',
    releasedAt: RELEASED_AT,
  });
  for (const name of omit) rmSync(join(dir, name), { force: true });
  return dir;
}

function patchManifest(dir, patch) {
  const manifest = readVersionJson(dir);
  writeFileSync(join(dir, VERSION_JSON_FILE), `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`);
}

test('channelBranch：dev / beta / release 各自一条单提交分支，未知渠道报错', () => {
  assert.equal(channelBranch('dev'), 'dev');
  assert.equal(channelBranch('beta'), 'beta');
  assert.equal(channelBranch('release'), 'release');
  assert.deepEqual(CHANNEL_BRANCH, { dev: 'dev', beta: 'beta', release: 'release' });
  assert.throws(() => channelBranch('nightly'), /未知渠道：nightly/);
  assert.throws(() => channelBranch(''), /未知渠道/);
});

test('selectAssets：只挑四个平台产物与 version.json / SHA256SUMS.txt，忽略旧 mirror.json', () => {
  const dir = seed({ extra: ['mirror.json'] });
  try {
    const names = selectAssets(dir).map((file) => file.name);
    assert.deepEqual(names, [
      `${PREFIX}-android.apk`,
      `${PREFIX}-web.zip`,
      `${PREFIX}-windows-x64-portable.zip`,
      `${PREFIX}-windows-x64-setup.exe`,
      CHECKSUMS_FILE,
      VERSION_JSON_FILE,
    ]);
    assert.equal(names.includes('mirror.json'), false, '不再推送 mirror.json');
    for (const suffix of ASSET_SUFFIXES) assert.ok(names.some((name) => name.endsWith(suffix)), suffix);
    const setup = selectAssets(dir).find((file) => file.name.endsWith('-setup.exe'));
    assert.equal(setup?.size, Buffer.byteLength(`内容：${PREFIX}-windows-x64-setup.exe\n`));
    assert.match(String(setup?.sha256), /^[0-9a-f]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadVersionJson：v2 清单与 out/ 文件一致时通过，保留旧字段与 files/checksums', () => {
  const dir = seed();
  try {
    const manifest = loadVersionJson(dir);
    assert.equal(manifest.schema, 2);
    assert.equal(manifest.channel, CHANNEL);
    assert.equal(manifest.version, VERSION);
    assert.equal(manifest.tag, TAG);
    assert.equal(manifest.commit, 'abcdef1');
    assert.equal(manifest.releasedAt, RELEASED_AT);
    assert.equal(manifest.notes, '发布说明');
    assert.deepEqual(Object.keys(manifest.files), ['windowsSetup', 'windowsPortable', 'android', 'web']);
    assert.equal(manifest.files.windowsSetup.name, `${PREFIX}-windows-x64-setup.exe`);
    assert.equal(manifest.checksums, CHECKSUMS_FILE);
    for (const key of ['windowsSetup', 'windowsPortable', 'android', 'web']) {
      assert.equal(manifest.files[key].sha256, selectAssets(dir).find((f) => f.name === manifest.files[key].name).sha256);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadVersionJson：缺文件 / 哈希或体积不符 / schema 不是 2 都报可读错误', () => {
  const dir = seed();
  try {
    assert.throws(
      () => validateVersionJson(readVersionJson(dir), []),
      /缺少发布产物：windowsSetup、windowsPortable、android、web/,
    );
    assert.throws(() => validateVersionJson({ ...readVersionJson(dir), schema: 1 }, selectAssets(dir)), /schema 不是 2/);
    assert.throws(
      () => validateVersionJson({ ...readVersionJson(dir), checksums: 'CHECKSUMS.md' }, selectAssets(dir)),
      /checksums 不是 SHA256SUMS\.txt/,
    );

    patchManifest(dir, { files: { ...readVersionJson(dir).files, android: { ...readVersionJson(dir).files.android, size: 1 } } });
    assert.throws(() => loadVersionJson(dir), /体积与 version\.json 不一致/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const corrupt = seed();
  try {
    patchManifest(corrupt, {
      files: { ...readVersionJson(corrupt).files, web: { ...readVersionJson(corrupt).files.web, sha256: 'f'.repeat(64) } },
    });
    assert.throws(() => loadVersionJson(corrupt), /SHA256 与 version\.json 不一致/);
  } finally {
    rmSync(corrupt, { recursive: true, force: true });
  }

  const missing = seed({ omit: [`${PREFIX}-android.apk`] });
  try {
    assert.throws(() => loadVersionJson(missing), /缺少发布产物：android/);
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }

  const noVersion = seed();
  try {
    rmSync(join(noVersion, VERSION_JSON_FILE));
    assert.throws(() => loadVersionJson(noVersion), /缺少 version\.json/);
  } finally {
    rmSync(noVersion, { recursive: true, force: true });
  }
});

test('publishAssets：缺 ASSETS_TOKEN 时跳过，不生成 mirror.json、不碰 git', () => {
  const dir = seed();
  const calls = [];
  try {
    const result = publishAssets({
      outDir: dir,
      channel: CHANNEL,
      tag: TAG,
      token: '',
      run: (args) => calls.push(args),
    });
    assert.deepEqual(result, { skipped: true });
    assert.deepEqual(calls, []);
    assert.equal(readdirSync(dir).includes('mirror.json'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('publishAssets：dry-run 只做 v2 校验，不推送、不写文件、不需要 token', () => {
  const seedDev = seed({ channel: 'dev' });
  const calls = [];
  try {
    const result = publishAssets({
      outDir: seedDev,
      channel: 'dev',
      tag: TAG,
      dryRun: true,
      run: (args) => calls.push(args),
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.branch, 'dev');
    assert.equal(result.files, 6);
    assert.equal(result.version, VERSION);
    assert.deepEqual(calls, []);
    assert.equal(readFileSync(join(seedDev, VERSION_JSON_FILE), 'utf8').includes('"schema": 2'), true);
  } finally {
    rmSync(seedDev, { recursive: true, force: true });
  }
});

test('publishAssets：把 4 产物 + SHA256SUMS.txt + version.json force-push 到渠道分支', () => {
  const dir = seed({ extra: [] });
  const calls = [];
  try {
    const result = publishAssets({
      outDir: dir,
      channel: 'release',
      tag: TAG,
      token: 'secret-token',
      commit: 'abcdef1234567890',
      notes: '发布说明',
      releasedAt: RELEASED_AT,
      run: (args, options) => {
        calls.push({ args, options });
        return '';
      },
    });
    assert.equal(result.skipped, false);
    assert.equal(result.branch, 'release');
    assert.equal(result.files, 6, '4 个产物 + SHA256SUMS.txt + version.json');
    assert.equal(result.version, VERSION);
    assert.ok(result.bytes > 0);

    const commit = calls.find((call) => call.args.includes('commit'));
    const staged = readdirSync(commit.options.cwd).sort();
    assert.deepEqual(staged, [
      `${PREFIX}-android.apk`,
      `${PREFIX}-web.zip`,
      `${PREFIX}-windows-x64-portable.zip`,
      `${PREFIX}-windows-x64-setup.exe`,
      CHECKSUMS_FILE,
      VERSION_JSON_FILE,
    ]);
    assert.deepEqual(
      JSON.parse(readFileSync(join(commit.options.cwd, VERSION_JSON_FILE), 'utf8')),
      readVersionJson(dir),
      'assets 分支里的 version.json 与 out/ 完全相同（同一份清单）',
    );
    assert.match(String(commit.args.at(-1)), /release: release 0\.6\.6（v0\.6\.6）/, '提交信息带版本与标签');

    const checkout = calls.find((call) => call.args[0] === 'checkout');
    assert.deepEqual(checkout?.args, ['checkout', '--orphan', 'release']);
    const push = calls.find((call) => call.args[0] === 'push');
    assert.ok(push !== undefined, '必须执行 git push');
    assert.equal(push.args[1], '--force');
    assert.equal(push.args[3], 'HEAD:refs/heads/release');
    assert.match(push.args[2], /^https:\/\/x-access-token:secret-token@github\.com\/muyangplus\/dawn-tick-assets\.git$/);
    assert.equal(calls.every((call) => typeof call.options.cwd === 'string'), true, '全部在临时目录里执行');
    assert.equal(calls[0]?.options.cwd.includes('dawn-tick-assets-'), true, '不把产物带进主仓库');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('publishAssets：渠道 / 标签与 version.json 不一致时拒绝推送', () => {
  const dir = seed();
  try {
    assert.throws(
      () => publishAssets({ outDir: dir, channel: CHANNEL, tag: 'v9.9.9', dryRun: true }),
      /标签 v0\.6\.6 与本次标签 v9\.9\.9 不一致/,
    );
    assert.throws(
      () => publishAssets({ outDir: dir, channel: 'beta', tag: TAG, dryRun: true }),
      /渠道 release 与本次渠道 beta 不一致/,
    );
    assert.throws(() => publishAssets({ outDir: dir, channel: 'nightly', dryRun: true }), /未知渠道/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remoteUrl / DEFAULT_ASSETS_REPO：默认推独立产物仓库', () => {
  assert.equal(DEFAULT_ASSETS_REPO, 'muyangplus/dawn-tick-assets');
  assert.equal(remoteUrl('owner/repo', 't'), 'https://x-access-token:t@github.com/owner/repo.git');
});

test('redact / describeGitFailure：报错不带 token，仓库不存在时提示建仓', () => {
  assert.equal(
    redact('https://x-access-token:abc@github.com/o/r.git', 'abc'),
    'https://x-access-token:***@github.com/o/r.git',
  );
  assert.equal(redact('没有 token', ''), '没有 token');
  const missing = describeGitFailure('remote: Repository not found.\nfatal: repository not found', 'muyangplus/dawn-tick-assets');
  assert.match(missing, /请先在 GitHub 创建 public 仓库 muyangplus\/dawn-tick-assets/);
  assert.match(missing, /ASSETS_TOKEN 有 contents 写权限/);
  const other = describeGitFailure('fatal: unable to access: Could not resolve host', 'muyangplus/dawn-tick-assets');
  assert.match(other, /推送 assets 仓库失败/);
});
