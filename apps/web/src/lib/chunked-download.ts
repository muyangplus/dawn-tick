import { errorMessage } from './errors.ts';
import {
  ProgressMeter,
  nowMs,
  type DownloadProgressSnapshot,
} from './download-progress.ts';

/**
 * 更新安装包的并发分片下载（HTTP Range）与单流回退。
 *
 * 边界：
 * - 只把「一个 URL」变成「一段完整字节」并上报进度；校验与安装出口仍归 `update-download.ts`；
 * - 切片规划（`planChunks`）与进度聚合（`download-progress.ts`）都是纯逻辑，fetch/时钟/重试可注入。
 *
 * 为什么分片：发布资产走 CDN，单连接常被限速；多连接并行更容易吃满可用带宽。服务器不支持 Range
 * （忽略 Range 直接返回 200、或 Range 不合法返回 416）时自动回退单流，两条路径共用同一个进度结构。
 */

/** 默认并发 4：4 路足以吃满常见家宽，又不至于像更高并发那样频繁触发 CDN 的连接/速率限制。 */
export const DEFAULT_CONCURRENCY = 4;
/** 并发上限 6：再多路收益递减，且部分代理/企业网关对同域并发连接数有硬限制。 */
export const MAX_CONCURRENCY = 6;
/** 单片至少 256 KB：片太小会让 Range 请求与头部开销占比过高，低于此值直接单片（单流）下载。 */
export const MIN_CHUNK_BYTES = 256 * 1024;
/** 单片最多重试 2 次（首次失败后再试 2 次），退避 500 ms → 1 s，足以跨过瞬时抖动。 */
export const CHUNK_RETRIES = 2;
export const RETRY_BASE_DELAY_MS = 500;
/** 用户取消下载：不算网络失败，调用方据此回到「已取消」而不是「失败」。 */
export class DownloadCancelledError extends Error {
  constructor(message = '已取消下载') {
    super(message);
    this.name = 'DownloadCancelledError';
  }
}

/** 单独取出取消状态：直接比较 `signal.aborted` 会被 TS 当成不会变化的属性，后续判断被判成死代码。 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** 并发数归一化：缺省 4，夹在 1–6 之间，小数向下取整。 */
export function normalizeConcurrency(value: number | null | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(value)));
}

export interface ChunkRange {
  /** 从 0 开始的片序号，拼包时按它排序 */
  index: number;
  /** 起始字节（含） */
  start: number;
  /** 结束字节（含），最后一片可能不满 */
  end: number;
}

/**
 * 把总长切成不超过并发数的均等分片，每片至少 `MIN_CHUNK_BYTES`。
 * 总长未知（null / 0 / 负数）返回空数组，调用方走单流。
 */
export function planChunks(total: number | null, concurrency = DEFAULT_CONCURRENCY): ChunkRange[] {
  if (total === null || !Number.isFinite(total) || total <= 0) return [];
  // 总长不足一片时只切一片，避免 Range 请求白涨开销
  const count = Math.max(1, Math.min(normalizeConcurrency(concurrency), Math.floor(total / MIN_CHUNK_BYTES)));
  const size = Math.ceil(total / count);
  const chunks: ChunkRange[] = [];
  for (let start = 0, index = 0; start < total; start += size, index += 1) {
    chunks.push({ index, start, end: Math.min(total, start + size) - 1 });
  }
  return chunks;
}

