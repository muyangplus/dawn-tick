import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSETS_BRANCH,
  ASSETS_REPO,
  ASSETS_VERSION_FILE,
  CHECKSUMS_FILE,
  assetsFileUrl,
  assetsVersionUrl,
  manifestFromAssetsVersion,
  parseAssetsVersion,
} from '../src/lib/assets-mirror.ts';
import { planUpdateDownload } from '../src/lib/update-download.ts';

const SHA = 'a'.repeat(64);

function versionJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 2,
    channel: 'beta',
    version: '0.6.6',
    tag: 'v0.6.6',
    commit: 'abcdef1',
    releasedAt: 1_760_000_000_000,
    notes: '渠道 beta · 提交 abcdef1\n\n### 新增\n- 测试',
    artifacts: ['DawnTick-0.6.6-beta-web.zip'],
    files: {
      windowsSetup: { name: 'DawnTick-0.6.6-beta-windows-x64-setup.exe', size: 7_300_000, sha256: SHA },
      windowsPortable: { name: 'DawnTick-0.6.6-beta-windows-x64-portable.zip', size: 7_500_000, sha256: 'b'.repeat(64) },
      android: { name: 'DawnTick-0.6.6-beta-android.apk', size: 12_800_000, sha256: 'c'.repeat(64) },
      web: { name: 'DawnTick-0.6.6-beta-web.zip', size: 2_200_000, sha256: 'd'.repeat(64) },
    },
    checksums: CHECKSUMS_FILE,
    ...overrides,
  };
}

function parseOk(value: unknown) {
  const result = parseAssetsVersion(value);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (!result.ok) throw new Error(result.error);
  return result.manifest;
}

test('v2 契约常量与渠道分支：三条分支 dev / beta / release', () => {
  assert.equal(ASSETS_REPO, 'muyangplus/dawn-tick-assets');
  assert.equal(ASSETS_VERSION_FILE, 'version.json');
  assert.equal(CHECKSUMS_FILE, 'SHA256SUMS.txt');
  assert.deepEqual(ASSETS_BRANCH, { dev: 'dev', beta: 'beta', release: 'release' });
  assert.equal(
    assetsVersionUrl('github', 'dev'),
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/dev/version.json',
  );
  assert.equal(
    assetsVersionUrl('gitee', 'beta'),
    'https://gitee.com/muyangplus/dawn-tick-assets/raw/beta/version.json',
  );
  assert.equal(assetsFileUrl('gitee', 'beta', 'x.zip'), 'https://gitee.com/muyangplus/dawn-tick-assets/raw/beta/x.zip');
});

test('parseAssetsVersion：完整 v2 清单通过，渠道 / 版本 / 文件表齐全', () => {
  const manifest = parseOk(versionJson());
  assert.equal(manifest.schema, 2);
  assert.equal(manifest.channel, 'beta');
  assert.equal(manifest.version, '0.6.6');
  assert.equal(manifest.tag, 'v0.6.6');
  assert.equal(manifest.commit, 'abcdef1');
  assert.equal(manifest.releasedAt, 1_760_000_000_000);
  assert.equal(manifest.checksums, CHECKSUMS_FILE);
  assert.deepEqual(Object.keys(manifest.files), ['windowsSetup', 'windowsPortable', 'android', 'web']);
  assert.equal(manifest.files.android?.size, 12_800_000);
});

test('parseAssetsVersion：缺字段 / 类型不对 / 旧 schema 都给出可读错误', () => {
  const cases: Array<[label: string, value: unknown, pattern: RegExp]> = [
    ['不是对象', null, /version\.json 不是对象/],
    ['旧 schema 1', versionJson({ schema: 1 }), /schema 不是 2/],
    ['缺 schema', versionJson({ schema: undefined }), /schema 不是 2/],
    ['渠道非法', versionJson({ channel: 'nightly' }), /渠道不是 dev/],
    ['缺版本号', versionJson({ version: '  ' }), /缺少版本号/],
    ['缺 files', versionJson({ files: undefined }), /缺少 files/],
    ['files 为空', versionJson({ files: {} }), /缺少文件/],
    [
      '缺 windowsSetup 的 name',
      versionJson({ files: { windowsSetup: { size: 1, sha256: SHA } } }),
      /缺少文件 windowsSetup 的 name/,
    ],
    [
      'sha256 不是 64 位',
      versionJson({ files: { android: { name: 'a.apk', size: 1, sha256: 'xyz' } } }),
      /android 的 sha256 不是 64 位十六进制/,
    ],
    [
      'size 不是字节数',
      versionJson({ files: { web: { name: 'w.zip', size: '1', sha256: SHA } } }),
      /web 的 size 不是有效字节数/,
    ],
    ['releasedAt 类型不对', versionJson({ releasedAt: '昨天' }), /releasedAt/],
    ['notes 类型不对', versionJson({ notes: 1 }), /notes 不是字符串/],
    ['commit 类型不对', versionJson({ commit: 7 }), /commit 不是字符串/],
  ];
  for (const [label, value, pattern] of cases) {
    const result = parseAssetsVersion(value);
    assert.equal(result.ok, false, label);
    if (!result.ok) assert.match(result.error, pattern, label);
  }
});

