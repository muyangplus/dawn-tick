import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VERSION_JSON_FILE, buildVersionManifest, listArtifacts, writeVersionJson } from './version-json.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dawntick-version-json-'));
}

test('version.json 写入渠道、版本、标签、发布说明与产物名', () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'DawnTick-0.2.0-release-windows-x64-setup.exe'), '');
    writeFileSync(join(dir, 'DawnTick-0.2.0-release-web.zip'), '');
    writeFileSync(join(dir, 'DawnTick-0.2.0-release-web.zip.sha256'), 'abc\n');

    const notes = '渠道 release · 来源 main · 提交 4f2a1cd\n\n### 修复\n- 一条\n';
    const manifest = writeVersionJson({
      outDir: dir,
      channel: 'release',
      version: '0.2.0',
      tag: 'v0.2.0',
      notes,
    });

    assert.deepEqual(manifest, {
      channel: 'release',
      version: '0.2.0',
      tag: 'v0.2.0',
      notes: '渠道 release · 来源 main · 提交 4f2a1cd\n\n### 修复\n- 一条',
      artifacts: ['DawnTick-0.2.0-release-web.zip', 'DawnTick-0.2.0-release-windows-x64-setup.exe'],
    });
    const written = readFileSync(join(dir, VERSION_JSON_FILE), 'utf8');
    assert.ok(written.endsWith('\n'), '文件以换行结尾');
    assert.deepEqual(JSON.parse(written), manifest, '落盘内容可直接解析');
    assert.deepEqual(listArtifacts(dir), manifest.artifacts, '`version.json` 与 `.sha256` 不列入产物名');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dev 版本带构建时间戳时原样写入，内容与标签一致', () => {
  const manifest = buildVersionManifest({
    channel: 'dev',
    version: '0.2.0.202610192243',
    tag: 'dev-latest',
    notes: '渠道 dev · 来源 dev · 提交 b7e140a',
    artifacts: ['DawnTick-0.2.0.202610192243-dev-android.apk'],
  });
  assert.equal(manifest.version, '0.2.0.202610192243');
  assert.equal(manifest.tag, 'dev-latest');
});

test('渠道 / 版本 / 标签 / 说明缺失时拒绝生成', () => {
  const base = { channel: 'dev', version: '0.2.0', tag: 'dev-latest', notes: '渠道 dev' };
  assert.throws(() => buildVersionManifest({ ...base, channel: 'nightly' }), /未知渠道/);
  assert.throws(() => buildVersionManifest({ ...base, version: ' ' }), /版本号/);
  assert.throws(() => buildVersionManifest({ ...base, tag: '' }), /标签/);
  assert.throws(() => buildVersionManifest({ ...base, notes: '\n' }), /发布说明/);
});
