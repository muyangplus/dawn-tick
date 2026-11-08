/** 更新检查只判断「有没有新版」，下载与安装由界面触发。 */
/** 首选读 assets 仓库对应渠道分支的 version.json（v2）；GitHub 另保留旧 Releases 解析作为兼容兜底。 */

import {
  DOWNLOAD_SOURCE_LABEL,
  assetsVersionUrl,
  releaseApiUrl,
  type DownloadSource,
} from './lib/download-source.ts';
import { manifestFromAssetsVersion, parseAssetsVersion } from './lib/assets-mirror.ts';
import { errorMessage } from './lib/errors.ts';
import {
  compareVersions,
  isPrereleaseOrDraft,
  isUpdateManifest,
  manifestFromRelease,
  pickBetaCandidate,
} from './lib/update-release.ts';

/** 发布解析（版本比较、资产挑选、beta 候选）在 `lib/update-release.ts`，这里转出保持调用路径不变。 */
export {
  compareVersions,
  isUpdateManifest,
  manifestFromRelease,
  pickBetaCandidate,
} from './lib/update-release.ts';

export type UpdateChannel = 'dev' | 'beta' | 'release';

/** 下载源：与 `lib/download-source.ts` 同一口径，转出方便调用方只 import 本模块。 */
export type UpdateSource = DownloadSource;

const OWNER = 'muyangplus';
const REPO = 'dawn-tick';

/** beta 渠道查发布列表（旧 Releases 兜底）：取最新 beta 预发布与最新正式版里较高者。 */
export const UPDATE_RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`;

/**
 * 各渠道的 version.json 直连地址（旧 GitHub Releases 兜底，只在 assets 清单不可达时用）。
 * beta 的标签带版本号（vX.Y.Z-beta.N），没有可静态取到的固定地址，因此不做直连兜底。
 */
export const UPDATE_FEEDS: Partial<Record<UpdateChannel, string>> = {
  dev: `https://github.com/${OWNER}/${REPO}/releases/download/dev-latest/version.json`,
  release: `https://github.com/${OWNER}/${REPO}/releases/latest/download/version.json`,
};

