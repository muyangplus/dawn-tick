/** 下载源：国内 Gitee 与国际 GitHub 的镜像地址、延迟探测与自动选择。 */
/**
 * 边界：
 * - 地址表 `MIRRORS` 是唯一事实来源：应用更新、预设更新、可达性探测都从这里拼 URL；
 * - `probeSource` / `resolveDownloadSource` 是纯逻辑 + 注入 fetch 与时钟，单测不碰真实网络；
 * - 自动选择只看「能否完成 version.json 探测」与完成耗时，不做 GeoIP；结果按会话缓存 10 分钟；
 * - Gitee 暂无 Releases 时退化成「仓库可达」探测（`degraded`），下载链路据此回退另一个源。
 */

import type { DownloadSourceChoice } from '@dawn-tick/core';
import { errorMessage } from './errors.ts';
import type { UpdateChannel } from '../update.ts';

/** 具体的一次下载（应用更新与预设更新共用）：不含 auto。 */
export type DownloadSource = 'github' | 'gitee';

/** 界面下拉的候选顺序：国内优先。 */
export const DOWNLOAD_SOURCES: readonly DownloadSource[] = ['gitee', 'github'];

export const DOWNLOAD_SOURCE_LABEL: Record<DownloadSource, string> = {
  gitee: 'Gitee',
  github: 'GitHub',
};

/** 一个镜像仓库的全部地址口径。 */
export interface Mirror {
  /** 应用更新仓库（owner/repo） */
  repo: string;
  /** 预设仓库（owner/repo） */
  presets: string;
  /** 默认分支：预设 raw 与可达性探测用 */
  branch: string;
  /** 发布 API 根（不含 owner/repo）：GitHub 与 Gitee v5 的路径形状一致 */
  api: string;
  /** 站点根：发布页与 release 下载地址 */
  site: string;
  /** raw 文件地址：GitHub 用 raw.githubusercontent.com，Gitee 用 /raw/ 路径 */
  raw: (repo: string, branch: string, path: string) => string;
}

export const MIRRORS: Record<DownloadSource, Mirror> = {
  github: {
    repo: 'muyangplus/dawn-tick',
    presets: 'muyangplus/dawn-tick-presets',
    branch: 'main',
    api: 'https://api.github.com/repos',
    site: 'https://github.com',
    raw: (repo, branch, path) => `https://raw.githubusercontent.com/${repo}/${branch}/${path}`,
  },
  gitee: {
    repo: 'muyangplus/dawn-tick',
    presets: 'muyangplus/dawn-tick-presets',
    branch: 'main',
    api: 'https://gitee.com/api/v5/repos',
    site: 'https://gitee.com',
    raw: (repo, branch, path) => `https://gitee.com/${repo}/raw/${branch}/${path}`,
  },
};

// —— 地址拼接（纯函数） ——

/** 发布列表：beta 渠道取候选时用（`?per_page=30`）。 */
export function releasesApiUrl(source: DownloadSource, perPage = 30): string {
  return `${MIRRORS[source].api}/${MIRRORS[source].repo}/releases?per_page=${perPage}`;
}

/** 各渠道的发布 API：dev 用滚动标签、beta 查列表、release 查 latest。 */
export function releaseApiUrl(source: DownloadSource, feed: UpdateChannel): string {
  const base = `${MIRRORS[source].api}/${MIRRORS[source].repo}/releases`;
  if (feed === 'dev') return `${base}/tags/dev-latest`;
  if (feed === 'release') return `${base}/latest`;
  return releasesApiUrl(source);
}

/** 发布页（「打开发布页」的地址）。 */
export function releasePageUrl(source: DownloadSource): string {
  return `${MIRRORS[source].site}/${MIRRORS[source].repo}/releases`;
}

/** GitHub 的「最新正式版 version.json」直连地址；Gitee 没有等价的 latest 别名，改从资产里找。 */
export function latestVersionJsonUrl(source: DownloadSource): string {
  return `${MIRRORS[source].site}/${MIRRORS[source].repo}/releases/latest/download/version.json`;
}

/** 预设仓库的 version.json：raw 直连。 */
export function presetVersionUrl(source: DownloadSource): string {
  return MIRRORS[source].raw(MIRRORS[source].presets, MIRRORS[source].branch, 'version.json');
}

/** 指定版本的预设快照：raw 直连。 */
export function presetSnapshotUrl(source: DownloadSource, version: string): string {
  return MIRRORS[source].raw(MIRRORS[source].presets, MIRRORS[source].branch, `snapshot/presets-${version}.json`);
}

/** 预设仓库的 contents 接口（raw 失败时的回退；正文是 base64）。 */
export function presetContentsUrl(source: DownloadSource, path: string): string {
  return `${MIRRORS[source].api}/${MIRRORS[source].presets}/contents/${path}`;
}