/** 响应头里的总长；缺失或非法时返回 null。 */
function headerTotal(response: Response): number | null {
  const raw = response.headers?.get('content-length') ?? '';
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function concatChunks(chunks: readonly Uint8Array[], received: number): Uint8Array {
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * 读干一个响应体并逐块回调字节数。
 * 取消时先 cancel 流：正卡在 `read()` 上的下载也能立刻结束；长度与 `expected` 不符视为失败（可重试）。
 */
async function readBody(
  response: Response,
  signal: AbortSignal | undefined,
  expected: number | null,
  onBytes: (count: number) => void,
): Promise<Uint8Array> {
  const reader =
    response.body !== null && typeof response.body?.getReader === 'function' ? response.body.getReader() : null;
  if (reader === null) {
    if (isAborted(signal)) throw new DownloadCancelledError();
    const bytes = new Uint8Array(await response.arrayBuffer());
    onBytes(bytes.length);
    if (expected !== null && bytes.length !== expected) {
      throw new Error(`下载长度不符（应为 ${expected} 字节，实际 ${bytes.length} 字节）`);
    }
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
      if (isAborted(signal)) throw new DownloadCancelledError();
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
  if (isAborted(signal)) throw new DownloadCancelledError();
  if (expected !== null && received !== expected) {
    throw new Error(`下载长度不符（应为 ${expected} 字节，实际 ${received} 字节）`);
  }
  return concatChunks(chunks, received);
}

export interface SingleStreamOptions {
  url: string;
  /** 已知总长（清单里的 size）；未知时用响应头 content-length */
  total?: number | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: DownloadProgressSnapshot) => void;
  clock?: () => number;
  /** 已经拿到的响应（Range 探测拿到 200 时复用，不再发第二次请求） */
  response?: Response;
}

/**
 * 单流下载：一次性 GET 整个文件，逐块上报进度。
 * 分片回退、总长未知、服务器不支持 Range 三种情况都走这里。
 */
export async function downloadSingleStream(options: SingleStreamOptions): Promise<Uint8Array> {
  let response = options.response;
  if (response === undefined) {
    const doFetch = options.fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== 'function') throw new Error('当前环境无法联网下载更新');
    response = await doFetch(options.url, options.signal === undefined ? {} : { signal: options.signal });
  }
  if (!response.ok) throw new Error(`更新源返回 ${response.status}`);

  const headerSize = headerTotal(response);
  // 服务端压缩过（content-encoding 非 identity）时 content-length 是压缩后长度，不能当校验基准
  const encoded = response.headers?.get('content-encoding');
  const expectedLength = encoded === null || encoded === 'identity' ? headerSize : null;
  const meter = new ProgressMeter(options.total ?? headerSize ?? null, options.clock);
  const bytes = await readBody(response, options.signal, expectedLength, (count) =>
    options.onProgress?.(meter.add(count)),
  );
  // 空响应体不会触发 add：补发一次终态，界面别停在 0
  options.onProgress?.(meter.snapshot());
  return bytes;
}

export interface ChunkedDownloadOptions {
  url: string;
  /** 总字节；未知道时走单流 */
  total: number | null;
  /** 并发数：缺省 4，夹在 1–6 */
  concurrency?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: DownloadProgressSnapshot) => void;
  /** 测试注入：重试等待（默认真实 setTimeout） */
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}

