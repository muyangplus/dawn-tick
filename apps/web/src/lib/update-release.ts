/** 发布响应 → 更新清单的纯解析：版本比较、资产挑选、beta 候选。单独成文件，`update.ts` 只保留取源逻辑。 */
/**
 * 依赖方向：本模块只 `import type` 更新清单的形状，运行时不反向依赖 `update.ts`；
 * `update.ts` 再转出这些函数，调用方（更新偏好、预设更新、单测）仍从原路径导入。
 */

import type { UpdateAsset, UpdateChannel, UpdateManifest } from '../update.ts';
import { preferredAndroidAbi } from './android-abi.ts';

/** beta 预发布标签与正式版标签。 */
const BETA_RELEASE_TAG = /^v?\d+\.\d+\.\d+-beta(?:\.\d+)?$/;
const STABLE_RELEASE_TAG = /^v?\d+\.\d+\.\d+$/;

/** tag 里能读出的版本：`v0.2.0` / `0.2.0-beta.1`。滚动标签（dev-latest）读不出。 */
const TAG_VERSION = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** 资产名里的版本：`DawnTick-<版本>-<渠道>-<平台>-…`（渠道段是版本段的右边界）。 */
const ASSET_VERSION = /^DawnTick-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(?:dev|beta|release)-/i;

/** 发布说明里的提交号（发布流程写入 `… · 提交 b7e140a`）。 */
const NOTES_COMMIT = /提交 ([0-9a-f]{7,40})/;

/** 发布里的合并校验文件（`sha256sum * > SHA256SUMS.txt`），匹配大小写不敏感的固定名。 */
const CHECKSUMS_ASSET = 'sha256sums.txt';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** 语义化版本比较：a > b 返回正数，相等返回 0。预发布版本小于同号正式版。 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return a.localeCompare(b);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const one = left.prerelease[index];
    const two = right.prerelease[index];
    if (one === undefined) return -1;
    if (two === undefined) return 1;
    if (one === two) continue;
    const oneNumber = Number(one);
    const twoNumber = Number(two);
    const bothNumeric = Number.isFinite(oneNumber) && Number.isFinite(twoNumber);
    if (bothNumeric) return oneNumber - twoNumber;
    if (Number.isFinite(oneNumber)) return -1;
    if (Number.isFinite(twoNumber)) return 1;
    return one.localeCompare(two);
  }
  return 0;
}

export function isUpdateManifest(value: unknown): value is UpdateManifest {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<UpdateManifest>;
  return (
    (row.channel === 'dev' || row.channel === 'beta' || row.channel === 'release') &&
    typeof row.version === 'string' &&
    row.version.length > 0
  );
}

/** `/releases/latest` 拿到预发布或草稿：按「无可用更新」处理，不算失败。 */
export function isPrereleaseOrDraft(value: unknown): boolean {
  const record = asRecord(value);
  return record !== null && (record['prerelease'] === true || record['draft'] === true);
}

/** 版本优先取 tag；滚动标签（dev-latest）取不到，再从资产名取。 */
function versionFromTag(tag: unknown): string | null {
  if (typeof tag !== 'string') return null;
  const matched = TAG_VERSION.exec(tag.trim());
  return matched === null ? null : (matched[1] ?? null);
}

function versionFromAssets(assets: unknown): string | null {
  if (!Array.isArray(assets)) return null;
  for (const raw of assets) {
    const record = asRecord(raw);
    if (record === null) continue;
    const name = record['name'];
    if (typeof name !== 'string') continue;
    const matched = ASSET_VERSION.exec(name.trim());
    if (matched !== null) return matched[1] ?? null;
  }
  return null;
}

/**
 * 发布资产 → 下载项：windows 优先安装包、其次便携包；android 取 APK；web 取静态包。
 * 便携 zip 另存在 `windowsPortable`：安装版与便携版各自选自己的产物。
 * 校验统一走发布里的 `SHA256SUMS.txt`（内含每个产物的摘要），自动更新下载后据此校验。
 */
