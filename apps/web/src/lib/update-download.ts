import { downloadChunked, type DownloadProgress } from './chunked-download.ts';
import { errorMessage } from './errors.ts';
import {
  digestMatches,
  parseChecksums,
  parseSha256,
  sha256Hex,
  type UpdateDownloadTarget,
  type UpdatePlan,
} from './update-download-plan.ts';
import {
  INITIAL_UPDATE_STATE,
  reduceUpdateState,
  type UpdateDownloadState,
  type UpdateEvent,
} from './update-download-state.ts';
import { updateTaskCopy } from '../copy/update-task.ts';

/**
 * 自动更新（I-03）的下载、校验与安装流程；状态机在 `update-download-state.ts`，
 * 资产挑选与校验在 `update-download-plan.ts`，这里统一转出。
 *
 * 边界：
 * - 渠道 → 资产、SHA-256、状态机都是纯函数，单测不碰网络与原生；
 * - 并发分片下载在 `chunked-download.ts`，这里只负责把进度折进界面消费的状态；
 * - 平台出口 `UpdateDownloadHost` 只定义契约，具体实现（Tauri 写盘 / Capacitor）在 `update-install.ts`；
 * - 界面只消费 `UpdateDownloadState`，失败原因原样交给界面用 `fail()` 拼句。
 */

/** 进度与取消错误定义在下载引擎里，这里原样转出，调用方不必换导入路径。 */
export { DownloadCancelledError, type DownloadProgress } from './chunked-download.ts';

export * from './update-download-state.ts';
export * from './update-download-plan.ts';

/** 单独取出取消状态：直接比较 `signal.aborted` 会被 TS 当成不会变化的属性，后续判断被判成死代码。 */
function isCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export interface DownloadRequest {
  url: string;
  /** 已知总长（清单里的 size）：给了才能并发分片；未知时下载引擎自动走单流 */
  totalBytes?: number | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: DownloadProgress) => void;
}

/**
 * 下载字节：内部改走 `chunked-download` 的并发分片引擎，进度原样透传。
 * 保留这个入口是为了让 `runUpdateDownload` 与既有调用点不必感知引擎细节。
 */
