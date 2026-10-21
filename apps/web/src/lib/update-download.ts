import type { UpdateAsset, UpdateManifest } from '../update.ts';
import { errorMessage } from './errors.ts';

/**
 * 自动更新（I-03）的下载、校验与安装：纯逻辑 + 可注入的平台出口。
 *
 * 边界：
 * - 渠道 → 资产、SHA-256、状态机、流式下载都是纯函数，单测不碰网络与原生；
 * - 平台出口 `UpdateDownloadHost` 只定义契约，具体实现（Tauri 写盘 / Capacitor）在 `update-install.ts`；
 * - 界面只消费 `UpdateDownloadState`，失败原因原样交给界面用 `fail()` 拼句。
 */

export type UpdatePlatform = 'windows' | 'android' | 'web';

/** 下载/安装阶段。`checking` 留给「重新检查」入口；弹窗拿到的是已检查过的结果。 */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'installing' | 'done' | 'failed';

export interface UpdateDownloadState {
  phase: UpdatePhase;
  /** 已接收字节 */
  received: number;
  /** 总字节；服务端与清单都没给时为 null */
  total: number | null;
  /** 0–1 的进度；总长未知时为 null */
  progress: number | null;
  /** 当前阶段的可读说明 */
  message: string | null;
  /** 失败原因（原始一句话，展示时由界面用 fail() 拼完整句） */
  error: string | null;
  /** 落盘路径：桌面是安装包绝对路径，Android 是 `file://` URI */
  path: string | null;
  /** Android 未授权「安装未知应用」时为 true，授权后重试即可 */
  needsPermission: boolean;
}

export const INITIAL_UPDATE_STATE: UpdateDownloadState = {
  phase: 'idle',
  received: 0,
  total: null,
  progress: null,
  message: null,
  error: null,
  path: null,
  needsPermission: false,
};

export type UpdateEvent =
  | { type: 'check' }
  | { type: 'start' }
  | { type: 'progress'; received: number; total: number | null }
  | { type: 'verify' }
  | { type: 'install' }
  | { type: 'done'; message: string; path?: string | null }
  | { type: 'fail'; error: string; needsPermission?: boolean; path?: string | null }
  | { type: 'cancel' }
  | { type: 'reset' };

const BUSY_PHASES: readonly UpdatePhase[] = ['downloading', 'verifying', 'installing'];

/** 是否正在下载/校验/安装：界面据此禁用重复点击并提供「取消下载」。 */
export function isUpdateBusy(phase: UpdatePhase): boolean {
  return BUSY_PHASES.includes(phase);
}

/**
 * 状态机：只接受合法转移，非法事件原样返回。
 * idle → downloading → verifying → installing → done；任一阶段可 failed 或取消回 idle。
 */
export function reduceUpdateState(state: UpdateDownloadState, event: UpdateEvent): UpdateDownloadState {
  switch (event.type) {
    case 'check':
      return state.phase === 'idle' ? { ...state, phase: 'checking', message: '正在检查更新…' } : state;
    case 'start':
      if (state.phase !== 'idle' && state.phase !== 'checking' && state.phase !== 'failed' && state.phase !== 'done') {
        return state;
      }
      return { ...INITIAL_UPDATE_STATE, phase: 'downloading', message: '正在下载安装包…' };
    case 'progress': {
      if (state.phase !== 'downloading') return state;
      const total = event.total !== null && event.total > 0 ? event.total : null;
      const progress = total === null ? null : Math.min(1, Math.max(0, event.received / total));
      return { ...state, received: event.received, total, progress };
    }
    case 'verify':
      return state.phase === 'downloading'
        ? { ...state, phase: 'verifying', progress: 1, message: '正在校验安装包…' }
        : state;
    case 'install':
      return state.phase === 'verifying' ? { ...state, phase: 'installing', message: '正在写入安装包…' } : state;
    case 'done':
      return state.phase === 'idle' || isUpdateBusy(state.phase)
        ? {
            ...state,
            phase: 'done',
            progress: 1,
            message: event.message,
            error: null,
            path: event.path ?? state.path,
            needsPermission: false,
          }
        : state;
    case 'fail':
      // idle 也能失败：没有该平台的资产时还没开始下载
      return state.phase === 'idle' || state.phase === 'checking' || isUpdateBusy(state.phase)
        ? {
            ...state,
            phase: 'failed',
            message: null,
            error: event.error,
            needsPermission: event.needsPermission === true,
            path: event.path ?? state.path,
          }
        : state;
    case 'cancel':
      return isUpdateBusy(state.phase) ? { ...INITIAL_UPDATE_STATE, message: '已取消下载' } : state;
    case 'reset':
      return INITIAL_UPDATE_STATE;
    default:
      return state;
  }
}

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