function assetsFromRelease(
  value: unknown,
): { assets: NonNullable<UpdateManifest['assets']>; checksumsUrl?: string } | undefined {
  if (!Array.isArray(value)) return undefined;
  const available: Array<{ name: string; url: string; size?: number }> = [];
  for (const raw of value) {
    const record = asRecord(raw);
    if (record === null) continue;
    const name = record['name'];
    const url = record['browser_download_url'];
    if (typeof name !== 'string' || typeof url !== 'string' || url === '') continue;
    const size = record['size'];
    available.push(typeof size === 'number' && Number.isFinite(size) ? { name, url, size } : { name, url });
  }
  const pick = (suffix: string): UpdateAsset | undefined => {
    const found = available.find((item) => item.name.toLowerCase().endsWith(suffix));
    if (found === undefined) return undefined;
    return {
      url: found.url,
      name: found.name,
      ...(found.size === undefined ? {} : { size: found.size }),
    };
  };

  const assets: NonNullable<UpdateManifest['assets']> = {};
  const windowsPortable = pick('-windows-x64-portable.zip');
  const windows = pick('-windows-x64-setup.exe') ?? windowsPortable;
  // Android 拆包后旧兜底也要按设备 ABI 选；仍接受拆包前的 `-android.apk` 老资产
  const androidArm64 = pick('-android-arm64-v8a.apk');
  const androidV7 = pick('-android-armeabi-v7a.apk');
  const androidLegacy = pick('-android.apk');
  const android =
    preferredAndroidAbi() === 'armeabi-v7a'
      ? (androidV7 ?? androidArm64 ?? androidLegacy)
      : (androidArm64 ?? androidLegacy ?? androidV7);
  const web = pick('-web.zip');
  if (windows !== undefined) assets.windows = windows;
  if (windowsPortable !== undefined) assets.windowsPortable = windowsPortable;
  if (android !== undefined) assets.android = android;
  if (web !== undefined) assets.web = web;
  if (Object.keys(assets).length === 0) return undefined;
  const checksums = available.find((item) => item.name.toLowerCase() === CHECKSUMS_ASSET);
  return checksums === undefined ? { assets } : { assets, checksumsUrl: checksums.url };
}

/** 把发布响应（GitHub 与 Gitee 同形）转成本模块清单：channel 固定为本次查询的 feed，取不到版本或结构不符返回 null。 */
/** 回滚到正式版也从发布列表里挑目标（`lib/update-preferences.ts`），因此导出这条纯转换。 */
export function manifestFromRelease(feed: UpdateChannel, value: unknown): UpdateManifest | null {
  const record = asRecord(value);
  if (record === null) return null;
  const version = versionFromTag(record['tag_name']) ?? versionFromAssets(record['assets']);
  if (version === null) return null;

  const manifest: UpdateManifest = { channel: feed, version };
  const publishedAt = record['published_at'];
  if (typeof publishedAt === 'string') {
    const releasedAt = Date.parse(publishedAt);
    if (Number.isFinite(releasedAt)) manifest.releasedAt = releasedAt;
  }
  const body = record['body'];
  if (typeof body === 'string') {
    const notes = body.trim();
    manifest.notes = notes;
    const commit = NOTES_COMMIT.exec(notes);
    if (commit !== null && commit[1] !== undefined) manifest.commit = commit[1];
  }
  const parsedAssets = assetsFromRelease(record['assets']);
  if (parsedAssets !== undefined) {
    manifest.assets = parsedAssets.assets;
    if (parsedAssets.checksumsUrl !== undefined) manifest.checksumsUrl = parsedAssets.checksumsUrl;
  }
  return isUpdateManifest(manifest) ? manifest : null;
}

/** 从发布列表挑候选：最新 beta 预发布与最新正式版取版本较高者；草稿、rc 等非 beta 预发布跳过。 */
export function pickBetaCandidate(
  releases: unknown,
): { record: Record<string, unknown>; channel: 'beta' | 'release' } | null {
  if (!Array.isArray(releases)) return null;
  let best: { record: Record<string, unknown>; channel: 'beta' | 'release'; version: string } | null = null;
  for (const raw of releases) {
    const record = asRecord(raw);
    if (record === null || record['draft'] === true) continue;
    const tag = typeof record['tag_name'] === 'string' ? record['tag_name'].trim() : '';
    // beta 预发布允许两种标签：`-beta.<n>`，或者不带序号的纯版本号（发布时选择 plain）
    const isBeta =
      record['prerelease'] === true && (BETA_RELEASE_TAG.test(tag) || STABLE_RELEASE_TAG.test(tag));
    const isStable = STABLE_RELEASE_TAG.test(tag) && record['prerelease'] !== true;
    if (!isBeta && !isStable) continue;
    const version = versionFromTag(tag);
    if (version === null) continue;
    if (best === null || compareVersions(version, best.version) > 0) {
      best = { record, channel: isBeta ? 'beta' : 'release', version };
    }
  }
  return best === null ? null : { record: best.record, channel: best.channel };
}
