import type { UpdateAsset, UpdateManifest } from '../update.ts';
import { errorMessage } from './errors.ts';
import { DownloadCancelledError, downloadSingleStream, downloadWithRanges } from './chunked-download.ts';
import {
  INITIAL_UPDATE_STATE,
  reduceUpdateState,
  type UpdateDownloadState,
  type UpdateEvent,
  type UpdatePlatform,
} from './update-state.ts';

/**
 * 自动更新（I-03）的下载、校验与安装：纯逻辑 + 可注入的平台出口。
 *
 * 边界：
 * - 渠道 → 资产、SHA-256、状态机都是纯函数；真正的网络传输交给 `chunked-download.ts`
 *   （并发分片 + 单流回退），进度与文案在 `download-progress.ts`，这里只做编排；
 * - 平台出口 `UpdateDownloadHost` 只定义契约，具体实现（Tauri 写盘 / Capacitor）在 `update-install.ts`；
 * - 界面只消费 `UpdateDownloadState`，失败原因原样交给界面用 `fail()` 拼句。
 */

export {
  INITIAL_UPDATE_STATE,
  isUpdateBusy,
  reduceUpdateState,
  type UpdateDownloadState,
  type UpdateEvent,
  type UpdatePhase,
  type UpdatePlatform,
} from './update-state.ts';
export { DownloadCancelledError } from './chunked-download.ts';
export {
  formatBytes,
  formatDownloadProgress,
  formatDuration,
  formatTransferProgress,
  type TransferProgressLike,
} from './download-progress.ts';

export interface UpdateDownloadTarget {
  platform: 'windows' | 'android';
  url: string;
  /** 落盘文件名：固定名，重复下载覆盖旧安装包 */
  fileName: string;
  /** 清单给出的字节数：服务端没给 content-length 时用它显示进度 */
  size: number | null;
  /** 发布里同名 `.sha256` 资产地址 */
  checksumUrl: string | null;
  /** 清单里直接给出的摘要 */
  sha256: string | null;
}

export type UpdatePlan =
  | { kind: 'download'; target: UpdateDownloadTarget }
  | { kind: 'refresh' }
  | { kind: 'unavailable'; reason: string };

const INSTALLER_SUFFIXES: Record<'windows' | 'android', readonly string[]> = {
  windows: ['.exe', '.msi'],
  android: ['.apk'],
};

/** 固定落盘名：从资产地址取出安装包扩展名，非安装包（如便携 zip）返回 null。 */
export function installerFileName(platform: 'windows' | 'android', url: string): string | null {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // 相对地址或测试桩：按原样取最后一段
  }
  const base = (pathname.split('/').pop() ?? '').split('?')[0] ?? '';
  const lower = base.toLowerCase();
  const suffix = INSTALLER_SUFFIXES[platform].find((item) => lower.endsWith(item));
  if (suffix === undefined) return null;
  return platform === 'windows' ? `DawnTick-update${suffix}` : 'DawnTick-update.apk';
}

/**
 * 渠道 → 该下哪个资产。
 *
 * Web 不下载（构建随渠道自动更新）；Windows 只接受 exe/msi 安装包（便携 zip 请走发布页）；
 * Android 只接受 apk。缺资产时给可读原因，由界面提示并保留「打开发布页」。
 */
export function planUpdateDownload(manifest: UpdateManifest | null, platform: UpdatePlatform): UpdatePlan {
  if (platform === 'web') return { kind: 'refresh' };
  const asset: UpdateAsset | undefined = manifest?.assets?.[platform];
  if (asset === undefined || asset.url === '') {
    return {
      kind: 'unavailable',
      reason: platform === 'windows' ? '这次发布没有提供 Windows 安装包' : '这次发布没有提供 Android 安装包',
    };
  }
  const fileName = installerFileName(platform, asset.url);
  if (fileName === null) {
    return {
      kind: 'unavailable',
      reason:
        platform === 'windows' ? '发布里的 Windows 产物不是安装包，请到发布页下载便携版' : '发布里的 Android 产物不是 APK',
    };
  }
  return {
    kind: 'download',
    target: {
      platform,
      url: asset.url,
      fileName,
      size: asset.size ?? null,
      checksumUrl: asset.checksumUrl ?? null,
      sha256: asset.sha256 ?? null,
    },
  };
}

