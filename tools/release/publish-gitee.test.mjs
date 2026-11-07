import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSET_SUFFIXES, planGiteeRelease, planPrune, selectAssets } from './publish-gitee.mjs';

test('planGiteeRelease：滚动渠道重建，正式/测试版更新同一发布', () => {
  assert.equal(planGiteeRelease({ rolling: true }), 'recreate');
  assert.equal(planGiteeRelease({ rolling: false }), 'upsert');
});

test('selectAssets：只挑发布产物与校验清单', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitee-assets-'));
  mkdirSync(join(dir, 'nested'));
  for (const name of [
    'DawnTick-0.6.5-beta-windows-x64-setup.exe',
    'DawnTick-0.6.5-beta-windows-x64-portable.zip',
    'DawnTick-0.6.5-beta-android.apk',
    'DawnTick-0.6.5-beta-web.zip',
    'SHA256SUMS.txt',
    'version.json',
    'notes.md',
    'DawnTick-0.6.5-beta-windows-x64-setup.exe.sha256',
  ]) {
    writeFileSync(join(dir, name), 'x');
  }
  const names = selectAssets(dir).map((item) => item.name);
  assert.deepEqual(names, [
    'DawnTick-0.6.5-beta-android.apk',
    'DawnTick-0.6.5-beta-web.zip',
    'DawnTick-0.6.5-beta-windows-x64-portable.zip',
    'DawnTick-0.6.5-beta-windows-x64-setup.exe',
    'SHA256SUMS.txt',
    'version.json',
  ]);
  for (const suffix of ASSET_SUFFIXES) assert.ok(names.some((name) => name.endsWith(suffix)), suffix);
});

test('planPrune：保留最近 N 个与 dev-latest，容量超限删最旧', () => {
  const releases = [
    { tag: 'v0.6.1', createdAt: 1, bytes: 100 },
    { tag: 'v0.6.2', createdAt: 2, bytes: 100 },
    { tag: 'v0.6.3', createdAt: 3, bytes: 100 },
    { tag: 'dev-latest', createdAt: 4, bytes: 100 },
    { tag: 'v0.6.4', createdAt: 5, bytes: 100 },
  ];
  const plan = planPrune({
    releases,
    incomingBytes: 250,
    maxBytes: 600,
    keepTags: ['v0.6.5'],
    keepRecent: 2,
  });
  // 受保护：v0.6.5、dev-latest；最近 2 个：v0.6.4、dev-latest；其余按最旧删到容量达标
  assert.ok(!plan.remove.includes('dev-latest'));
  assert.ok(!plan.remove.includes('v0.6.4'));
  assert.ok(plan.remove.includes('v0.6.1'));
  assert.equal(plan.keptBytes <= 600, true);
});

test('planPrune：容量足够时不删任何发布', () => {
  const releases = [
    { tag: 'v1.0.0', createdAt: 2, bytes: 100 },
    { tag: 'v0.9.0', createdAt: 1, bytes: 100 },
  ];
  const plan = planPrune({ releases, incomingBytes: 100, maxBytes: 10_000, keepTags: ['v1.1.0'], keepRecent: 5 });
  assert.deepEqual(plan.remove, []);
});
