import test from 'node:test';
import assert from 'node:assert/strict';
import type { Storage } from '@dawn-tick/core';
import { UPDATE_RELEASES_API } from '../src/update.ts';
import { IGNORED_UPDATE_VERSION_META_KEY } from '../src/lib/meta-keys.ts';
import {
  canRollbackToStable,
  clearIgnoredVersion,
  isIgnoredVersion,
  loadRollbackReleases,
  pickRollbackTarget,
  readIgnoredVersion,
  shouldPrompt,
  writeIgnoredVersion,
} from '../src/lib/update-preferences.ts';

type MetaStore = Pick<Storage, 'readMeta' | 'writeMeta'> & { rows: Map<string, string> };

/** 最小 app_meta 存储桩：只实现 readMeta / writeMeta。 */
function memoryStorage(initial: Record<string, string> = {}): MetaStore {
  const rows = new Map<string, string>(Object.entries(initial));
  return {
    rows,
    readMeta: async (key) => rows.get(key),
    writeMeta: async (key, value) => {
      rows.set(key, value);
    },
  };
}

/** 一条 GitHub 发布记录：正式版标签 + 资产名与发布流程一致（`DawnTick-<版本>-<渠道>-…`）。 */
function release(
  version: string,
  assets: Array<{ name: string; url: string; size?: number }>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tag_name: `v${version}`,
    prerelease: false,
    draft: false,
    published_at: '2026-10-01T00:00:00Z',
    assets: assets.map((asset) => ({
      name: asset.name,
      browser_download_url: asset.url,
      size: asset.size ?? 100,
    })),
    ...extra,
  };
}