const SHA256_TEXT = /([0-9a-f]{64})/i;

/** 从 `.sha256` 文件内容（裸摘要或 `摘要  文件名`）取出摘要。 */
export function parseSha256(text: string): string | null {
  return SHA256_TEXT.exec(text)?.[1]?.toLowerCase() ?? null;
}

export function digestMatches(actual: string, expected: string): boolean {
  return actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

/** 计算字节序列的 SHA-256（十六进制小写）；环境没有 WebCrypto 时抛可读错误。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('当前环境不支持 SHA-256 校验');
  const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 单独取出取消状态：直接比较 `signal.aborted` 会被 TS 当成不会变化的属性，后续判断被判成死代码。 */
function isCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export interface DownloadProgress {
  received: number;
  total: number | null;
}

export interface DownloadRequest {
  url: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: DownloadProgress) => void;
}

/**
 * 单流下载（兼容入口）：有 `ReadableStream` 就逐块累计并回调进度，没有就一次性读完。
 * 自动更新本身走 `chunked-download.ts` 的并发分片；这里保留给「总长未知」等简单调用方与测试。
 */
export async function downloadBytes(request: DownloadRequest): Promise<Uint8Array> {
  return downloadSingleStream({
    url: request.url,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    ...(request.fetchImpl === undefined ? {} : { fetchImpl: request.fetchImpl }),
    onProgress: (progress) => request.onProgress?.({ received: progress.received, total: progress.total }),
  });
}

/** 平台出口：写安装包、启动安装器、读发布里的 `.sha256`。全部可注入，便于单测。 */
export interface UpdateDownloadHost {
  fetchImpl?: typeof fetch;
  /** 写入安装包，返回原生可用的路径（桌面绝对路径 / Android `file://` URI） */
  write: (fileName: string, bytes: Uint8Array) => Promise<string>;
  /** 交给系统安装器；`needsPermission` 表示已跳系统设置、授权后重试 */
  install: (path: string) => Promise<{ needsPermission: boolean }>;
  /** 读同名 `.sha256` 资产；没有该资产时返回 null */
  readChecksum: (url: string, signal?: AbortSignal) => Promise<string | null>;
}

export interface RunUpdateDownloadOptions {
  plan: UpdatePlan;
  host: UpdateDownloadHost;
  signal?: AbortSignal;
  /** 覆盖下载用的 fetch（测试桩与原生 HTTP 都从这里注入） */
  fetchImpl?: typeof fetch;
  /**
   * 后台下载：校验并写盘后停在 `ready`，把「启动安装器」留给用户点「安装」。
   * 默认 false，保持「下载并安装」一步到位的老行为（回滚等入口还用它）。
   */
  deferInstall?: boolean;
  onState?: (state: UpdateDownloadState) => void;
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
  if (target.checksumUrl === null) return null;
  const text = await host.readChecksum(target.checksumUrl, signal);
  return text === null ? null : parseSha256(text);
}

function shortened(digest: string): string {
  return `${digest.slice(0, 12)}…`;
}

/**
 * 下载 → 校验 → 写盘 →（可选）交给系统安装器。校验不通过或没有校验文件时一律不安装。
 * 取消（signal）回到 idle；其余异常给 failed + 可读原因，界面可重试。
 * `deferInstall` 为 true 时停在 `ready`，由 `installPreparedUpdate` 完成最后一步。
 */