export async function downloadBytes(request: DownloadRequest): Promise<Uint8Array> {
  return downloadChunked({
    url: request.url,
    ...(request.totalBytes === undefined ? {} : { totalBytes: request.totalBytes }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    ...(request.fetchImpl === undefined ? {} : { fetchImpl: request.fetchImpl }),
    ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
  });
}

/** 平台出口：写安装包、启动安装器、读发布里的 `SHA256SUMS.txt`。全部可注入，便于单测。 */
export interface UpdateDownloadHost {
  fetchImpl?: typeof fetch;
  /** 写入安装包，返回原生可用的路径（桌面绝对路径 / Android `file://` URI） */
  write: (fileName: string, bytes: Uint8Array) => Promise<string>;
  /** 交给系统安装器；`needsPermission` 表示已跳系统设置、授权后重试 */
  install: (path: string) => Promise<{ needsPermission: boolean }>;
  /**
   * 便携版：解压 zip 并准备「退出后覆盖 exe」的脚本，返回脚本路径。
   * 只有 Windows 桌面提供；Android/Web 不实现。
   */
  installPortable?: (zipPath: string) => Promise<string>;
  /** 便携版：退出应用让替换脚本接手（不能先重启，否则旧二进制会重新占用 exe）。 */
  exitForUpdate?: () => Promise<void>;
  /** 读发布里的 `SHA256SUMS.txt`；没有该资产时返回 null */
  readChecksum: (url: string, signal?: AbortSignal) => Promise<string | null>;
}

export interface RunUpdateDownloadOptions {
  plan: UpdatePlan;
  host: UpdateDownloadHost;
  signal?: AbortSignal;
  /** 覆盖下载用的 fetch（测试桩与原生 HTTP 都从这里注入） */
  fetchImpl?: typeof fetch;
  onState?: (state: UpdateDownloadState) => void;
  /** 引擎粒度的进度（含速度与剩余时间）：后台任务与进度区消费，状态机只保留字节数 */
  onProgress?: (progress: DownloadProgress) => void;
}

async function expectedDigest(
  target: UpdateDownloadTarget,
  host: UpdateDownloadHost,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  if (target.sha256 !== null) {
    const parsed = parseSha256(target.sha256);
    if (parsed !== null) return parsed;
  }
  if (target.checksumsUrl === null) return null;
  const text = await host.readChecksum(target.checksumsUrl, signal);
  if (text === null) return null;
  const table = parseChecksums(text);
  // 合并校验文件里按发布时的原始文件名登记；落盘名（固定名）兜底，方便直连清单只给摘要的场景
  return (
    table[target.assetName.toLowerCase()] ??
    table[target.fileName.toLowerCase()] ??
    null
  );
}

function shortened(digest: string): string {
  return `${digest.slice(0, 12)}…`;
}

/** 只下载+校验+写盘：后台任务走到这里，装不装由用户点「安装」决定。 */
export async function prepareUpdateDownload(options: RunUpdateDownloadOptions): Promise<UpdateDownloadState> {
  return runUpdateFlow(options, 'prepare');
}

/** 下载 → 校验 → 写盘 → 交给系统安装器（既有行为，签名不变；取消回 idle）。 */
export async function runUpdateDownload(options: RunUpdateDownloadOptions): Promise<UpdateDownloadState> {
  return runUpdateFlow(options, 'install');
}

/** 两个入口共用一条流程，只在「写盘后是否立刻安装」上分叉。 */
async function runUpdateFlow(
  options: RunUpdateDownloadOptions,
  mode: 'prepare' | 'install',
): Promise<UpdateDownloadState> {
  let state = INITIAL_UPDATE_STATE;
  const emit = (event: UpdateEvent): UpdateDownloadState => {
    state = reduceUpdateState(state, event);
    options.onState?.(state);
    return state;
  };

  const { plan, host, signal } = options;
  if (plan.kind === 'refresh') return emit({ type: 'done', message: updateTaskCopy.refreshToApply });
  if (plan.kind === 'unavailable') return emit({ type: 'fail', error: plan.reason });

  emit({ type: 'start' });
  // 资产探测与下载都走注入的 fetch（桌面为 Tauri plugin-http、Android 为 CapacitorHttp）：
  // Gitee raw 不带 CORS 头，WebView 的 fetch 会被浏览器拦掉
  const fetchImpl = options.fetchImpl ?? host.fetchImpl;
  try {
    const bytes = await downloadBytes({
      url: plan.target.url,
      ...(plan.target.size === null ? {} : { totalBytes: plan.target.size }),
      ...(signal === undefined ? {} : { signal }),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
      onProgress: (progress) => {
        options.onProgress?.(progress);
        emit({ type: 'progress', received: progress.received, total: progress.total ?? plan.target.size });
      },
    });
    emit({ type: 'verify' });
    const expected = await expectedDigest(plan.target, host, signal);
    if (expected === null) throw new Error(updateTaskCopy.noChecksum);
    const actual = await sha256Hex(bytes);
    if (!digestMatches(actual, expected)) {
      throw new Error(updateTaskCopy.checksumMismatch(shortened(expected), shortened(actual)));
    }
    emit({ type: 'install' });
    const path = await host.write(plan.target.fileName, bytes);
    if (mode === 'prepare') {
      return emit({
        type: 'done',
        path,
        message:
          plan.target.kind === 'portable' ? updateTaskCopy.portableReady : updateTaskCopy.installerReady,
      });
    }
    if (plan.target.kind === 'portable') {
      if (host.installPortable === undefined) {
        throw new Error(updateTaskCopy.portableUnsupported);
      }
      await host.installPortable(path);
      return emit({
        type: 'done',
        path,
        message: updateTaskCopy.portableApplying,
      });
    }
    const outcome = await host.install(path);
    if (outcome.needsPermission) {
      return emit({
        type: 'fail',
        error: updateTaskCopy.needsInstallPermission,
        needsPermission: true,
        path,
      });
    }
    return emit({ type: 'done', path, message: updateTaskCopy.installerLaunched });
  } catch (cause: unknown) {
    if (isCancelled(signal)) return emit({ type: 'cancel' });
    return emit({ type: 'fail', error: errorMessage(cause, updateTaskCopy.downloadFailed) });
  }
}

/** 进度文案：`已下载 12.3 MB / 45.0 MB（27%）`；总长未知时省略总量与百分比。 */
export function formatByteProgress(received: number, total: number | null, percent: number | null): string {
  return updateTaskCopy.byteProgress(
    formatBytes(received),
    total === null ? null : formatBytes(total),
    percent === null ? null : Math.round(percent * 100),
  );
}

export function formatDownloadProgress(state: UpdateDownloadState): string {
  if (state.phase !== 'downloading') return state.message ?? '';
  return formatByteProgress(state.received, state.total, state.progress);
}

/** 进度明细：`速度 4.2 MB/s · 剩余 12 秒`；速度/剩余都算不出来时返回空串。 */
export function formatDownloadDetail(progress: DownloadProgress): string {
  return updateTaskCopy.downloadDetail(
    progress.speedBytesPerSec === null ? null : formatBytes(progress.speedBytesPerSec),
    progress.etaSeconds === null ? null : formatEta(progress.etaSeconds),
  );
}

/** 剩余时间按人读的粒度取整：不到 1 分钟说秒，超过 1 小时说小时+分钟。 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return updateTaskCopy.etaUnderSecond;
  if (seconds < 60) return updateTaskCopy.etaSeconds(Math.ceil(seconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return updateTaskCopy.etaMinutes(minutes, Math.round(seconds % 60));
  return updateTaskCopy.etaHours(Math.floor(minutes / 60), minutes % 60);
}

function formatBytes(bytes: number): string {
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
