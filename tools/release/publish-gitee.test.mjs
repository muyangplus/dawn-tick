import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSET_SUFFIXES, channelOfTag, planGiteeRelease, planPrune, selectAssets } from './publish-gitee.mjs';

test('planGiteeRelease：滚动渠道重建，正式/测试版更新同一发布', () => {
  assert.equal(planGiteeRelease({ rolling: true }), 'recreate');
  assert.equal(planGiteeRelease({ rolling: false }), 'upsert');
});

test('channelOfTag：dev-latest → dev，带 -beta 的标签 → beta，其余 → release', () => {
  assert.equal(channelOfTag('dev-latest'), 'dev');
  assert.equal(channelOfTag('v0.6.6-beta'), 'beta');
  assert.equal(channelOfTag('v0.6.6-beta.1'), 'beta');
  assert.equal(channelOfTag('v0.6.6'), 'release');
  assert.equal(channelOfTag('v0.6.6.202611072300'), 'release');
  assert.equal(channelOfTag('dev-202601010000'), 'release', '历史上只有 dev-latest，没有别的 dev 标签');
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

test('planPrune：release / beta 各保留最近 8 个 + dev-latest', () => {
  const releases = [];
  for (let index = 1; index <= 10; index += 1) {
    releases.push({ tag: `v0.${index}.0`, createdAt: index, bytes: 100 });
  }
  for (let index = 1; index <= 10; index += 1) {
    releases.push({ tag: `v0.${index}.0-beta.${index}`, createdAt: 100 + index, bytes: 100 });
  }
  releases.push({ tag: 'dev-latest', createdAt: 200, bytes: 100 });

  const plan = planPrune({
    releases,
    incomingBytes: 100,
    maxBytes: 1_800,
    keepTags: ['v0.10.0'],
  });
  // release：v0.10.0 受保护，再保留 v0.9.0 … v0.2.0（各渠道最近 8 个 + 当前标签），v0.1.0 可删
  assert.ok(!plan.remove.includes('v0.10.0'));
  assert.ok(!plan.remove.includes('v0.9.0'));
  assert.ok(!plan.remove.includes('v0.2.0'));
  assert.ok(plan.remove.includes('v0.1.0'));
  // beta：最近 8 个（-beta.3 … -beta.10），前两个可删
  assert.ok(!plan.remove.includes('v0.10.0-beta.10'));
  assert.ok(!plan.remove.includes('v0.3.0-beta.3'));
  assert.ok(plan.remove.includes('v0.1.0-beta.1'));
  assert.ok(plan.remove.includes('v0.2.0-beta.2'));
  // 滚动标签 dev-latest 永不删除
  assert.ok(!plan.remove.includes('dev-latest'));
});

test('planPrune：默认每个渠道保留最近 8 个', () => {
  const releases = Array.from({ length: 10 }, (_, index) => ({
    tag: `v0.${index + 1}.0`,
    createdAt: index + 1,
    bytes: 100,
  }));
  const plan = planPrune({ releases, incomingBytes: 0, maxBytes: 850 });
  assert.deepEqual(plan.remove, ['v0.1.0', 'v0.2.0']);
});

test('planPrune：容量超限时继续删最旧，保留策略内的也优先删更旧的', () => {
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
    keepPerChannel: 2,
  });
  // 受保护：v0.6.5、dev-latest；release 最近 2 个：v0.6.4、v0.6.3；其余按最旧删到容量达标
  assert.ok(!plan.remove.includes('dev-latest'));
  assert.ok(!plan.remove.includes('v0.6.4'));
  assert.ok(plan.remove.includes('v0.6.1'));
  assert.equal(plan.keptBytes <= 600, true);
});

test('planPrune：容量足够时不删任何发布', () => {
  const releases = [
    { tag: 'v1.0.0', createdAt: 2, bytes: 100 },
    { tag: 'v0.9.0', createdAt: 1, bytes: 100 },
    { tag: 'v0.8.0-beta.1', createdAt: 3, bytes: 100 },
  ];
  const plan = planPrune({ releases, incomingBytes: 100, maxBytes: 10_000, keepTags: ['v1.1.0'], keepPerChannel: 5 });
  assert.deepEqual(plan.remove, []);
});
