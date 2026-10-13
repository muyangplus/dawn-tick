/**
 * 更新检查：只负责「有没有新版」，下载与安装由用户在界面确认后触发。
 *
 * 取源顺序：
 *   1. 首选 `api.github.com` 的发布接口（`UPDATE_API_FEEDS`），版本与说明由 tag、资产名与发布正文推出；
 *   2. 该请求网络异常（fetch 抛错）时回退 `version.json` 直连地址（`UPDATE_FEEDS`）；
 *      HTTP 状态错误不回退：404 / 403 / 429 各自有明确文案。
 * 只访问 github.com / raw.githubusercontent.com / api.github.com，不使用第三方镜像与代理，
 * 也不带 token（公开仓库只读，不读取环境变量里的密钥）。
 *
 * 渠道隔离：每个渠道只查自己那张发布记录，dev 永不看 beta/release。
 * release 用户只有在打开「接收测试版更新」后才会去看 beta 源。
 */

export type UpdateChannel = 'dev' | 'beta' | 'release';

const OWNER = 'muyangplus';
const REPO = 'dawn-tick';

/**
 * 各渠道的 `version.json` 直连地址（回退取源，rolling 标签由发布流程维护）。
 * 发布流程当前只上传安装包，不产出 `version.json` 资产，因此这是发布接口不可达时的兜底。
 */
export const UPDATE_FEEDS: Record<UpdateChannel, string> = {
  dev: `https://github.com/${OWNER}/${REPO}/releases/download/dev-latest/version.json`,
  beta: `https://github.com/${OWNER}/${REPO}/releases/download/beta-latest/version.json`,
  release: `https://github.com/${OWNER}/${REPO}/releases/latest/download/version.json`,
};

/**
 * 各渠道的 GitHub 发布接口地址（**首选**取源）。
 * dev / beta 是滚动标签，release 用 `/releases/latest`（只给非草稿、非预发布的最新正式版）。
 */
export const UPDATE_API_FEEDS: Record<UpdateChannel, string> = {
  dev: `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/dev-latest`,
  beta: `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/beta-latest`,
  release: `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
};

/** GitHub 接口的 accept：只读公开仓库，不带任何凭据。 */
const GITHUB_API_ACCEPT = 'application/vnd.github+json';

export interface UpdateAsset {
  url: string;
  size?: number;
  /** 该平台自带签名的校验值：Windows 为 minisign 签名，Android 为 APK 签名摘要 */
  signature?: string;
  sha256?: string;
}

export interface UpdateManifest {
  channel: UpdateChannel;
  version: string;
  releasedAt?: number;
  commit?: string;
  notes?: string;
  assets?: Partial<Record<'windows' | 'android' | 'web', UpdateAsset>>;
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

/** 版本优先取 tag；滚动标签（dev-latest / beta-latest）取不到，再从资产名取。 */
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

/** 发布资产 → 下载项：windows 优先安装包、其次便携包；android 取 APK；web 取静态包。 */
function assetsFromRelease(value: unknown): UpdateManifest['assets'] {
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
    return found.size === undefined ? { url: found.url } : { url: found.url, size: found.size };
  };

  const assets: NonNullable<UpdateManifest['assets']> = {};
  const windows = pick('-windows-x64-setup.exe') ?? pick('-windows-x64-portable.zip');
  const android = pick('-android.apk');
  const web = pick('-web.zip');
  if (windows !== undefined) assets.windows = windows;
  if (android !== undefined) assets.android = android;
  if (web !== undefined) assets.web = web;
  return Object.keys(assets).length === 0 ? undefined : assets;
}

/**
 * 把 GitHub 发布响应转成本模块的清单。
 * `channel` 固定为本次查询的 feed（`isUpdateManifest` 要求清单与查询渠道一致）；
 * 取不到版本或结构不符时返回 null，由调用方给出「更新清单格式不正确」。
 */
function manifestFromRelease(feed: UpdateChannel, value: unknown): UpdateManifest | null {
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
  const assets = assetsFromRelease(record['assets']);
  if (assets !== undefined) manifest.assets = assets;
  return isUpdateManifest(manifest) ? manifest : null;
}

/**
 * 检查更新。先查 GitHub 发布接口；只有网络异常才回退 `version.json` 直连。
 * 只接受与来源渠道一致、且更新于当前版本的清单；跨渠道或降级一律视为无更新，避免"串版"。
 */
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
    networkError = cause instanceof Error ? cause.message : String(cause);
  }

  // ② 回退：version.json 直连（github.com 资产）。
  try {
    const response = await doFetch(UPDATE_FEEDS[feed], { headers: { accept: 'application/json' } });
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
  if (asset === 'android') return '安装前系统会校验 APK 签名；也可用 apksigner verify --print-certs 核对签名者';
  if (asset === 'windows') return '更新包随附签名，安装前会校验；也可用 gh attestation verify <文件> --repo muyangplus/dawn-tick 核对来源';
  return `网页版随渠道 ${channel} 自动获取最新构建`;
}
