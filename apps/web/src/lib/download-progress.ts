import type { UpdateDownloadState } from './update-state.ts';

/**
 * 下载进度聚合与文案：并发分片与单流共用同一个进度结构。
 *
 * 边界：
 * - 切片后的字节计数、速度/剩余时间估算都是纯逻辑，单测用注入时钟即可确定性验证；
 * - 界面文案（百分比、速度、已收/总量、剩余时间）也只在这里拼，避免弹窗与设备页各写一套。
 */

/** 速度取最近 1 秒的窗口：更新太快会抖，太慢则反应迟钝。 */
const SPEED_WINDOW_MS = 1_000;
/** 只保留最近 8 个采样点，窗口外的旧点会被丢弃。 */
const MAX_SAMPLES = 8;

/**
 * 默认时钟：优先 `performance.now()`（单调，不受系统时间调整与测试冻结时钟影响）。
 * 冒烟把 `Date.now()` 固定在某个时刻，速度仍要能算出来，因此不能直接用 Date。
 */
export function nowMs(): number {
  const perf = globalThis.performance;
  if (perf !== undefined && typeof perf.now === 'function') return perf.now();
  return Date.now();
}

export interface DownloadProgressSnapshot {
  /** 已接收字节（并发分片会实时累加） */
  received: number;
  /** 总字节；未知时为 null */
  total: number | null;
  /** 0–1 的进度；总长未知时为 null */
  progress: number | null;
  /** 瞬时速度（字节/秒）；样本不足或速度未知时为 null */
  bytesPerSecond: number | null;
  /** 剩余时间估算（毫秒）；总长或速度未知时为 null */
  remainingMs: number | null;
}

export interface TransferSample {
  at: number;
  received: number;
}

/**
 * 速度估算：只取最近窗口内的采样点，首尾差值除以时间差。
 * 样本不足两个或没有新增字节时返回 null（界面就不显示速度，而不是显示 0 B/s）。
 */
export function estimateSpeed(
  samples: readonly TransferSample[],
  now: number,
  windowMs = SPEED_WINDOW_MS,
): number | null {
  const within = samples.filter((sample) => now - sample.at <= windowMs);
  const first = within[0];
  const last = within[within.length - 1];
  if (within.length < 2 || first === undefined || last === undefined) return null;
  const elapsed = last.at - first.at;
  const delta = last.received - first.received;
  if (elapsed <= 0 || delta <= 0) return null;
  return (delta / elapsed) * 1000;
}

/** 剩余时间 = 剩余字节 / 速度；速度未知或已经收满时按未知/0 处理。 */
export function estimateRemaining(
  total: number | null,
  received: number,
  bytesPerSecond: number | null,
): number | null {
  if (total === null || bytesPerSecond === null || bytesPerSecond <= 0) return null;
  const left = total - received;
  if (left <= 0) return 0;
  return Math.round((left / bytesPerSecond) * 1000);
}

/**
 * 进度聚合器：分片并发读时所有分片往同一个实例里加字节，回调拿到的是全局进度。
 * 时钟可注入，单测能确定性地验证速度与剩余时间。
 */
export class ProgressMeter {
  private receivedBytes = 0;
  private readonly samples: TransferSample[] = [];
  private readonly total: number | null;
  private readonly clock: () => number;

  constructor(total: number | null, clock: () => number = nowMs) {
    this.total = total !== null && Number.isFinite(total) && total > 0 ? total : null;
    this.clock = clock;
  }

  add(bytes: number): DownloadProgressSnapshot {
    const at = this.clock();
    this.receivedBytes += Math.max(0, bytes);
    this.samples.push({ at, received: this.receivedBytes });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    return this.snapshot(at);
  }

  snapshot(at: number = this.clock()): DownloadProgressSnapshot {
    const total = this.total;
    const progress = total === null ? null : Math.min(1, this.receivedBytes / total);
    const bytesPerSecond = estimateSpeed(this.samples, at);
    return {
      received: this.receivedBytes,
      total,
      progress,
      bytesPerSecond,
      remainingMs: estimateRemaining(total, this.receivedBytes, bytesPerSecond),
    };
  }
}

/** 字节数 → 可读单位（B/KB/MB/GB，保留一位小数）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index] ?? 'KB'}`;
}

/** 剩余时间：不足 1 秒、秒、分钟三档，避免出现「0.3 秒」这种抖动文案。 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '不到 1 秒';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.ceil(seconds / 60)} 分钟`;
}

/** 需要展示速度/剩余时间的进度字段：任务 store 与下载状态都满足这个结构。 */
export interface TransferProgressLike {
  received: number;
  total: number | null;
  progress: number | null;
  bytesPerSecond?: number | null;
  remainingMs?: number | null;
}

/** 进度文案前半句：`已下载 12.3 MB / 45.0 MB（27%）`；总长未知时省略总量与百分比。 */
export function receivedText(state: Pick<TransferProgressLike, 'received' | 'total' | 'progress'>): string {
  const received = formatBytes(state.received);
  const total = state.total === null ? '' : ` / ${formatBytes(state.total)}`;
  const percent = state.progress === null ? '' : `（${Math.round(state.progress * 100)}%）`;
  return `已下载 ${received}${total}${percent}`;
}

/**
 * 带速度与剩余时间的进度文案：`已下载 12.3 MB / 45.0 MB（27%） · 1.2 MB/s · 剩余 27 秒`。
 * 速度/剩余时间未知时自动省略对应段，文案不会出现空占位。
 */
export function formatTransferProgress(state: TransferProgressLike): string {
  const parts = [receivedText(state)];
  if (state.bytesPerSecond !== undefined && state.bytesPerSecond !== null && state.bytesPerSecond > 0) {
    parts.push(`${formatBytes(state.bytesPerSecond)}/s`);
  }
  if (state.remainingMs !== undefined && state.remainingMs !== null) {
    parts.push(`剩余 ${formatDuration(state.remainingMs)}`);
  }
  return parts.join(' · ');
}

/** 下载状态（当前阶段为 downloading）的进度文案。 */
export function formatDownloadProgress(state: UpdateDownloadState): string {
  if (state.phase !== 'downloading') return state.message ?? '';
  return receivedText(state);
}
