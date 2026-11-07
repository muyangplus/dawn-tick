import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSET_SUFFIXES,
  CHANNEL_BRANCH,
  CHECKSUMS_FILE,
  DEFAULT_ASSETS_REPO,
  MIRROR_FILE,
  buildMirrorJson,
  channelBranch,
  describeGitFailure,
  fetchReleaseBody,
  missingPlatforms,
  publishAssets,
  readNotes,
  redact,
  remoteUrl,
  selectAssets,
} from './publish-assets.mjs';

const VERSION = '0.6.6';
const CHANNEL = 'beta';
const PREFIX = `DawnTick-${VERSION}-${CHANNEL}`;

const PRODUCTS = [
  `${PREFIX}-windows-x64-setup.exe`,
  `${PREFIX}-windows-x64-portable.zip`,
  `${PREFIX}-android.apk`,
  `${PREFIX}-web.zip`,
  CHECKSUMS_FILE,
  'version.json',
];

function seed(names = PRODUCTS) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-assets-'));
  for (const name of names) writeFileSync(join(dir, name), `内容：${name}\n`);
  return dir;
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

test('channelBranch：dev / beta / release 各自一条单提交分支，未知渠道报错', () => {
  assert.equal(channelBranch('dev'), 'dev');
  assert.equal(channelBranch('beta'), 'beta');
  assert.equal(channelBranch('release'), 'release');
  assert.deepEqual(CHANNEL_BRANCH, { dev: 'dev', beta: 'beta', release: 'release' });
  assert.throws(() => channelBranch('nightly'), /未知渠道：nightly/);
  assert.throws(() => channelBranch(''), /未知渠道/);
});

test('selectAssets：只挑四个平台产物与两份清单，并按名字排序', () => {
  const dir = seed([...PRODUCTS, 'notes.md', 'sha.txt', `${PREFIX}-android.apk.sha256`]);
  const names = selectAssets(dir).map((file) => file.name);
  assert.deepEqual(names, [
    `${PREFIX}-android.apk`,
    `${PREFIX}-web.zip`,
    `${PREFIX}-windows-x64-portable.zip`,
    `${PREFIX}-windows-x64-setup.exe`,
    CHECKSUMS_FILE,
    'version.json',
  ]);
  for (const suffix of ASSET_SUFFIXES) assert.ok(names.some((name) => name.endsWith(suffix)), suffix);
  // 体积与摘要来自本地文件，不是从发布接口抄来的
  const setup = selectAssets(dir).find((file) => file.name.endsWith('-setup.exe'));
  assert.equal(setup?.size, Buffer.byteLength(`内容：${PREFIX}-windows-x64-setup.exe\n`));
  assert.equal(setup?.sha256, digest(`内容：${PREFIX}-windows-x64-setup.exe\n`));
});

test('buildMirrorJson：渠道 / 版本 / 文件映射 / sha256 / 校验清单齐备', () => {
  const dir = seed();
  const files = selectAssets(dir);
  const mirror = buildMirrorJson({
    channel: CHANNEL,
    version: VERSION,
    tag: `v${VERSION}`,
    commit: 'abcdef1234567890',
    releasedAt: 1_760_000_000_000,
    notes: '  渠道 beta · 提交 abcdef1  ',
    files,
  });
  assert.equal(mirror.schema, 1);
  assert.equal(mirror.channel, 'beta');
  assert.equal(mirror.version, VERSION);
  assert.equal(mirror.tag, `v${VERSION}`);
  assert.equal(mirror.commit, 'abcdef1', '提交号按 7 位短哈希写入');
  assert.equal(mirror.releasedAt, 1_760_000_000_000);
  assert.equal(mirror.notes, '渠道 beta · 提交 abcdef1');
  assert.equal(mirror.checksums, CHECKSUMS_FILE);
  assert.deepEqual(Object.keys(mirror.files), ['windowsSetup', 'windowsPortable', 'android', 'web']);
  assert.equal(mirror.files.windowsSetup.name, `${PREFIX}-windows-x64-setup.exe`);
  assert.equal(mirror.files.windowsPortable.name, `${PREFIX}-windows-x64-portable.zip`);
  assert.equal(mirror.files.android.name, `${PREFIX}-android.apk`);
  assert.equal(mirror.files.web.name, `${PREFIX}-web.zip`);
  for (const key of ['windowsSetup', 'windowsPortable', 'android', 'web']) {
    const entry = mirror.files[key];
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, key);
    assert.ok(entry.size > 0, key);
    assert.equal(entry.sha256, digest(`内容：${entry.name}\n`), `${key} 的摘要取自本地文件`);
  }
});

test('buildMirrorJson：缺任一平台产物都报错并指出缺哪个', () => {
  const dir = seed([`${PREFIX}-windows-x64-setup.exe`, CHECKSUMS_FILE, 'version.json']);
  const files = selectAssets(dir);
  assert.deepEqual(missingPlatforms(files), ['windowsPortable', 'android', 'web']);
  assert.throws(
    () => buildMirrorJson({ channel: CHANNEL, version: VERSION, tag: `v${VERSION}`, files }),
    /缺少发布产物：windowsPortable、android、web/,
  );
  assert.throws(
    () => buildMirrorJson({ channel: 'nightly', version: VERSION, tag: `v${VERSION}`, files }),
    /未知渠道/,
  );
  assert.throws(
    () => buildMirrorJson({ channel: CHANNEL, version: '', tag: `v${VERSION}`, files: selectAssets(seed()) }),
    /缺少版本号/,
  );
  assert.throws(
    () => buildMirrorJson({ channel: CHANNEL, version: VERSION, tag: '', files: selectAssets(seed()) }),
    /缺少标签/,
  );
});