export async function runUpdateDownload(options: RunUpdateDownloadOptions): Promise<UpdateDownloadState> {
  let state: UpdateDownloadState = INITIAL_UPDATE_STATE;
  const emit = (event: UpdateEvent): UpdateDownloadState => {
    state = reduceUpdateState(state, event);
    options.onState?.(state);
    return state;
  };

  const { plan, host, signal } = options;
  if (plan.kind === 'refresh') return emit({ type: 'done', message: '新版本已发布，刷新页面后生效' });
  if (plan.kind === 'unavailable') return emit({ type: 'fail', error: plan.reason });

  emit({ type: 'start' });
  const fetchImpl = options.fetchImpl ?? host.fetchImpl;
  try {
    // 并发分片 + 单流回退都在 chunked-download 里；这里只把聚合进度灌进状态机
    const { bytes } = await downloadWithRanges({
      url: plan.target.url,
      total: plan.target.size,
      ...(signal === undefined ? {} : { signal }),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
      onProgress: (progress) =>
        emit({
          type: 'progress',
          received: progress.received,
          total: progress.total ?? plan.target.size,
          bytesPerSecond: progress.bytesPerSecond,
          remainingMs: progress.remainingMs,
        }),
    });
    emit({ type: 'verify' });
    const expected = await expectedDigest(plan.target, host, signal);
    if (expected === null) throw new Error('这次发布没有提供校验文件，已停止安装');
    const actual = await sha256Hex(bytes);
    if (!digestMatches(actual, expected)) {
      throw new Error(`安装包校验失败（应为 ${shortened(expected)}，实际 ${shortened(actual)}）`);
    }
    const path = await host.write(plan.target.fileName, bytes);
    if (options.deferInstall === true) {
      return emit({ type: 'ready', path, message: '安装包已下载并校验完成，可以安装' });
    }
    emit({ type: 'install' });
    const outcome = await host.install(path);
    if (outcome.needsPermission) {
      return emit({
        type: 'fail',
        error: '已跳转系统设置，请允许安装未知应用后重试',
        needsPermission: true,
        path,
      });
    }
    return emit({ type: 'done', path, message: '安装程序已启动，请按提示完成安装' });
  } catch (cause: unknown) {
    if (isCancelled(signal)) return emit({ type: 'cancel' });
    return emit({ type: 'fail', error: errorMessage(cause, '下载更新失败') });
  }
}

export interface InstallPreparedOptions {
  host: UpdateDownloadHost;
  /** `runUpdateDownload({ deferInstall: true })` 落盘后的路径 */
  path: string;
  signal?: AbortSignal;
  onState?: (state: UpdateDownloadState) => void;
}

/**
 * 后台下载完成后的最后一步：把已校验的安装包交给系统安装器。
 * 与 `runUpdateDownload` 共用同一套状态机与失败文案，界面只认 `UpdateDownloadState`。
 */
export async function installPreparedUpdate(options: InstallPreparedOptions): Promise<UpdateDownloadState> {
  let state: UpdateDownloadState = {
    ...INITIAL_UPDATE_STATE,
    phase: 'ready',
    progress: 1,
    message: '安装包已下载并校验完成，可以安装',
    path: options.path,
  };
  const emit = (event: UpdateEvent): UpdateDownloadState => {
    state = reduceUpdateState(state, event);
    options.onState?.(state);
    return state;
  };
  if (isCancelled(options.signal)) return emit({ type: 'cancel' });
  emit({ type: 'install' });
  try {
    const outcome = await options.host.install(options.path);
    if (outcome.needsPermission) {
      return emit({
        type: 'fail',
        error: '已跳转系统设置，请允许安装未知应用后重试',
        needsPermission: true,
        path: options.path,
      });
    }
    return emit({ type: 'done', path: options.path, message: '安装程序已启动，请按提示完成安装' });
  } catch (cause: unknown) {
    if (isCancelled(options.signal)) return emit({ type: 'cancel' });
    return emit({ type: 'fail', error: errorMessage(cause, '启动安装程序失败') });
  }
}