function windowsInstaller(version: string) {
  return [
    {
      name: `DawnTick-${version}-release-windows-x64-setup.exe`,
      url: `https://example.com/DawnTick-${version}-release-windows-x64-setup.exe`,
    },
    {
      name: `DawnTick-${version}-release-windows-x64-setup.exe.sha256`,
      url: `https://example.com/DawnTick-${version}-release-windows-x64-setup.exe.sha256`,
    },
  ];
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

test('忽略版本：写入、读取与取消忽略都走同一个 app_meta 键', async () => {
  const storage = memoryStorage();
  assert.equal(await readIgnoredVersion(storage), null, '默认没有忽略任何版本');

  await writeIgnoredVersion(storage, ' 0.5.0 ');
  assert.equal(await readIgnoredVersion(storage), '0.5.0', '写入时去掉首尾空白');
  assert.equal(storage.rows.has(IGNORED_UPDATE_VERSION_META_KEY), true);

  await clearIgnoredVersion(storage);
  assert.equal(await readIgnoredVersion(storage), null, '取消忽略后回到没有记录');
});

test('忽略版本：记录损坏或不是字符串时按没有忽略处理', async () => {
  const broken = memoryStorage({ [IGNORED_UPDATE_VERSION_META_KEY]: '{ 不是 JSON' });
  assert.equal(await readIgnoredVersion(broken), null);

  const wrongShape = memoryStorage({ [IGNORED_UPDATE_VERSION_META_KEY]: '42' });
  assert.equal(await readIgnoredVersion(wrongShape), null);

  const empty = memoryStorage({ [IGNORED_UPDATE_VERSION_META_KEY]: '  ' });
  assert.equal(await readIgnoredVersion(empty), null);
});

test('shouldPrompt：忽略只压制被忽略的那个版本', () => {
  assert.equal(shouldPrompt({ remote: '0.5.0', current: '0.4.1', ignored: '0.5.0' }), false, '同版本被忽略');
  assert.equal(shouldPrompt({ remote: '0.5.1', current: '0.4.1', ignored: '0.5.0' }), true, '更高的版本照常提示');
  assert.equal(shouldPrompt({ remote: 'v0.5.0', current: '0.4.1', ignored: '0.5.0' }), false, 'v 前缀视为同一版本');
  assert.equal(shouldPrompt({ remote: '0.5.0', current: '0.4.1', ignored: null }), true, '没有忽略时正常提示');
  assert.equal(shouldPrompt({ remote: '0.5.0', current: '0.5.0', ignored: null }), false, '同版本不算新版本');
  assert.equal(shouldPrompt({ remote: '0.4.0', current: '0.5.0', ignored: null }), false, '更低版本不提示');
  assert.equal(shouldPrompt({ remote: null, current: '0.5.0', ignored: null }), false, '没查到版本不提示');
});

test('isIgnoredVersion：版本比较容忍 v 前缀与空白', () => {
  assert.equal(isIgnoredVersion('v0.5.0', ' 0.5.0'), true);
  assert.equal(isIgnoredVersion('0.5.1', '0.5.0'), false);
  assert.equal(isIgnoredVersion(null, '0.5.0'), false);
  assert.equal(isIgnoredVersion('0.5.0', null), false);
});

test('pickRollbackTarget：挑最新正式版，跳过预发布', () => {
  const releases = [
    release('0.6.0', windowsInstaller('0.6.0'), { tag_name: 'v0.6.0-beta.1', prerelease: true }),
    release('0.5.0', windowsInstaller('0.5.0')),
    release('0.4.0', windowsInstaller('0.4.0')),
  ];
  const target = pickRollbackTarget(releases, 'windows');
  assert.equal(target.kind, 'target');
  if (target.kind !== 'target') return;
  assert.equal(target.version, '0.5.0', '预发布不参与回滚');
  assert.ok(target.manifest.assets?.windows?.checksumUrl?.endsWith('.sha256'), '保留校验文件地址');
});

test('pickRollbackTarget：没有正式版时给出可读原因', () => {
  const releases = [release('0.6.0', windowsInstaller('0.6.0'), { tag_name: 'v0.6.0-beta.1', prerelease: true })];
  const target = pickRollbackTarget(releases, 'windows');
  assert.equal(target.kind, 'none');
  if (target.kind !== 'none') return;
  assert.match(target.reason, /还没有正式版发布/);

  const notAList = pickRollbackTarget(null, 'windows');
  assert.equal(notAList.kind, 'none');
  if (notAList.kind === 'none') assert.match(notAList.reason, /读不到正式版/);
});

test('pickRollbackTarget：只有便携包时不能自动回滚', () => {
  const releases = [
    release('0.5.0', [
      {
        name: 'DawnTick-0.5.0-release-windows-x64-portable.zip',
        url: 'https://example.com/DawnTick-0.5.0-release-windows-x64-portable.zip',
      },
    ]),
  ];
  const target = pickRollbackTarget(releases, 'windows');
  assert.equal(target.kind, 'none');
  if (target.kind === 'none') assert.match(target.reason, /便携版/);
});

test('pickRollbackTarget：Android 取 APK', () => {
  const releases = [
    release('0.5.0', [
      {
        name: 'DawnTick-0.5.0-release-android.apk',
        url: 'https://example.com/DawnTick-0.5.0-release-android.apk',
      },
    ]),
  ];
  const target = pickRollbackTarget(releases, 'android');
  assert.equal(target.kind, 'target');
  if (target.kind === 'target') assert.ok(target.manifest.assets?.android?.url.endsWith('.apk'));
});

test('canRollbackToStable：当前已是最新正式版时不给入口', () => {
  assert.equal(canRollbackToStable({ current: '0.5.0', channel: 'release', latestStable: '0.5.0' }), false);
  assert.equal(canRollbackToStable({ current: '0.6.0', channel: 'release', latestStable: '0.5.0' }), true);
  assert.equal(canRollbackToStable({ current: '0.4.1', channel: 'release', latestStable: '0.5.0' }), false);
  assert.equal(canRollbackToStable({ current: '0.5.0', channel: 'release', latestStable: null }), false, '还没查到');
  assert.equal(canRollbackToStable({ current: '0.5.0', channel: 'beta', latestStable: null }), true);
  assert.equal(canRollbackToStable({ current: '0.5.0', channel: 'dev', latestStable: null }), true);
});

test('loadRollbackReleases：状态码换成可读原因', async () => {
  const seen: string[] = [];
  const ok = await loadRollbackReleases(async (input) => {
    seen.push(String(input));
    return jsonResponse([release('0.5.0', windowsInstaller('0.5.0'))]);
  });
  assert.equal(seen[0], UPDATE_RELEASES_API, '查的是发布列表接口');
  assert.ok(Array.isArray(ok));

  await assert.rejects(
    loadRollbackReleases(async () => jsonResponse({}, false, 429)),
    /GitHub 接口限流/,
  );
  await assert.rejects(
    loadRollbackReleases(async () => jsonResponse({}, false, 500)),
    /更新源返回 500/,
  );
});
