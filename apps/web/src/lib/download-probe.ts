/**
 * 下载源探测：mirror.json（小 JSON）+ 便携包 256KB 分块测速。
 *
 * 为什么改成 assets 仓库：客户端下载与校验都走独立产物仓库的 raw 地址，
 * 探测也必须打同一条链路，否则「探测很快、下载很慢」会选错源。
 *
 * 边界：
 * - 纯逻辑 + 注入 fetch 与时钟，单测不碰真实网络；
 * - 先读渠道分支的 mirror.json，再用其中便携包的绝对 URL 读 256KB 并计时；
 * - mirror.json 缺失/未同步时退化成「仓库可达」并标记 degraded，选择逻辑会优先另一个源。
 */

import type { MirrorFile, MirrorFiles } from './assets-mirror.ts';
import { assetsFileUrl, assetsMirrorUrl, parseAssetsMirror } from './assets-mirror.ts';
import { MIRRORS, type DownloadSource } from './download-source.ts';
import { errorMessage } from './errors.ts';

/** 单次探测的超时：两个源并发，界面最多等这么久。 */
export const PROBE_TIMEOUT_MS = 2500;

/** 资产探测读取的字节数：mirror.json 太小，改成从真实安装包里读 256KB 再计时。 */
export const PROBE_ASSET_BYTES = 256 * 1024;

/** 探测用哪个渠道分支：正式版分支最稳定、一定先有产物。 */
export const PROBE_FEED = 'release' as const;

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
  /** 只确认了仓库可达、没有取到 mirror.json（Gitee 镜像还没同步） */
  degraded: boolean;
  error: string | null;
  /** 探测用到的最后一个地址（排障用） */
  url: string | null;
  /** 探测方式：真实资产分块下载 > 仓库可达性（旧版还有 version.json） */
  kind?: 'asset' | 'version' | 'reachability';
  /** 资产探测实际读到的字节数（用于显示 256KB） */
  bytes?: number;
}

export interface AssetProbeResult {
  ok: boolean;
  latencyMs: number;
  bytes: number;
  error: string | null;
}

/** 从 mirror.json 的文件表里挑探测包：便携 zip > apk > web > 安装程序。 */
export function pickProbeFile(files: MirrorFiles): MirrorFile | null {
  return files.windowsPortable ?? files.android ?? files.web ?? files.windowsSetup ?? null;
}

/**
 * 从真实资产地址读一小段（默认 256KB）并计时：比 JSON 探测更能反映下载速度。
 *
 * - 用 Range 只要前 N 字节；服务端忽略 Range（200 全量）时读到 N 字节就主动取消；
 * - 时钟与 fetch 可注入，单测用假流构造确定性结果。
 */
export async function probeAssetChunk(
  url: string,
  fetchImpl: typeof fetch,
  options: ProbeOptions & { maxBytes?: number } = {},
): Promise<AssetProbeResult> {
  const now = options.now ?? Date.now;
  const maxBytes = options.maxBytes ?? PROBE_ASSET_BYTES;
  const started = now();
  const timerMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('探测超时'));
    }, Math.max(1, timerMs));
  });
  try {
    const response = await Promise.race([
      fetchImpl(url, {
        headers: { range: `bytes=0-${Math.max(0, maxBytes - 1)}` },
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (!response.ok) throw new Error(`返回 ${response.status}`);
    let bytes = 0;
    const reader = response.body?.getReader();
    if (reader === undefined) {
      const buffer = await Promise.race([response.arrayBuffer(), timeout]);
      bytes = Math.min(buffer.byteLength, maxBytes);
    } else {
      while (bytes < maxBytes) {
        const { done, value } = await Promise.race([reader.read(), timeout]);
        if (done) break;
        bytes += value.byteLength;
        if (bytes >= maxBytes) {
          void reader.cancel().catch(() => {});
          break;
        }
      }
    }
    if (bytes <= 0) throw new Error('没有读到数据');
    return { ok: true, latencyMs: Math.max(1, now() - started), bytes, error: null };
  } catch (cause: unknown) {
    const message = errorMessage(cause);
    return {
      ok: false,
      latencyMs: Math.max(0, now() - started),
      bytes: 0,
      error: /abort|timeout|超时/i.test(message) ? '探测超时' : describeProbeError(cause),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
 * 探测一个源：请求渠道分支的 mirror.json，再用其中便携包装载 256KB。
 * mirror.json 拿不到（Gitee 镜像未同步）时退化成「仓库可达」并标记 degraded。
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
  const done = (
    ok: boolean,
    degraded: boolean,
    url: string | null,
    extra: { kind?: SourceProbe['kind']; bytes?: number } = {},
  ): SourceProbe => ({
    source,
    ok,
    degraded,
    latencyMs: Math.max(0, now() - started),
    error: ok ? null : lastError,
    url,
    ...(extra.kind === undefined ? {} : { kind: extra.kind }),
    ...(extra.bytes === undefined ? {} : { bytes: extra.bytes }),
  });

  // ① mirror.json + 便携包 256KB：与真实下载同一条 raw 链路
  const mirrorUrl = assetsMirrorUrl(source, PROBE_FEED);
  try {
    const parsed = parseAssetsMirror(await requestJson(fetchImpl, mirrorUrl, remainingOf(deadline, now)));
    if (!parsed.ok) {
      fail(mirrorUrl, new Error(parsed.error));
    } else {
      const file = pickProbeFile(parsed.mirror.files);
      if (file === null) {
        fail(mirrorUrl, new Error('mirror.json 没有可探测的产物'));
      } else {
        const assetUrl = assetsFileUrl(source, PROBE_FEED, file.name);
        const chunk = await probeAssetChunk(assetUrl, fetchImpl, {
          timeoutMs: remainingOf(deadline, now),
          now,
        });
        if (chunk.ok) return done(true, false, assetUrl, { kind: 'asset', bytes: chunk.bytes });
        fail(assetUrl, new Error(chunk.error ?? '资产探测失败'));
      }
    }
  } catch (cause: unknown) {
    fail(mirrorUrl, cause);
  }

  // ② 退化：仓库可达即视为可尝试（Gitee 镜像还没同步时标记 degraded）
  for (const url of reachabilityUrls(source)) {
    try {
      await requestJson(fetchImpl, url, remainingOf(deadline, now));
      return done(true, true, url, { kind: 'reachability' });
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