export interface ChunkedDownloadResult {
  bytes: Uint8Array;
  total: number | null;
  /** 实际走的路径：分片或单流（回退后也报 single） */
  mode: 'chunked' | 'single';
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 分片请求的结果：正常分片 / 服务端忽略 Range（响应体是整包）/ Range 不可用需换单流。 */
type ChunkAttempt =
  | { kind: 'range'; bytes: Uint8Array }
  | { kind: 'full'; response: Response }
  | { kind: 'fallback'; response: Response };

function chunkError(chunk: ChunkRange, cause: unknown): Error {
  return new Error(`第 ${chunk.index + 1} 片下载失败：${errorMessage(cause, '未知错误')}`);
}

/**
 * 单个分片：带 `Range` 请求，按状态码判断服务器是否真的支持。
 * 206 读满该片；200 说明 Range 被忽略（只允许首个探测片复用整包响应体，
 * 后续分片再收到 200 说明服务端行为不一致，直接失败并回退重下）；416 说明 Range 不可用。
 */
async function fetchChunkOnce(
  url: string,
  chunk: ChunkRange,
  doFetch: typeof fetch,
  signal: AbortSignal,
  onBytes: (count: number) => void,
  allowFullBody: boolean,
): Promise<ChunkAttempt> {
  const response = await doFetch(url, {
    headers: { Range: `bytes=${chunk.start}-${chunk.end}` },
    signal,
  });
  if (response.status === 206) {
    const expected = chunk.end - chunk.start + 1;
    const bytes = await readBody(response, signal, expected, onBytes);
    return { kind: 'range', bytes };
  }
  if (response.status === 200) {
    if (allowFullBody) return { kind: 'full', response };
    await discardBody(response);
    throw new Error('更新源没有按 Range 返回分片（收到 200）');
  }
  if (response.status === 416) {
    await discardBody(response);
    return { kind: 'fallback', response };
  }
  throw new Error(`更新源返回 ${response.status}`);
}

/** 丢掉不再需要的响应体，避免连接挂在半开状态。 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 测试桩可能没有 body：丢弃失败不影响主流程
  }
}

/** 分片重试：失败后指数退避，最后一次失败包成「第 N 片下载失败：原因」。 */
async function withChunkRetry(
  chunk: ChunkRange,
  run: () => Promise<ChunkAttempt>,
  retries: number,
  signal: AbortSignal,
  sleep: (ms: number) => Promise<void>,
): Promise<ChunkAttempt> {
  let last: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (isAborted(signal)) throw new DownloadCancelledError();
    try {
      return await run();
    } catch (cause: unknown) {
      if (isAborted(signal) || cause instanceof DownloadCancelledError) throw new DownloadCancelledError();
      last = cause;
      if (attempt < retries) await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  throw chunkError(chunk, last);
}

/**
 * 分片下载主流程：规划 → 首片兼作 Range 探测 → 并发拉剩余分片 → 按序拼包。
 * 总长未知或只有一片时直接单流；服务器忽略 Range 时用 200 的响应体回退单流。
 */
export async function downloadWithRanges(options: ChunkedDownloadOptions): Promise<ChunkedDownloadResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('当前环境无法联网下载更新');
  const clock = options.clock ?? nowMs;
  const sleep = options.sleep ?? defaultSleep;
  const chunks = planChunks(options.total, options.concurrency);
  const report = (snapshot: DownloadProgressSnapshot): void => options.onProgress?.(snapshot);

  if (chunks.length <= 1) {
    const bytes = await downloadSingleStream({
      url: options.url,
      total: options.total,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      fetchImpl: doFetch,
      clock,
      ...(options.onProgress === undefined ? {} : { onProgress: report }),
    });
    return { bytes, total: options.total ?? bytes.length, mode: 'single' };
  }

  if (isAborted(options.signal)) throw new DownloadCancelledError();
  const controller = new AbortController();
  const onExternalAbort = (): void => {
    controller.abort();
  };
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const signal = controller.signal;
  const meter = new ProgressMeter(options.total, clock);
  const onBytes = (count: number): void => report(meter.add(count));

  try {
    const first = chunks[0];
    if (first === undefined) throw new Error('分片规划失败');
    const probe = await withChunkRetry(
      first,
      () => fetchChunkOnce(options.url, first, doFetch, signal, onBytes, true),
      CHUNK_RETRIES,
      signal,
      sleep,
    );

    // 200：服务器忽略 Range，响应体就是整包 —— 直接按单流读完，不浪费这次请求
    if (probe.kind === 'full') {
      const bytes = await downloadSingleStream({
        url: options.url,
        total: options.total,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        fetchImpl: doFetch,
        clock,
        response: probe.response,
        ...(options.onProgress === undefined ? {} : { onProgress: report }),
      });
      return { bytes, total: options.total ?? bytes.length, mode: 'single' };
    }
    // 416：Range 不合法（例如清单里的 size 已过期），丢弃这次响应后按单流重下
    if (probe.kind === 'fallback') {
      const bytes = await downloadSingleStream({
        url: options.url,
        total: null,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        fetchImpl: doFetch,
        clock,
        ...(options.onProgress === undefined ? {} : { onProgress: report }),
      });
      return { bytes, total: bytes.length, mode: 'single' };
    }

    const slots: Array<Uint8Array | undefined> = new Array<Uint8Array | undefined>(chunks.length);
    slots[first.index] = probe.bytes;
    let failure: unknown = null;
    let next = 1;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (failure !== null) return;
        const index = next;
        next += 1;
        const chunk = chunks[index];
        if (chunk === undefined) return;
        try {
          const attempt = await withChunkRetry(
            chunk,
            () => fetchChunkOnce(options.url, chunk, doFetch, signal, onBytes, false),
            CHUNK_RETRIES,
            signal,
            sleep,
          );
          if (attempt.kind !== 'range') {
            throw new Error('更新源没有按 Range 返回分片（收到 200/416）');
          }
          slots[chunk.index] = attempt.bytes;
        } catch (cause: unknown) {
          if (failure === null) failure = cause;
          // 中止仍在跑的其它分片：失败后不该继续占用网络
          controller.abort();
          return;
        }
      }
    };
    const workers = Math.min(normalizeConcurrency(options.concurrency), chunks.length - 1);
    await Promise.all(Array.from({ length: workers }, () => worker()));

    if (isAborted(options.signal)) throw new DownloadCancelledError();
    if (failure !== null) throw failure;
    const bytes = new Uint8Array(options.total ?? 0);
    let offset = 0;
    for (const chunk of chunks) {
      const part = slots[chunk.index];
      if (part === undefined) throw new Error(`第 ${chunk.index + 1} 片没有下载完成`);
      const expected = chunk.end - chunk.start + 1;
      if (part.length !== expected) {
        throw new Error(`第 ${chunk.index + 1} 片长度不符（应为 ${expected} 字节，实际 ${part.length} 字节）`);
      }
      bytes.set(part, offset);
      offset += part.length;
    }
    report(meter.snapshot());
    return { bytes, total: options.total, mode: 'chunked' };
  } finally {
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}
