import type { UpdateAsset, UpdateManifest } from '../update.ts';
import { downloadChunked, type DownloadProgress } from './chunked-download.ts';
import { errorMessage } from './errors.ts';

/**
 * 自动更新（I-03）的下载、校验与安装：纯逻辑 + 可注入的平台出口。
 *
 * 边界：
 * - 渠道 → 资产、SHA-256、状态机都是纯函数，单测不碰网络与原生；
 * - 并发分片下载在 `chunked-download.ts`，这里只负责把进度折进界面消费的状态；
 * - 平台出口 `UpdateDownloadHost` 只定义契约，具体实现（Tauri 写盘 / Capacitor）在 `update-install.ts`；
 * - 界面只消费 `UpdateDownloadState`，失败原因原样交给界面用 `fail()` 拼句。
 */

/** 进度与取消错误定义在下载引擎里，这里原样转出，调用方不必换导入路径。 */
export { DownloadCancelledError, type DownloadProgress } from './chunked-download.ts';

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
  /** 发布里的原始文件名：在 `SHA256SUMS.txt` 里按它取摘要 */
  assetName: string;
  /** 发布里 `SHA256SUMS.txt` 的地址 */
  checksumsUrl: string | null;
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
      assetName: asset.name ?? fileNameFromUrl(asset.url),
      checksumsUrl: manifest?.checksumsUrl ?? null,
      sha256: asset.sha256 ?? null,
    },
  };
}

const SHA256_TEXT = /([0-9a-f]{64})/i;

/** `sha256sum` 的一行：`<64 位 hex>  <文件名>`（文本模式两个空格，二进制模式带 `*`）。 */
const CHECKSUM_LINE = /^([0-9a-f]{64})[ \t]+\*?(.+?)\s*$/i;

/** 从裸摘要或 `摘要  文件名` 文本里取出摘要。 */
export function parseSha256(text: string): string | null {
  return SHA256_TEXT.exec(text)?.[1]?.toLowerCase() ?? null;
}

/**
 * 解析发布里的 `SHA256SUMS.txt`：返回「小写文件名 → 摘要」。
 * 以 `#` 开头的注释行与空行跳过；文件名只取最后一段，避免 `./` 或路径前缀影响匹配。
 */
export function parseChecksums(text: string): Record<string, string> {
  const table: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const matched = CHECKSUM_LINE.exec(trimmed);
    if (matched === null) continue;
    const digest = matched[1] ?? '';
    const rawName = matched[2] ?? '';
    if (digest === '' || rawName === '') continue;
    const base = rawName.split('/').pop() ?? rawName;
    table[base.toLowerCase()] = digest.toLowerCase();
  }
  return table;
}

/** 资产地址里最后一段文件名（测试桩与相对地址也能用）。 */
function fileNameFromUrl(url: string): string {
  const pathname = url.split('?')[0] ?? url;
  return pathname.split('/').pop() ?? pathname;
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
  if (plan.kind === 'refresh') return emit({ type: 'done', message: '新版本已发布，刷新页面后生效' });
  if (plan.kind === 'unavailable') return emit({ type: 'fail', error: plan.reason });

  emit({ type: 'start' });
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
    if (expected === null) throw new Error('这次发布没有提供校验文件，已停止安装');
    const actual = await sha256Hex(bytes);
    if (!digestMatches(actual, expected)) {
      throw new Error(`安装包校验失败（应为 ${shortened(expected)}，实际 ${shortened(actual)}）`);
    }
    emit({ type: 'install' });
    const path = await host.write(plan.target.fileName, bytes);
    if (mode === 'prepare') return emit({ type: 'done', path, message: '安装包已下载并通过校验，可以安装了' });
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

/** 进度文案：`已下载 12.3 MB / 45.0 MB（27%）`；总长未知时省略总量与百分比。 */
export function formatByteProgress(received: number, total: number | null, percent: number | null): string {
  const receivedText = formatBytes(received);
  const totalText = total === null ? '' : ` / ${formatBytes(total)}`;
  const percentText = percent === null ? '' : `（${Math.round(percent * 100)}%）`;
  return `已下载 ${receivedText}${totalText}${percentText}`;
}

export function formatDownloadProgress(state: UpdateDownloadState): string {
  if (state.phase !== 'downloading') return state.message ?? '';
  return formatByteProgress(state.received, state.total, state.progress);
}

/** 进度明细：`速度 4.2 MB/s · 剩余 12 秒`；速度/剩余都算不出来时返回空串。 */
export function formatDownloadDetail(progress: DownloadProgress): string {
  const parts: string[] = [];
  if (progress.speedBytesPerSec !== null) parts.push(`速度 ${formatBytes(progress.speedBytesPerSec)}/s`);
  if (progress.etaSeconds !== null) parts.push(`剩余 ${formatEta(progress.etaSeconds)}`);
  return parts.join(' · ');
}

/** 剩余时间按人读的粒度取整：不到 1 分钟说秒，超过 1 小时说小时+分钟。 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '不足 1 秒';
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${Math.round(seconds % 60)} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
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
