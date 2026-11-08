/**
 * 下载源选择：10 分钟会话缓存、自动挑快、手动指定与界面文案。
 *
 * 与探测分离：本模块只消费 `probeAllSources` 的结果，单测可用假探测数组，
 * 不重复实现网络逻辑。
 */

import type { DownloadSourceChoice } from '@dawn-tick/core';
import { DOWNLOAD_SOURCE_LABEL, type DownloadSource } from './download-source.ts';
import { probeAllSources, type ProbeOptions, type SourceProbe } from './download-probe.ts';

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
  feed: string;
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
  // 有真实 version.json 的源优先：降级的源（镜像还没同步）无法提供完整更新
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
  const feed = options.feed ?? 'release';
  if (
    options.fresh !== true &&
    cached !== null &&
    cached.feed === feed &&
    now() - cached.at < DOWNLOAD_SOURCE_CACHE_TTL_MS
  ) {
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
  cached = { at: now(), feed, resolution };
  return resolution;
}

/** 手动指定时「重新检测」得到的组合：源不变，只补上探测结果供界面显示。 */
export function manualResolution(source: DownloadSource, probes: SourceProbe[]): DownloadSourceResolution {
  return { preference: source, source, reason: 'manual', probes, cached: false };
}

// —— 文案（纯函数，界面与冒烟共用） ——

/** 单源探测结果：`Gitee（120ms / 256KB）` / `GitHub（不可用）`。 */
export function describeProbe(probe: SourceProbe): string {
  const label = DOWNLOAD_SOURCE_LABEL[probe.source];
  if (!probe.ok) return `${label}（不可用）`;
  const latency = Math.max(1, Math.round(probe.latencyMs));
  const bytes = probe.kind === 'asset' && probe.bytes !== undefined ? ` / ${Math.round(probe.bytes / 1024)}KB` : '';
  return `${label}（${latency}ms${bytes}${probe.degraded ? '，镜像未同步' : ''}）`;
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
  const degraded = picked?.degraded === true ? '；该源镜像未同步，下载时自动回退另一个源' : '';
  return `自动：${parts.join(' · ')}${degraded}`;
}