test('fetchReleaseBody：读 GitHub Release 正文（含 Full Changelog），失败返回 null', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input) => {
    seen.push(String(input));
    return { ok: true, json: async () => ({ body: '正文\n\n**Full Changelog**: https://example.com/compare' }) };
  };
  try {
    const body = await fetchReleaseBody({ repo: 'o/r', tag: 'v0.6.6', token: 't' });
    assert.match(String(body), /Full Changelog/);
    assert.match(seen[0], /api\.github\.com\/repos\/o\/r\/releases\/tags\/v0\.6\.6/);
  } finally {
    globalThis.fetch = original;
  }

  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    assert.equal(await fetchReleaseBody({ tag: 'v0.6.6' }), null, '网络异常时让调用方回退 NOTES_FILE');
    assert.equal(await fetchReleaseBody({ tag: '' }), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('readNotes：优先 NOTES_FILE，缺失时退回 version.json 的 notes', () => {
  const dir = seed();
  const notesFile = join(dir, 'notes.md');
  writeFileSync(notesFile, '来自 NOTES_FILE');
  assert.equal(readNotes(notesFile, dir), '来自 NOTES_FILE');
  assert.equal(readNotes(join(dir, '不存在.md'), dir), '', 'version.json 由 seed 写入假内容，解析失败时为空串');

  writeFileSync(join(dir, 'version.json'), JSON.stringify({ notes: '来自 version.json' }));
  assert.equal(readNotes('', dir), '来自 version.json');
  assert.equal(readNotes(join(dir, '不存在.md'), dir), '来自 version.json');
});

test('publishAssets：缺 ASSETS_TOKEN 时跳过，不写 mirror.json、不碰 git', () => {
  const dir = seed();
  const calls = [];
  const result = publishAssets({
    outDir: dir,
    channel: CHANNEL,
    tag: `v${VERSION}`,
    version: VERSION,
    token: '',
    run: (args) => calls.push(args),
  });
  assert.deepEqual(result, { skipped: true });
  assert.equal(existsSync(join(dir, MIRROR_FILE)), false);
  assert.deepEqual(calls, []);
});

test('publishAssets：dry-run 只生成 mirror.json，不推送、不需要 token', () => {
  const dir = seed();
  const calls = [];
  const result = publishAssets({
    outDir: dir,
    channel: 'dev',
    tag: 'dev-latest',
    version: VERSION,
    dryRun: true,
    run: (args) => calls.push(args),
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.branch, 'dev');
  assert.equal(existsSync(join(dir, MIRROR_FILE)), true);
  assert.deepEqual(calls, []);
  assert.equal(JSON.parse(readFileSync(join(dir, MIRROR_FILE), 'utf8')).channel, 'dev');
});

test('publishAssets：生成 mirror.json 并 force-push 到对应渠道分支', () => {
  const dir = seed();
  const calls = [];
  const result = publishAssets({
    outDir: dir,
    channel: 'release',
    tag: `v${VERSION}`,
    version: VERSION,
    commit: 'abcdef1234567890',
    notes: '发布说明',
    token: 'secret-token',
    releasedAt: 1_760_000_000_000,
    run: (args, options) => {
      calls.push({ args, options });
      return '';
    },
  });
  assert.equal(result.skipped, false);
  assert.equal(result.branch, 'release');
  assert.equal(result.files, PRODUCTS.length + 1, '包含新生成的 mirror.json');
  assert.ok(result.bytes > 0);

  const mirror = JSON.parse(readFileSync(join(dir, MIRROR_FILE), 'utf8'));
  assert.equal(mirror.channel, 'release');
  assert.equal(mirror.version, VERSION);
  assert.match(mirror.files.windowsSetup.sha256, /^[0-9a-f]{64}$/);

  const checkout = calls.find((call) => call.args[0] === 'checkout');
  assert.deepEqual(checkout?.args, ['checkout', '--orphan', 'release']);
  const push = calls.find((call) => call.args[0] === 'push');
  assert.ok(push !== undefined, '必须执行 git push');
  assert.equal(push.args[1], '--force');
  assert.equal(push.args[3], 'HEAD:refs/heads/release');
  assert.match(push.args[2], /^https:\/\/x-access-token:secret-token@github\.com\/muyangplus\/dawn-tick-assets\.git$/);
  assert.equal(calls.every((call) => typeof call.options.cwd === 'string'), true, '全部在临时目录里执行');
  assert.equal(calls[0]?.options.cwd.includes('dawn-tick-assets-'), true, '不把产物带进主仓库');
});

test('remoteUrl / DEFAULT_ASSETS_REPO：默认推独立产物仓库', () => {
  assert.equal(DEFAULT_ASSETS_REPO, 'muyangplus/dawn-tick-assets');
  assert.equal(remoteUrl('owner/repo', 't'), 'https://x-access-token:t@github.com/owner/repo.git');
});

test('redact / describeGitFailure：报错不带 token，仓库不存在时提示建仓', () => {
  assert.equal(redact('https://x-access-token:abc@github.com/o/r.git', 'abc'), 'https://x-access-token:***@github.com/o/r.git');
  assert.equal(redact('没有 token', ''), '没有 token');
  const missing = describeGitFailure('remote: Repository not found.\nfatal: repository not found', 'muyangplus/dawn-tick-assets');
  assert.match(missing, /请先在 GitHub 创建 public 仓库 muyangplus\/dawn-tick-assets/);
  assert.match(missing, /ASSETS_TOKEN 有 contents 写权限/);
  const other = describeGitFailure('fatal: unable to access: Could not resolve host', 'muyangplus/dawn-tick-assets');
  assert.match(other, /推送 assets 仓库失败/);
});