/** 发布资产里 `version.json` 的下载地址：Gitee 的 release 直连只能从资产里取。 */
export function versionJsonAssetUrl(release: unknown): string | null {
  const record = asRecord(release);
  const assets = record?.['assets'];
  if (!Array.isArray(assets)) return null;
  for (const raw of assets) {
    const asset = asRecord(raw);
    if (asset === null) continue;
    if (String(asset['name'] ?? '').toLowerCase() !== 'version.json') continue;
    const url = asset['browser_download_url'] ?? asset['download_url'];
    if (typeof url === 'string' && url !== '') return url;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

// —— 延迟探测 ——

/** 单次探测的超时：两个源并发，界面最多等这么久。 */
export const PROBE_TIMEOUT_MS = 2500;

export interface ProbeOptions {
  timeoutMs?: number;
  /** 时钟注入：单测用它构造确定性的耗时 */
  now?: () => number;
}

export interface SourceProbe {
  source: DownloadSource;
  /** 是否完成探测（超时、网络错误、HTTP 错误都算失败） */
  ok: boolean;
  /** 完成耗时（毫秒）：失败时也记录，便于界面显示「不可用」 */
  latencyMs: number;
  /** 只确认了仓库可达、没有取到 version.json（Gitee 暂无 Releases） */
  degraded: boolean;
  error: string | null;
  /** 探测用到的最后一个地址（排障用） */
  url: string | null;
}

function hasVersion(value: unknown): boolean {
  const version = asRecord(value)?.['version'];
  return typeof version === 'string' && version.trim() !== '';
}

/** 一次带超时的 JSON 请求：HTTP 非 2xx、解析失败、超时都抛可读错误。 */
async function requestJson(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('探测超时')), Math.max(1, timeoutMs));
  });
  try {
    const response = await Promise.race([
      fetchImpl(url, { headers: { accept: 'application/json' } }),
      timeout,
    ]);
    if (!response.ok) throw new Error(`返回 ${response.status}`);
    return await Promise.race([response.json() as Promise<unknown>, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function describeProbeError(cause: unknown): string {
  const message = errorMessage(cause);
  if (/timeout|超时/i.test(message)) return '探测超时';
  if (/返回 \d+/.test(message)) return message;
  return `无法连接（${message}）`;
}

function remainingOf(deadline: number, now: () => number): number {
  return Math.max(1, deadline - now());
}

/** 可达性探测：raw 优先（快），失败再用 contents API（Gitee raw 在 WebView 里可能被 CORS 拦）。 */
function reachabilityUrls(source: DownloadSource): string[] {
  const mirror = MIRRORS[source];
  return [
    mirror.raw(mirror.repo, mirror.branch, 'package.json'),
    `${mirror.api}/${mirror.repo}/contents/package.json`,
  ];
}

/**
 * 探测一个源：优先请求它的 version.json，拿不到时退化成「仓库可达」并标记 degraded。
 * Gitee 没有 GitHub 的 `releases/latest/download` 别名：先查 `/releases/latest`，再从资产里取 version.json。
 */
export async function probeSource(
  source: DownloadSource,
  fetchImpl: typeof fetch,
  options: ProbeOptions = {},
): Promise<SourceProbe> {
  const now = options.now ?? Date.now;
  const started = now();
  const deadline = started + (options.timeoutMs ?? PROBE_TIMEOUT_MS);
  let lastUrl: string | null = null;
  let lastError = '探测失败';
  const fail = (url: string, cause: unknown): void => {
    lastUrl = url;
    lastError = describeProbeError(cause);
  };
  const done = (ok: boolean, degraded: boolean, url: string | null): SourceProbe => ({
    source,
    ok,
    degraded,
    latencyMs: Math.max(0, now() - started),
    error: ok ? null : lastError,
    url,
  });

  // ① version.json：GitHub 走 latest 别名；Gitee 先查 latest 发布再取 version.json 资产
  if (source === 'github') {
    const url = latestVersionJsonUrl(source);
    try {
      return done(true, !hasVersion(await requestJson(fetchImpl, url, remainingOf(deadline, now))), url);
    } catch (cause: unknown) {
      fail(url, cause);
    }
  } else {
    const apiUrl = releaseApiUrl(source, 'release');
    try {
      const release = await requestJson(fetchImpl, apiUrl, remainingOf(deadline, now));
      const assetUrl = versionJsonAssetUrl(release);
      // 有 Releases 但没有 version.json 资产：可达但清单不全，按降级处理
      if (assetUrl === null) return done(true, true, apiUrl);
      try {
        return done(true, !hasVersion(await requestJson(fetchImpl, assetUrl, remainingOf(deadline, now))), assetUrl);
      } catch (cause: unknown) {
        fail(assetUrl, cause);
      }
    } catch (cause: unknown) {
      fail(apiUrl, cause);
    }
  }

  // ② 退化：仓库可达即视为可尝试（Gitee 目前还没有 Releases）
  for (const url of reachabilityUrls(source)) {
    try {
      await requestJson(fetchImpl, url, remainingOf(deadline, now));
      return done(true, true, url);
    } catch (cause: unknown) {
      fail(url, cause);
    }
  }
  return done(false, false, lastUrl);
}

/** 两个源并发探测；返回顺序固定为 Gitee、GitHub（界面按它展示）。 */
export async function probeAllSources(
  fetchImpl: typeof fetch,
  options: ProbeOptions = {},
): Promise<SourceProbe[]> {
  return Promise.all([
    probeSource('gitee', fetchImpl, options),
    probeSource('github', fetchImpl, options),
  ]);
}

// —— 选择与缓存 ——

/** 自动探测结果按会话缓存 10 分钟；「重新检测」用 fresh 强制刷新。 */
export const DOWNLOAD_SOURCE_CACHE_TTL_MS = 10 * 60_000;

export type SourceReason = 'manual' | 'latency' | 'fallback' | 'default-github';

export interface DownloadSourceResolution {
  preference: DownloadSourceChoice;
  source: DownloadSource;
  reason: SourceReason;
  /** 最近一次探测结果；手动指定且未检测时为空数组 */
  probes: SourceProbe[];
  /** 是否命中会话缓存 */
  cached: boolean;
}

interface CacheEntry {
  at: number;
  resolution: DownloadSourceResolution;
}

let cached: CacheEntry | null = null;

/** 清空会话缓存：单测、冒烟与「重新检测」之外的强制刷新用。 */
export function resetDownloadSourceCache(): void {
  cached = null;
}

function pickSource(probes: readonly SourceProbe[]): { source: DownloadSource; reason: SourceReason } {
  const reachable = probes.filter((probe) => probe.ok);
  if (reachable.length === 0) return { source: 'github', reason: 'default-github' };
  // 有真实 version.json 的源优先：降级的源（暂无 Releases）无法提供应用更新
  const healthy = reachable.filter((probe) => !probe.degraded);
  const pool = healthy.length > 0 ? healthy : reachable;
  const best = pool.reduce((left, right) => (right.latencyMs < left.latencyMs ? right : left));
  return { source: best.source, reason: reachable.length < 2 ? 'fallback' : 'latency' };
}

export interface ResolveOptions extends ProbeOptions {
  /** 跳过缓存，重新并发探测两个源 */
  fresh?: boolean;
}

/**
 * 解析本次要用的下载源：
 * - 手动指定直接返回，不探测；
 * - `auto` 命中 10 分钟缓存时直接复用，否则并发探测、选可达且延迟低的源，都失败回退 GitHub。
 */
export async function resolveDownloadSource(
  preference: DownloadSourceChoice,
  fetchImpl: typeof fetch,
  options: ResolveOptions = {},
): Promise<DownloadSourceResolution> {
  const now = options.now ?? Date.now;
  if (preference !== 'auto') {
    return { preference, source: preference, reason: 'manual', probes: [], cached: false };
  }
  if (options.fresh !== true && cached !== null && now() - cached.at < DOWNLOAD_SOURCE_CACHE_TTL_MS) {
    return { ...cached.resolution, cached: true };
  }
  const probes = await probeAllSources(fetchImpl, options);
  const picked = pickSource(probes);
  const resolution: DownloadSourceResolution = {
    preference,
    source: picked.source,
    reason: picked.reason,
    probes,
    cached: false,
  };
  cached = { at: now(), resolution };
  return resolution;
}

/** 手动指定时「重新检测」得到的组合：源不变，只补上探测结果供界面显示。 */
export function manualResolution(source: DownloadSource, probes: SourceProbe[]): DownloadSourceResolution {
  return { preference: source, source, reason: 'manual', probes, cached: false };
}

// —— 文案（纯函数，界面与冒烟共用） ——

/** 单源探测结果：`Gitee（120ms）` / `GitHub（不可用）`。 */
export function describeProbe(probe: SourceProbe): string {
  const label = DOWNLOAD_SOURCE_LABEL[probe.source];
  if (!probe.ok) return `${label}（不可用）`;
  const latency = Math.max(1, Math.round(probe.latencyMs));
  return `${label}（${latency}ms${probe.degraded ? '，暂无 Releases' : ''}）`;
}

/** 状态行：自动显示两个源与耗时；手动显示当前源（重新检测后追加探测结果）。 */
export function describeSourceLine(resolution: DownloadSourceResolution | null): string {
  if (resolution === null) return '正在探测下载源…';
  const label = DOWNLOAD_SOURCE_LABEL[resolution.source];
  if (resolution.preference !== 'auto') {
    if (resolution.probes.length === 0) return `手动：${label}`;
    return `手动：${label}（探测：${resolution.probes.map(describeProbe).join(' · ')}）`;
  }
  const picked = resolution.probes.find((probe) => probe.source === resolution.source);
  const others = resolution.probes.filter((probe) => probe.source !== resolution.source);
  const parts = [...(picked === undefined ? [] : [picked]), ...others].map(describeProbe);
  const degraded = picked?.degraded === true ? '；该源暂无 Releases，下载时自动回退另一个源' : '';
  return `自动：${parts.join(' · ')}${degraded}`;
}
