/**
 * 并发分片下载引擎（HTTP Range）：把一个安装包切成若干片并发拉取，按序拼接后交给校验。
 *
 * 边界：
 * - 这里只管「拿到完整字节」与进度聚合，校验/写盘/安装仍在 `update-download.ts`；
 * - 并发、片大小、重试间隔都是下面的常量，调参只改这一处；
 * - 服务器不支持 Range（返回 200 / 忽略 Range 头）时自动回退单流，未知总长同样走单流；
 * - 每片的 fetch/时钟/等待都可注入，单测不碰网络也不真的 sleep。
 */

/** 默认并发 4 片：GitHub 资产的 CDN 上 4 条连接通常已吃满家用带宽，再多收益很小。 */
export const DEFAULT_CHUNK_CONCURRENCY = 4;
/** 并发上限 6：单文件最多 6 条连接，避免对下载源发起过多并发请求。 */
export const MAX_CHUNK_CONCURRENCY = 6;
/** 单片至少 256KB：片太小的话，请求开销会超过并行带来的收益。 */
export const MIN_CHUNK_BYTES = 256 * 1024;
/** 单片重试 2 次，退避 300ms / 900ms：先躲过一次连接抖动，再躲过一小段拥塞。 */
export const CHUNK_RETRY_DELAYS_MS: readonly number[] = [300, 900];

/** 聚合后的下载进度：百分比、速度与剩余时间都由已收字节与耗时算出，界面只读这里。 */
export interface DownloadProgress {
  received: number;
  total: number | null;
  /** 0–1 的进度；总长未知时为 null */
  percent: number | null;
  /** 平均速度（字节/秒）；还没收到数据或耗时不足时为 null */
  speedBytesPerSec: number | null;
  /** 预计剩余秒数；总长未知时为 null */
  etaSeconds: number | null;
}

/** 用户取消下载：不算网络失败，上层状态机据此回到「已取消」而不是「失败」。 */
export class DownloadCancelledError extends Error {
  constructor() {
    super('已取消下载');
    this.name = 'DownloadCancelledError';
  }
}

/** 服务器在分片过程中才暴露「不支持 Range」：内部信号，外层据此整体回退单流。 */
class RangeUnsupportedError extends Error {
  constructor() {
    super('服务器不支持 Range 请求');
    this.name = 'RangeUnsupportedError';
  }
}

/** 一片的闭区间字节范围（含 `end`），下标用于按序拼接。 */
export interface ChunkRange {
  index: number;
  start: number;
  end: number;
}

/** 分片规划结果：总长未知或片数不足 1 时直接单流，不浪费一次 Range 探测。 */
export type ChunkPlan =
  | { kind: 'ranged'; chunks: ChunkRange[] }
  | { kind: 'stream'; reason: 'unknown-size' | 'too-small' };

/** 正整数字节数；0、负数、NaN、非数字一律按「未知总长」处理。 */
function normalizeTotal(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const total = Math.floor(value);
  return total > 0 ? total : null;
}

/** 并发数收敛到 [1, MAX]：调用方传错也不至于 0 条连接或把源打爆。 */
export function clampConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CHUNK_CONCURRENCY;
  return Math.max(1, Math.min(MAX_CHUNK_CONCURRENCY, Math.floor(value)));
}

/**
 * 纯分片规划：均分总长，余数落在末片，保证 `end - start + 1` 之和严格等于总长。
 * 总长未知 → 单流；总长不足两片（< 512KB）→ 单流，避免为一点数据多次往返。
 */
export function planChunks(totalBytes: number | null | undefined, concurrency?: number): ChunkPlan {
  const total = normalizeTotal(totalBytes);
  if (total === null) return { kind: 'stream', reason: 'unknown-size' };
  const count = Math.min(clampConcurrency(concurrency), Math.floor(total / MIN_CHUNK_BYTES));
  if (count <= 1) return { kind: 'stream', reason: 'too-small' };
  const base = Math.floor(total / count);
  const chunks: ChunkRange[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * base;
    // 末片吃掉余数（total 不整除 count 时最多多 count-1 字节）
    const end = index === count - 1 ? total - 1 : start + base - 1;
    chunks.push({ index, start, end });
  }
  return { kind: 'ranged', chunks };
}