/** 用户取消下载：不算网络失败，状态回到 idle。 */
export class DownloadCancelledError extends Error {
  constructor() {
    super('已取消下载');
    this.name = 'DownloadCancelledError';
  }
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
 * 流式下载：有 `ReadableStream` 就逐块累计并回调进度，没有就一次性读完。
 * 取消既靠 fetch 的 signal，也在每块之间检查——测试桩不实现 signal 时同样能停下。
 */
export async function downloadBytes(request: DownloadRequest): Promise<Uint8Array> {
  const doFetch = request.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('当前环境无法联网下载更新');
  const response = await doFetch(request.url, request.signal === undefined ? {} : { signal: request.signal });
  if (!response.ok) throw new Error(`更新源返回 ${response.status}`);

  const header = Number(response.headers?.get('content-length') ?? '');
  const headerTotal = Number.isFinite(header) && header > 0 ? header : null;
  const reader =
    response.body !== null && typeof response.body?.getReader === 'function' ? response.body.getReader() : null;
  if (reader === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    request.onProgress?.({ received: bytes.length, total: headerTotal ?? bytes.length });
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  /** 取消时先关掉流：正卡在 read() 上的下载也能立刻结束 */
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  request.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      if (isCancelled(request.signal)) throw new DownloadCancelledError();
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      chunks.push(value);
      received += value.length;
      request.onProgress?.({ received, total: headerTotal });
    }
  } finally {
    request.signal?.removeEventListener('abort', onAbort);
  }
  if (isCancelled(request.signal)) throw new DownloadCancelledError();
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
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
 * 下载 → 校验 → 写盘 → 交给系统安装器。校验不通过或没有校验文件时一律不安装。
 * 取消（signal）回到 idle；其余异常给 failed + 可读原因，界面可重试。
 */
export async function runUpdateDownload(options: RunUpdateDownloadOptions): Promise<UpdateDownloadState> {
  let state = INITIAL_UPDATE_STATE;
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
    const bytes = await downloadBytes({
      url: plan.target.url,
      ...(signal === undefined ? {} : { signal }),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
      onProgress: (progress) =>
        emit({ type: 'progress', received: progress.received, total: progress.total ?? plan.target.size }),
    });
    emit({ type: 'verify' });
    const expected = await expectedDigest(plan.target, host, signal);
    if (expected === null) throw new Error('这次发布没有提供校验文件，已停止安装');
    const actual = await sha256Hex(bytes);
    if (!digestMatches(actual, expected)) {
      throw new Error(`安装包校验失败（应为 ${shortened(expected)}，实际 ${shortened(actual)}）`);
    }
    emit({ type: 'install' });
    const path = await host.write(plan.target.fileName, bytes);
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

/** 下载进度文案：`已下载 12.3 MB / 45.0 MB（27%）`；总长未知时省略总量与百分比。 */
export function formatDownloadProgress(state: UpdateDownloadState): string {
  if (state.phase !== 'downloading') return state.message ?? '';
  const received = formatBytes(state.received);
  const total = state.total === null ? '' : ` / ${formatBytes(state.total)}`;
  const percent = state.progress === null ? '' : `（${Math.round(state.progress * 100)}%）`;
  return `已下载 ${received}${total}${percent}`;
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
