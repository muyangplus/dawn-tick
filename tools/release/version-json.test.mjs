import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHECKSUMS_FILE,
  PLATFORM_KEYS,
  VERSION_JSON_FILE,
  VERSION_SCHEMA,
  buildVersionManifest,
  listArtifacts,
  readPlatformFiles,
  writeVersionJson,
} from './version-json.mjs';

const VERSION = '0.6.6';
const CHANNEL = 'release';
const PREFIX = `DawnTick-${VERSION}-${CHANNEL}`;

const PRODUCTS = {
  windowsSetup: `${PREFIX}-windows-x64-setup.exe`,
  windowsPortable: `${PREFIX}-windows-x64-portable.zip`,
  android: `${PREFIX}-android-arm64-v8a.apk`,
  android32: `${PREFIX}-android-armeabi-v7a.apk`,
  web: `${PREFIX}-web.zip`,
};

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dawntick-version-json-'));
}

function fileContent(name) {
  return `内容：${name}\n`;
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** 造出 out/：五个产物（Android 两个 ABI）+ 派生的 `.sha256` 与校验清单（都应被清单排除）。 */
function seedProducts(dir, { omit = [] } = {}) {
  for (const key of PLATFORM_KEYS) {
    if (omit.includes(key)) continue;
    writeFileSync(join(dir, PRODUCTS[key]), fileContent(PRODUCTS[key]));
  }
  writeFileSync(join(dir, `${PRODUCTS.android}.sha256`), 'abc\n');
  writeFileSync(join(dir, CHECKSUMS_FILE), '旧校验清单\n');
}

test('v2 清单：旧字段保留，新增 schema / commit / releasedAt / files / checksums', () => {
  const dir = tempDir();
  try {
    seedProducts(dir);
    const notes = '渠道 release · 来源 main · 提交 4f2a1cd\n\n### 修复\n- 一条\n';
    const manifest = writeVersionJson({
      outDir: dir,
      channel: CHANNEL,
      version: VERSION,
      tag: `v${VERSION}`,
      notes,
      commit: 'abcdef1234567890',
      releasedAt: 1_760_000_000_000,
    });

    assert.equal(manifest.schema, VERSION_SCHEMA);
    assert.equal(manifest.schema, 2);
    assert.equal(manifest.channel, 'release');
    assert.equal(manifest.version, VERSION);
    assert.equal(manifest.tag, `v${VERSION}`);
    assert.equal(manifest.commit, 'abcdef1', '提交号按 7 位短哈希写入');
    assert.equal(manifest.releasedAt, 1_760_000_000_000);
    assert.equal(manifest.notes, notes.trim(), '旧字段 notes 原样保留');
    assert.deepEqual(manifest.artifacts, Object.values(PRODUCTS).sort(), '旧字段 artifacts 仍在');
    assert.equal(manifest.checksums, CHECKSUMS_FILE);
    assert.deepEqual(Object.keys(manifest.files), PLATFORM_KEYS);

    for (const key of PLATFORM_KEYS) {
      const entry = manifest.files[key];
      assert.equal(entry.name, PRODUCTS[key], key);
      assert.equal(entry.size, Buffer.byteLength(fileContent(entry.name)), `${key} 的体积来自 out/ 实际文件`);
      assert.equal(entry.sha256, digest(fileContent(entry.name)), `${key} 的摘要来自 out/ 实际文件`);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/, key);
    }
    assert.match(manifest.files.android.name, /-android-arm64-v8a\.apk$/, 'android 固定是 arm64 包');
    assert.match(manifest.files.android32.name, /-android-armeabi-v7a\.apk$/, 'android32 是 v7 包');

    const written = readFileSync(join(dir, VERSION_JSON_FILE), 'utf8');
    assert.ok(written.endsWith('\n'), '文件以换行结尾');
    assert.deepEqual(JSON.parse(written), manifest, '落盘内容可直接解析');
    assert.deepEqual(
      listArtifacts(dir),
      manifest.artifacts,
      '`version.json`、`SHA256SUMS.txt` 与 `.sha256` 不列入产物名',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dev 版本带构建时间戳时原样写入，内容与标签一致', () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'DawnTick-0.2.0.202610192243-dev-android-arm64-v8a.apk'), 'dev\n');
    writeFileSync(join(dir, 'DawnTick-0.2.0.202610192243-dev-android-armeabi-v7a.apk'), 'dev\n');
    writeFileSync(join(dir, 'DawnTick-0.2.0.202610192243-dev-windows-x64-setup.exe'), 'dev\n');
    writeFileSync(join(dir, 'DawnTick-0.2.0.202610192243-dev-windows-x64-portable.zip'), 'dev\n');
    writeFileSync(join(dir, 'DawnTick-0.2.0.202610192243-dev-web.zip'), 'dev\n');
    const manifest = writeVersionJson({
      outDir: dir,
      channel: 'dev',
      version: '0.2.0.202610192243',
      tag: 'dev-latest',
      notes: '渠道 dev · 来源 dev · 提交 b7e140a',
      releasedAt: 1_760_000_000_000,
    });
    assert.equal(manifest.version, '0.2.0.202610192243');
    assert.equal(manifest.tag, 'dev-latest');
    assert.equal(manifest.schema, 2);
    assert.equal(manifest.commit, undefined, '没有 commit 时不写该字段');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('缺任一平台产物时报可读错误，并列出缺哪个', () => {
  const dir = tempDir();
  try {
    seedProducts(dir, { omit: ['windowsPortable', 'android', 'android32', 'web'] });
    assert.throws(() => readPlatformFiles(dir), /缺少发布产物：windowsPortable、android、android32、web/);
    assert.throws(
      () => writeVersionJson({ outDir: dir, channel: CHANNEL, version: VERSION, tag: `v${VERSION}`, notes: '说明' }),
      /缺少发布产物：windowsPortable、android、android32、web/,
    );
    // 只缺 v7 包也要报错：只发一个 ABI 会让 32 位设备更新不可用
    seedProducts(dir, { omit: ['android32'] });
    assert.throws(() => readPlatformFiles(dir), /缺少发布产物：android32/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('渠道 / 版本 / 标签 / 说明缺失或 files 非法时拒绝生成', () => {
  const dir = tempDir();
  try {
    seedProducts(dir);
    const files = readPlatformFiles(dir);
    const base = {
      channel: 'dev',
      version: '0.2.0',
      tag: 'dev-latest',
      notes: '渠道 dev',
      files,
      releasedAt: 1_760_000_000_000,
    };
    assert.throws(() => buildVersionManifest({ ...base, channel: 'nightly' }), /未知渠道/);
    assert.throws(() => buildVersionManifest({ ...base, version: ' ' }), /版本号/);
    assert.throws(() => buildVersionManifest({ ...base, tag: '' }), /标签/);
    assert.throws(() => buildVersionManifest({ ...base, notes: '\n' }), /发布说明/);
    assert.throws(() => buildVersionManifest({ ...base, files: undefined }), /缺少 files/);
    assert.throws(() => buildVersionManifest({ ...base, releasedAt: 0 }), /releasedAt/);
    assert.throws(
      () => buildVersionManifest({ ...base, files: { ...files, android: { ...files.android, sha256: 'xyz' } } }),
      /android 的 sha256 不是 64 位十六进制/,
    );
    assert.throws(
      () => buildVersionManifest({ ...base, files: { ...files, web: { ...files.web, size: '1' } } }),
      /web 的 size 不是有效字节数/,
    );
    assert.throws(
      () => buildVersionManifest({ ...base, files: { ...files, windowsSetup: null } }),
      /缺少发布产物：windowsSetup/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