/** 各渠道的 GitHub 发布接口（旧 Releases 兜底，仅 GitHub 源使用）。 */
export const UPDATE_API_FEEDS: Record<UpdateChannel, string> = {
  dev: `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/dev-latest`,
  beta: UPDATE_RELEASES_API,
  release: `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
};

/** GitHub 接口的 accept：只读公开仓库，不带任何凭据。 */
const GITHUB_API_ACCEPT = 'application/vnd.github+json';

export interface UpdateAsset {
  url: string;
  /** 发布里的原始文件名：在 `SHA256SUMS.txt` 里按它定位摘要（version.json 直连清单可能没有） */
  name?: string;
  size?: number;
  /** 该平台自带签名的校验值：Windows 为 minisign 签名，Android 为 APK 签名摘要 */
  signature?: string;
  /** 清单里直接给出的摘要（assets version.json / 旧 Releases 清单用） */
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
  /** 实际取到清单的下载源：跨源回退后是回退源 */
  source: UpdateSource;
  /** 从首选源回退到另一个源时，记下首选源 */
  fallbackFrom?: UpdateSource;
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

export interface CheckUpdateOptions {
  channel: UpdateChannel;
  receiveBeta: boolean;
  currentVersion: string;
  fetchImpl?: typeof fetch;
  /** 首选下载源；缺省 GitHub，保持既有调用点的行为 */
  source?: UpdateSource;
  /** 首选源失败后是否自动回退另一个源（应用内传 true） */
  fallback?: boolean;
}

/** HTTP 状态 → 可读文案。 */
function describeApiStatus(source: UpdateSource, status: number): string {
  if (status === 404) return '该渠道还没有发布记录';
  if (status === 403 || status === 429) return `${DOWNLOAD_SOURCE_LABEL[source]} 接口限流，请稍后再试`;
  return `更新源返回 ${status}`;
}

function emptyStatus(feed: UpdateChannel, current: string, source: UpdateSource): UpdateStatus {
  return { available: false, error: null, feed, current, latest: null, manifest: null, source };
}

function manifestStatus(status: UpdateStatus, manifest: UpdateManifest, currentVersion: string): UpdateStatus {
  return {
    ...status,
    available: compareVersions(manifest.version, currentVersion) > 0,
    latest: manifest.version,
    manifest,
  };
}

/** 首选：assets 仓库对应渠道分支的 version.json（v2）。 */
interface ManifestAttempt {
  manifest: UpdateManifest | null;
  error: string | null;
  /** 网络/HTTP 失败可退回旧 Releases；清单结构或渠道不对属于配置问题，不兜底 */
  canFallback: boolean;
}

async function queryAssetsVersion(
  feed: UpdateChannel,
  source: UpdateSource,
  doFetch: typeof fetch,
): Promise<ManifestAttempt> {
  const url = assetsVersionUrl(source, feed);
  let response: Response;
  try {
    response = await doFetch(url, { headers: { accept: 'application/json' } });
  } catch (cause: unknown) {
    return { manifest: null, error: errorMessage(cause), canFallback: true };
  }
  if (!response.ok) return { manifest: null, error: describeApiStatus(source, response.status), canFallback: true };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { manifest: null, error: '更新清单格式不正确', canFallback: false };
  }
  const result = parseAssetsVersion(parsed);
  if (!result.ok) return { manifest: null, error: `更新清单格式不正确（${result.error}）`, canFallback: false };
  if (result.manifest.channel !== feed) {
    return {
      manifest: null,
      error: `清单渠道 ${result.manifest.channel} 与查询渠道 ${feed} 不一致，已忽略`,
      canFallback: false,
    };
  }
  return { manifest: manifestFromAssetsVersion(result.manifest, source), error: null, canFallback: false };
}

/** 旧 GitHub Releases 的 version.json 直连兜底；Gitee 不再提供这条链路。 */
function versionJsonUrlOf(feed: UpdateChannel, source: UpdateSource): string | null {
  if (source !== 'github') return null;
  return UPDATE_FEEDS[feed] ?? null;
}

interface SourceAttempt {
  /** 查询成功（包含「无可用更新」）时的状态 */
  status: UpdateStatus | null;
  /** 失败原因 */
  error: string | null;
}

/** 旧 GitHub Releases 兼容兜底：发布接口 → 同源 version.json。 */
async function queryLegacyGitHub(
  feed: UpdateChannel,
  source: UpdateSource,
  currentVersion: string,
  doFetch: typeof fetch,
): Promise<SourceAttempt> {
  const base = emptyStatus(feed, currentVersion, source);
  let networkError: string | null = null;
  try {
    const response = await doFetch(releaseApiUrl(source, feed), { headers: { accept: GITHUB_API_ACCEPT } });
    if (!response.ok) return { status: null, error: describeApiStatus(source, response.status) };
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { status: null, error: '更新清单格式不正确' };
    }
    if (feed === 'beta') {
      const candidate = pickBetaCandidate(parsed);
      if (candidate === null) return { status: null, error: '该渠道还没有发布记录' };
      const manifest = manifestFromRelease(candidate.channel, candidate.record);
      if (manifest === null) return { status: null, error: '更新清单格式不正确' };
      return { status: manifestStatus(base, manifest, currentVersion), error: null };
    }
    if (feed === 'release' && isPrereleaseOrDraft(parsed)) return { status: base, error: null };
    const manifest = manifestFromRelease(feed, parsed);
    if (manifest === null) return { status: null, error: '更新清单格式不正确' };
    return { status: manifestStatus(base, manifest, currentVersion), error: null };
  } catch (cause: unknown) {
    // 网络异常：记住原始原因，下面回退；回退也失败时把它交出去（不吞掉真实原因）
    networkError = errorMessage(cause);
  }

  const fallbackUrl = versionJsonUrlOf(feed, source);
  if (fallbackUrl === null) return { status: null, error: networkError };
  try {
    const response = await doFetch(fallbackUrl, { headers: { accept: 'application/json' } });
    if (!response.ok) return { status: null, error: networkError };
    const parsed: unknown = await response.json();
    if (!isUpdateManifest(parsed)) return { status: null, error: networkError };
    if (parsed.channel !== feed) {
      return { status: null, error: `清单渠道 ${parsed.channel} 与查询渠道 ${feed} 不一致，已忽略` };
    }
    return {
      status: {
        ...base,
        available: compareVersions(parsed.version, currentVersion) > 0,
        latest: parsed.version,
        manifest: parsed,
      },
      error: null,
    };
  } catch {
    return { status: null, error: networkError };
  }
}

/** 只查一个源：assets 的 version.json 优先；GitHub 在它不可达时退回旧 Releases。跨源回退由 `checkForUpdate` 负责。 */
async function querySource(
  feed: UpdateChannel,
  source: UpdateSource,
  currentVersion: string,
  doFetch: typeof fetch,
): Promise<SourceAttempt> {
  const base = emptyStatus(feed, currentVersion, source);
  const attempt = await queryAssetsVersion(feed, source, doFetch);
  if (attempt.manifest !== null) {
    return { status: manifestStatus(base, attempt.manifest, currentVersion), error: null };
  }
  if (source !== 'github' || !attempt.canFallback) return { status: null, error: attempt.error };
  return queryLegacyGitHub(feed, source, currentVersion, doFetch);
}

/** 两个源都失败时把两边原因都交出去，用户能看出是哪一侧不可用。 */
function summarizeFailure(
  requested: UpdateSource,
  firstError: string | null,
  other: UpdateSource,
  secondError: string | null,
): string {
  return `${DOWNLOAD_SOURCE_LABEL[requested]}：${firstError ?? '查询失败'}；${DOWNLOAD_SOURCE_LABEL[other]}：${
    secondError ?? '查询失败'
  }`;
}

/**
 * 检查更新：按选中的下载源查 assets 的 version.json，失败时（`fallback`）自动回退另一个源，并在结果里标明实际源。
 * 跨渠道或降级的清单一律视为无更新（防串版）；两个源都失败时给出两侧原因。
 */
export async function checkForUpdate(options: CheckUpdateOptions): Promise<UpdateStatus> {
  const feed = resolveFeed(options.channel, options.receiveBeta);
  const requested = options.source ?? 'github';
  const base = emptyStatus(feed, options.currentVersion, requested);
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return { ...base, error: '当前环境无法联网检查更新' };

  const first = await querySource(feed, requested, options.currentVersion, doFetch);
  if (first.status !== null) return first.status;
  if (options.fallback !== true) return { ...base, error: first.error };

  const other: UpdateSource = requested === 'github' ? 'gitee' : 'github';
  const second = await querySource(feed, other, options.currentVersion, doFetch);
  if (second.status !== null) return { ...second.status, fallbackFrom: requested };
  return { ...base, error: summarizeFailure(requested, first.error, other, second.error) };
}

/** 各平台自带的合法性验证命令，展示给用户核对。 */
export function verifyHint(channel: UpdateChannel, asset: 'windows' | 'android' | 'web'): string {
  if (asset === 'android') return '安装前系统会校验 APK 签名（apksigner verify --print-certs）';
  if (asset === 'windows') return '更新包随附签名，安装前会校验（gh attestation verify <文件> --repo muyangplus/dawn-tick）';
  return `网页版随渠道 ${channel} 自动获取最新构建`;
}
