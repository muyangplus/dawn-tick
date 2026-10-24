/** 更新检查只判断「有没有新版」，下载与安装由界面触发。 */
/** 只有 fetch 抛错才从 UPDATE_API_FEEDS 回退 UPDATE_FEEDS，HTTP 状态错误不回退。 */

import { errorMessage } from './lib/errors.ts';

export type UpdateChannel = 'dev' | 'beta' | 'release';

const OWNER = 'muyangplus';
const REPO = 'dawn-tick';

/** beta 渠道查发布列表：取最新 beta 预发布与最新正式版里较高者。 */
/** 正式版发布后，beta 用户直接更到正式版。 */
export const UPDATE_RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`;

/**
 * 各渠道的 version.json 直连地址（发布标签由发布流程维护），仅发布接口不可达时兜底。
 * beta 的标签带版本号（vX.Y.Z-beta.N），没有可静态取到的固定地址，因此不做直连兜底。
 */
export const UPDATE_FEEDS: Partial<Record<UpdateChannel, string>> = {
  dev: `https://github.com/${OWNER}/${REPO}/releases/download/dev-latest/version.json`,
  release: `https://github.com/${OWNER}/${REPO}/releases/latest/download/version.json`,
};

/** 各渠道的 GitHub 发布接口地址（首选取源）：dev 用滚动标签，beta 查发布列表，release 用 /releases/latest。 */
export const UPDATE_API_FEEDS: Record<UpdateChannel, string> = {
  dev: `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/dev-latest`,
  beta: UPDATE_RELEASES_API,
  release: `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
};

/** beta 预发布标签与正式版标签。 */
const BETA_RELEASE_TAG = /^v?\d+\.\d+\.\d+-beta\.\d+$/;
const STABLE_RELEASE_TAG = /^v?\d+\.\d+\.\d+$/;

/** GitHub 接口的 accept：只读公开仓库，不带任何凭据。 */
const GITHUB_API_ACCEPT = 'application/vnd.github+json';

export interface UpdateAsset {
  url: string;
  /** 发布里的原始文件名：在 `SHA256SUMS.txt` 里按它定位摘要（version.json 直连清单可能没有） */
  name?: string;
  size?: number;
  /** 该平台自带签名的校验值：Windows 为 minisign 签名，Android 为 APK 签名摘要 */
  signature?: string;
  /** 清单里直接给出的摘要（version.json 等直连清单用） */
  sha256?: string;
}

export interface UpdateManifest {
  channel: UpdateChannel;
  version: string;
  releasedAt?: number;
  commit?: string;
  notes?: string;
  /**
   * 各平台产物。`windows` 是当前安装方式的首选产物（有安装包时优先安装包），
   * `windowsPortable` 单独保留便携 zip：便携版自动更新要用 zip 覆盖 exe，不能被安装包挤掉。
   */
  assets?: Partial<Record<'windows' | 'windowsPortable' | 'android' | 'web', UpdateAsset>>;
  /** 发布里 `SHA256SUMS.txt` 的地址（`sha256sum` 文本，一行一个产物） */
  checksumsUrl?: string;
}

export interface UpdateStatus {
  /** 是否有可用更新（含渠道允许的最新版） */
  available: boolean;
  /** 拉取失败时的原因，成功时为 null */
  error: string | null;
  /** 实际查询的渠道 */
  feed: UpdateChannel;
  current: string;
  latest: string | null;
  manifest: UpdateManifest | null;
}

/**
 * 提示里展示的渠道 = 这版发布本身的渠道：beta 预发布显示测试版，正式版显示正式版。
 * 不能拿「接收测试版」开关或查询源推断——开关打开后查到更高的正式版时，仍应显示正式版。
 */
export function releaseChannelOf(status: Pick<UpdateStatus, 'feed' | 'manifest'>): UpdateChannel {
  return status.manifest?.channel ?? status.feed;
}

/** 指定渠道下用户应该查询哪个源。 */
export function resolveFeed(channel: UpdateChannel, receiveBeta: boolean): UpdateChannel {
  if (channel === 'dev') return 'dev';
  if (channel === 'beta') return receiveBeta ? 'beta' : 'release';
  return receiveBeta ? 'beta' : 'release';
}

/** 未显式设置时，「接收测试版更新」的默认值：beta 渠道默认开，其余默认关。 */
export function defaultReceiveBeta(channel: UpdateChannel): boolean {
  return channel === 'beta';
}

export function resolveReceiveBeta(stored: boolean | null, channel: UpdateChannel): boolean {
  return stored === null ? defaultReceiveBeta(channel) : stored;
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

export interface CheckUpdateOptions {
  channel: UpdateChannel;
  receiveBeta: boolean;
  currentVersion: string;
  fetchImpl?: typeof fetch;
}

/** tag 里能读出的版本：`v0.2.0` / `0.2.0-beta.1`。滚动标签（dev-latest）读不出。 */
const TAG_VERSION = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** 资产名里的版本：`DawnTick-<版本>-<渠道>-<平台>-…`（渠道段是版本段的右边界）。 */
const ASSET_VERSION = /^DawnTick-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(?:dev|beta|release)-/i;

/** 发布说明里的提交号（发布流程写入 `… · 提交 b7e140a`）。 */
const NOTES_COMMIT = /提交 ([0-9a-f]{7,40})/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** HTTP 状态 → 可读文案。 */
function describeApiStatus(status: number): string {
  if (status === 404) return '该渠道还没有发布记录';
  if (status === 403 || status === 429) return 'GitHub 接口限流，请稍后再试';
  return `更新源返回 ${status}`;
}

/** `/releases/latest` 拿到预发布或草稿：按「无可用更新」处理，不算失败。 */
function isPrereleaseOrDraft(value: unknown): boolean {
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

/** 发布里的合并校验文件（`sha256sum * > SHA256SUMS.txt`），匹配大小写不敏感的固定名。 */
const CHECKSUMS_ASSET = 'sha256sums.txt';

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
  const android = pick('-android.apk');
  const web = pick('-web.zip');
  if (windows !== undefined) assets.windows = windows;
  if (windowsPortable !== undefined) assets.windowsPortable = windowsPortable;
  if (android !== undefined) assets.android = android;
  if (web !== undefined) assets.web = web;
  if (Object.keys(assets).length === 0) return undefined;
  const checksums = available.find((item) => item.name.toLowerCase() === CHECKSUMS_ASSET);
  return checksums === undefined ? { assets } : { assets, checksumsUrl: checksums.url };
}

/** 把 GitHub 发布响应转成本模块清单：channel 固定为本次查询的 feed，取不到版本或结构不符时返回 null。 */
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

/** 先查 GitHub 发布接口，只有网络异常才回退 version.json 直连。 */
/** 跨渠道或降级的清单一律视为无更新（防串版）。 */
export async function checkForUpdate(options: CheckUpdateOptions): Promise<UpdateStatus> {
  const feed = resolveFeed(options.channel, options.receiveBeta);
  const base: UpdateStatus = {
    available: false,
    error: null,
    feed,
    current: options.currentVersion,
    latest: null,
    manifest: null,
  };
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return { ...base, error: '当前环境无法联网检查更新' };

  // ① 首选：GitHub 发布接口。状态错误与格式错误就地给文案，不回退。
  let networkError: string | null = null;
  try {
    const response = await doFetch(UPDATE_API_FEEDS[feed], { headers: { accept: GITHUB_API_ACCEPT } });
    if (!response.ok) return { ...base, error: describeApiStatus(response.status) };
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { ...base, error: '更新清单格式不正确' };
    }
    if (feed === 'beta') {
      const candidate = pickBetaCandidate(parsed);
      if (candidate === null) return { ...base, error: '该渠道还没有发布记录' };
      const manifest = manifestFromRelease(candidate.channel, candidate.record);
      if (manifest === null) return { ...base, error: '更新清单格式不正确' };
      return {
        ...base,
        available: compareVersions(manifest.version, options.currentVersion) > 0,
        latest: manifest.version,
        manifest,
      };
    }
    if (feed === 'release' && isPrereleaseOrDraft(parsed)) return base;
    const manifest = manifestFromRelease(feed, parsed);
    if (manifest === null) return { ...base, error: '更新清单格式不正确' };
    return {
      ...base,
      available: compareVersions(manifest.version, options.currentVersion) > 0,
      latest: manifest.version,
      manifest,
    };
  } catch (cause: unknown) {
    // 网络异常：记住原始原因，下面回退；回退也失败时把它交出去（不吞掉真实原因）
    networkError = errorMessage(cause);
  }

  // ② 回退：version.json 直连（github.com 资产）。beta 没有固定直连地址，直接交回原始网络错误。
  const fallbackUrl = UPDATE_FEEDS[feed];
  if (fallbackUrl === undefined) return { ...base, error: networkError };
  try {
    const response = await doFetch(fallbackUrl, { headers: { accept: 'application/json' } });
    if (!response.ok) return { ...base, error: networkError };
    const parsed: unknown = await response.json();
    if (!isUpdateManifest(parsed)) return { ...base, error: networkError };
    if (parsed.channel !== feed) {
      return { ...base, error: `清单渠道 ${parsed.channel} 与查询渠道 ${feed} 不一致，已忽略` };
    }
    const newer = compareVersions(parsed.version, options.currentVersion) > 0;
    return {
      ...base,
      available: newer,
      latest: parsed.version,
      manifest: parsed,
    };
  } catch {
    return { ...base, error: networkError };
  }
}

/** 各平台自带的合法性验证命令，展示给用户核对。 */
export function verifyHint(channel: UpdateChannel, asset: 'windows' | 'android' | 'web'): string {
  if (asset === 'android') return '安装前系统会校验 APK 签名（apksigner verify --print-certs）';
  if (asset === 'windows') return '更新包随附签名，安装前会校验（gh attestation verify <文件> --repo muyangplus/dawn-tick）';
  return `网页版随渠道 ${channel} 自动获取最新构建`;
}