/** 进度聚合的时钟：优先单调时钟（`performance.now()`），避免系统时间被回拨或冻结时速度变成 0。 */
function defaultNow(): number {
  const perf = globalThis.performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

/** 把已收字节与耗时折成进度；速度是本次下载的平均值，够稳且不会因单块抖动乱跳。 */
export function progressOf(received: number, total: number | null, elapsedMs: number): DownloadProgress {
  const safeReceived = Math.max(0, received);
  const percent = total === null || total <= 0 ? null : Math.min(1, Math.max(0, safeReceived / total));
  // 至少按 1ms 计：极短耗时下速度是有限值，不会出现 Infinity 或 0
  const seconds = Math.max(elapsedMs, 1) / 1000;
  const speed = safeReceived > 0 ? safeReceived / seconds : null;
  const eta = total !== null && speed !== null ? Math.max(0, (total - safeReceived) / speed) : null;
  return { received: safeReceived, total, percent, speedBytesPerSec: speed, etaSeconds: eta };
}

/** 并发执行但限制在途数量：一片失败不会取消其它片，等全部落定后再抛第一个失败。 */
export async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit = DEFAULT_CHUNK_CONCURRENCY,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]!();
    }
  };
  const workers = Array.from({ length: Math.min(clampConcurrency(limit), tasks.length) }, worker);
  const settled = await Promise.allSettled(workers);
  const failed = settled.find((item) => item.status === 'rejected');
  if (failed !== undefined && failed.status === 'rejected') throw failed.reason;
  return results;
}

function isCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** 丢弃不用的响应体：服务器忽略 Range 但没被采用的 200 响应要及时关掉，别占着连接。 */
function discardResponse(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

function cancelled(): DownloadCancelledError {
  return new DownloadCancelledError();
}

function normalizeHeaderTotal(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  return normalizeTotal(Number(value));
}

/** 读响应体：逐块回调字节数；取消时先关流，正卡在 `read()` 上的请求也能立刻结束。 */
async function readBody(
  response: Response,
  onBytes: (bytes: number) => void,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const reader =
    response.body !== null && typeof response.body?.getReader === 'function' ? response.body.getReader() : null;
  if (reader === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (isCancelled(signal)) throw cancelled();
    onBytes(bytes.length);
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      if (isCancelled(signal)) throw cancelled();
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      chunks.push(value);
      received += value.length;
      onBytes(value.length);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (isCancelled(signal)) throw cancelled();
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

interface RangeRead {
  /** 拿到这一片的局部字节；长度应等于请求的范围长度 */
  kind: 'partial';
  bytes: Uint8Array;
}

/** 发一次 Range 请求；服务器忽略 Range 返回 200 时把整个响应当单流交回调用方。 */
async function fetchRange(
  fetchImpl: typeof fetch,
  url: string,
  range: ChunkRange,
  signal: AbortSignal | undefined,
  onBytes: (bytes: number) => void,
): Promise<RangeRead | { kind: 'full'; response: Response }> {
  const headers = new Headers({ range: `bytes=${range.start}-${range.end}` });
  const response = await fetchImpl(url, signal === undefined ? { headers } : { headers, signal });
  if (isCancelled(signal)) throw cancelled();
  // 200 = 服务器（或中间代理）忽略了 Range：这是「不支持分片」的可靠信号。
  // 206 即使没带 `Accept-Ranges: bytes` 也证明按范围返回了局部内容，按支持处理。
  if (response.status === 200) return { kind: 'full', response };
  if (response.status !== 206) {
    discardResponse(response);
    throw new Error(`更新源返回 ${response.status}`);
  }
  const bytes = await readBody(response, onBytes, signal);
  return { kind: 'partial', bytes };
}

interface EngineContext {
  url: string;
  signal: AbortSignal | undefined;
  wait: (ms: number) => Promise<void>;
  onBytes: (bytes: number) => void;
}

/** 单片重试：退避 300ms/900ms，重试前把这一片已读的字节从进度里退回，避免重复计数。 */
async function fetchRangeWithRetry(
  fetchImpl: typeof fetch,
  range: ChunkRange,
  context: EngineContext,
): Promise<RangeRead | { kind: 'full'; response: Response }> {
  for (let attempt = 0; ; attempt += 1) {
    let attemptBytes = 0;
    try {
      return await fetchRange(fetchImpl, context.url, range, context.signal, (size) => {
        attemptBytes += size;
        context.onBytes(size);
      });
    } catch (cause: unknown) {
      // 这一片读了一半才断：先退回已计字节，重试会从头再读，不能重复累计进度
      if (attemptBytes > 0) context.onBytes(-attemptBytes);
      if (cause instanceof DownloadCancelledError || cause instanceof RangeUnsupportedError) throw cause;
      if (isCancelled(context.signal)) throw cancelled();
      if (attempt >= CHUNK_RETRY_DELAYS_MS.length) throw cause;
      await context.wait(CHUNK_RETRY_DELAYS_MS[attempt]!);
      if (isCancelled(context.signal)) throw cancelled();
    }
  }
}

/**
 * 单流回退：整包读一遍，进度照常上报（总长用调用方给的值，没有就用 content-length）。
 * 服务器不支持 Range、或总长未知时都走这里。
 */
async function downloadSingleStream(
  request: ChunkedDownloadRequest,
  fetchImpl: typeof fetch,
  declaredTotal: number | null,
  startedAt: number,
): Promise<Uint8Array> {
  const response = await fetchImpl(request.url, request.signal === undefined ? {} : { signal: request.signal });
  if (isCancelled(request.signal)) throw cancelled();
  if (!response.ok) throw new Error(`更新源返回 ${response.status}`);
  const headerTotal = normalizeHeaderTotal(response.headers?.get('content-length'));
  const total = declaredTotal ?? headerTotal;
  const now = request.now ?? defaultNow;
  let received = 0;
  const bytes = await readBody(
    response,
    (size) => {
      received += size;
      request.onProgress?.(progressOf(received, total, Math.max(0, now() - startedAt)));
    },
    request.signal,
  );
  // 收尾补一次：既让进度到 100%，也把 content-length 缺失时的总长补齐
  request.onProgress?.(progressOf(bytes.length, total ?? bytes.length, Math.max(0, now() - startedAt)));
  return bytes;
}

/** 把服务器忽略 Range 时返回的 200 响应当作单流消费：分片探测阶段已经浪费的字节不计入进度。 */
async function consumeFullResponse(
  request: ChunkedDownloadRequest,
  response: Response,
  declaredTotal: number | null,
  startedAt: number,
): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`更新源返回 ${response.status}`);
  const headerTotal = normalizeHeaderTotal(response.headers?.get('content-length'));
  const total = declaredTotal ?? headerTotal;
  const now = request.now ?? defaultNow;
  let received = 0;
  const bytes = await readBody(
    response,
    (size) => {
      received += size;
      request.onProgress?.(progressOf(received, total, Math.max(0, now() - startedAt)));
    },
    request.signal,
  );
  request.onProgress?.(progressOf(bytes.length, total ?? bytes.length, Math.max(0, now() - startedAt)));
  return bytes;
}

/** 按序拼接分片，并核对总长：少字节或多字节都宁可失败，也不能把坏包交给校验。 */
function assembleRanged(parts: ReadonlyArray<Uint8Array | undefined>, total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    if (part === undefined) throw new Error('下载分片缺失，已停止写入');
    bytes.set(part, offset);
    offset += part.length;
  }
  if (offset !== total) {
    throw new Error(`更新包大小不一致（应为 ${total} 字节，实际 ${offset} 字节），已停止写入`);
  }
  return bytes;
}