test('parseAssetsVersion：只有部分平台产物时仍可用（缺的平台由下载计划提示）', () => {
  const manifest = parseOk(
    versionJson({ files: { windowsPortable: { name: 'p.zip', size: 1, sha256: SHA } } }),
  );
  assert.deepEqual(Object.keys(manifest.files), ['windowsPortable']);
  assert.equal(manifest.checksums, CHECKSUMS_FILE, '清单没写 checksums 时默认 SHA256SUMS.txt');
});

test('manifestFromAssetsVersion：版本 / 渠道 / 说明来自清单，URL 指向同源 raw', () => {
  const manifest = manifestFromAssetsVersion(parseOk(versionJson()), 'gitee');
  assert.equal(manifest.channel, 'beta');
  assert.equal(manifest.version, '0.6.6');
  assert.equal(manifest.commit, 'abcdef1');
  assert.equal(manifest.releasedAt, 1_760_000_000_000);
  assert.match(String(manifest.notes), /渠道 beta/);
  assert.deepEqual(Object.keys(manifest.assets ?? {}), ['windows', 'windowsPortable', 'android', 'web']);
  assert.equal(
    manifest.assets?.windows?.url,
    'https://gitee.com/muyangplus/dawn-tick-assets/raw/beta/DawnTick-0.6.6-beta-windows-x64-setup.exe',
    'windows 默认给安装包',
  );
  assert.equal(
    manifest.assets?.windowsPortable?.url,
    'https://gitee.com/muyangplus/dawn-tick-assets/raw/beta/DawnTick-0.6.6-beta-windows-x64-portable.zip',
  );
  assert.equal(
    manifest.assets?.android?.url,
    'https://gitee.com/muyangplus/dawn-tick-assets/raw/beta/DawnTick-0.6.6-beta-android.apk',
  );
  assert.equal(
    manifest.checksumsUrl,
    'https://gitee.com/muyangplus/dawn-tick-assets/raw/beta/SHA256SUMS.txt',
    '校验文件指向同一分支',
  );
  assert.equal(manifest.assets?.windows?.sha256, SHA, '清单直接给摘要，下载后不必先拉 SHA256SUMS');
  assert.equal(manifest.assets?.windows?.size, 7_300_000);
});

test('manifestFromAssetsVersion：GitHub 源用 raw.githubusercontent，便携版单独保留', () => {
  const manifest = manifestFromAssetsVersion(parseOk(versionJson()), 'github');
  assert.equal(
    manifest.assets?.windows?.url,
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/beta/DawnTick-0.6.6-beta-windows-x64-setup.exe',
  );
  assert.equal(
    manifest.checksumsUrl,
    'https://raw.githubusercontent.com/muyangplus/dawn-tick-assets/beta/SHA256SUMS.txt',
  );
});

test('便携版选择：installKind 决定下 zip 还是 exe，两者互不串包', () => {
  const manifest = manifestFromAssetsVersion(parseOk(versionJson()), 'github');
  const installed = planUpdateDownload(manifest, 'windows', 'installed');
  assert.equal(installed.kind, 'download');
  if (installed.kind === 'download') {
    assert.equal(installed.target.url, manifest.assets?.windows?.url);
    assert.equal(installed.target.kind, 'installer');
    assert.equal(installed.target.fileName, 'DawnTick-update.exe');
    assert.match(String(installed.target.checksumsUrl), /SHA256SUMS\.txt$/);
  }
  const portable = planUpdateDownload(manifest, 'windows', 'portable');
  assert.equal(portable.kind, 'download');
  if (portable.kind === 'download') {
    assert.equal(portable.target.url, manifest.assets?.windowsPortable?.url);
    assert.equal(portable.target.kind, 'portable');
    assert.equal(portable.target.fileName, 'DawnTick-update.zip');
  }
  // Android 取 APK，Web 只提示刷新
  const android = planUpdateDownload(manifest, 'android');
  assert.equal(android.kind, 'download');
  if (android.kind === 'download') assert.match(android.target.url, /-android\.apk$/);
  assert.deepEqual(planUpdateDownload(manifest, 'web'), { kind: 'refresh' });
});