export interface ChunkedDownloadRequest {
  url: string;
  /** 已知总长：给了才并发分片；未知时直接用单流，进度总量取 content-length */
  totalBytes?: number | null;
  concurrency?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: DownloadProgress) => void;
  /** 测试注入：重试等待；默认真实的 setTimeout */
  wait?: (ms: number) => Promise<void>;
  /** 测试注入：时钟；默认 `performance.now()`（单调，不受系统时间调整影响） */
  now?: () => number;
}

/**
 * 下载入口：能分片就分片，不能就单流；取消统一抛 `DownloadCancelledError`。
 * 分片探测发现 200 时直接把该响应当单流下载，因此回退不额外消耗一次整包请求。
 */
export async function downloadChunked(request: ChunkedDownloadRequest): Promise<Uint8Array> {
  const fetchImpl = request.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前环境无法联网下载更新');
  const wait = request.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = request.now ?? defaultNow;
  const startedAt = now();
  const total = normalizeTotal(request.totalBytes);
  const plan = planChunks(total, request.concurrency);
  if (total === null || plan.kind === 'stream') return downloadSingleStream(request, fetchImpl, total, startedAt);

  const parts: Array<Uint8Array | undefined> = new Array(plan.chunks.length);
  let received = 0;
  const report = (): void => {
    request.onProgress?.(progressOf(received, total, Math.max(0, now() - startedAt)));
  };
  const context: EngineContext = {
    url: request.url,
    signal: request.signal,
    wait,
    onBytes: (size) => {
      received += size;
      report();
    },
  };

  const first = plan.chunks[0]!;
  const probe = await fetchRangeWithRetry(fetchImpl, first, context);
  if (probe.kind === 'full') {
    // 常见的不支持 Range 场景：探测片就返回 200，直接消费这个响应，进度与总长都不丢。
    return consumeFullResponse(request, probe.response, total, startedAt);
  }
  parts[first.index] = probe.bytes;

  const rest = plan.chunks.slice(1).map((chunk) => async () => {
    const outcome = await fetchRangeWithRetry(fetchImpl, chunk, context);
    if (outcome.kind === 'full') {
      discardResponse(outcome.response);
      throw new RangeUnsupportedError();
    }
    parts[chunk.index] = outcome.bytes;
  });
  try {
    await runWithConcurrency(rest, clampConcurrency(request.concurrency));
  } catch (cause: unknown) {
    if (!(cause instanceof RangeUnsupportedError)) throw cause;
    // 中途才发现服务器在说谎：已读分片作废，重新按单流拉全量（总长不变，进度从头累计）。
    return downloadSingleStream(request, fetchImpl, total, startedAt);
  }
  return assembleRanged(parts, total);
}
