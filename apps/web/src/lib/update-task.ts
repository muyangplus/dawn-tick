import { useSyncExternalStore } from 'react';
import type { UpdateChannel, UpdateManifest } from '../update.ts';
import type { DownloadProgress } from './chunked-download.ts';
import { errorMessage } from './errors.ts';
import {
  planUpdateDownload,
  prepareUpdateDownload,
  type UpdateDownloadHost,
  type UpdateDownloadState,
  type UpdatePlan,
  type UpdatePlatform,
  type WindowsInstallKind,
} from './update-download.ts';
import { createUpdateHost, detectWindowsInstallKind, updatePlatform } from './update-install.ts';

/**
 * 后台更新任务：下载不再绑在弹窗上，关掉弹窗也不会中断，再次打开弹窗或到设备页看到的是同一份进度。
 * 模块级单例 store（订阅式）；状态 downloading → verifying → ready / failed / cancelled；
 * 下载与安装分开：`startBackgroundUpdate` 只下载+校验+写盘，装不装由用户点「安装」决定。
 */

/** 后台任务状态。`verifying` 覆盖校验与写盘两个阶段，界面上都算「正在准备安装包」。 */
export type UpdateTaskStatus = 'idle' | 'downloading' | 'verifying' | 'ready' | 'failed' | 'cancelled';

/** 目标安装器信息：ready 后界面据此显示「装的是什么、交给谁」。 */
export interface UpdateTaskTarget {
  platform: UpdatePlatform;
  version: string;
  /** 安装方式：安装版交给安装程序，便携版退出后覆盖 exe */
  kind: 'installer' | 'portable';
  /** 安装包落盘名；Web 渠道没有安装包 */
  fileName: string | null;
  /** 已落盘路径（桌面绝对路径 / Android `file://` URI）；未写盘或 Web 为 null */
  path: string | null;
  /** 交给谁：Windows 安装程序 / Windows 便携替换 / Android 安装器 / 刷新页面 */
  installerLabel: string;
}

export interface UpdateTask {
  status: UpdateTaskStatus;
  /** 目标版本；还没确定时为 null */
  version: string | null;
  channel: UpdateChannel | null;
  progress: DownloadProgress | null;
  error: string | null;
  needsPermission: boolean;
  target: UpdateTaskTarget | null;
  /** 状态说明：正在下载/校验/已就绪等 */
  message: string | null;
  /** 已交给系统安装器：避免重复点「安装」 */
  installed: boolean;
  updatedAt: number;
}

export const IDLE_UPDATE_TASK: UpdateTask = {
  status: 'idle',
  version: null,
  channel: null,
  progress: null,
  error: null,
  needsPermission: false,
  target: null,
  message: null,
  installed: false,
  updatedAt: 0,
};

/** 开始任务时可注入的出口：冒烟与单测用它替换真实网络/原生写盘，正常界面不传。 */
export interface StartUpdateOptions {
  platform?: UpdatePlatform;
  host?: UpdateDownloadHost;
  fetchImpl?: typeof fetch;
  /** Windows 运行形态：单测/冒烟显式注入，正常界面从原生命令检测 */
  installKind?: WindowsInstallKind;
}

let task: UpdateTask = IDLE_UPDATE_TASK;
let controller: AbortController | null = null;
/** 安装动作互斥：解压/启动安装程序期间重复点击不重复触发。 */
let installing = false;
let host: UpdateDownloadHost | null = null;
let lastManifest: UpdateManifest | null = null;
let lastOptions: StartUpdateOptions = {};
const listeners = new Set<() => void>();
let snapshot: UpdateTask = task;

function emit(): void {
  for (const listener of listeners) listener();
}

function setTask(next: UpdateTask): void {
  task = next;
  snapshot = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateTaskSnapshot(): UpdateTask {
  return snapshot;
}

export function useUpdateTask(): UpdateTask {
  return useSyncExternalStore(subscribe, updateTaskSnapshot, updateTaskSnapshot);
}

/** 订阅任务变化：非 React 场景（冒烟、单测）用它收集状态迁移。 */
export function subscribeUpdateTask(listener: () => void): () => void {
  return subscribe(listener);
}

function installerLabelOf(platform: UpdatePlatform, kind: UpdateTaskTarget['kind']): string {
  if (platform === 'windows') {
    return kind === 'portable' ? 'Windows 便携包（退出后替换）' : 'Windows 安装程序';
  }
  return platform === 'android' ? 'Android 安装器' : '刷新页面';
}

function buildTarget(plan: UpdatePlan, platform: UpdatePlatform, version: string | null): UpdateTaskTarget {
  const fileName = plan.kind === 'download' ? plan.target.fileName : null;
  const kind = plan.kind === 'download' ? plan.target.kind : 'installer';
  return {
    platform,
    version: version ?? '',
    kind,
    fileName,
    path: null,
    installerLabel: installerLabelOf(platform, kind),
  };
}

/** 下载状态 → 任务状态：`installing`（写盘）归到 verifying，界面上都是「准备安装包」。 */
function statusOfDownload(state: UpdateDownloadState): UpdateTaskStatus {
  switch (state.phase) {
    case 'downloading':
      return 'downloading';
    case 'verifying':
    case 'installing':
      return 'verifying';
    case 'done':
      return 'ready';
    case 'failed':
      return 'failed';
    default:
      // 只有取消会让流程回到 idle
      return 'cancelled';
  }
}

/** 保留引擎给的速度/剩余时间，只把字节数与百分比换成状态机里的最新值。 */
function mergeProgress(previous: DownloadProgress | null, state: UpdateDownloadState): DownloadProgress | null {
  if (state.phase !== 'downloading') return previous;
  const { received, total, progress: percent } = state;
  if (previous === null) return { received, total, percent, speedBytesPerSec: null, etaSeconds: null };
  return { ...previous, received, total, percent };
}

function mergeState(previous: UpdateTask, state: UpdateDownloadState): UpdateTask {
  return {
    ...previous,
    status: statusOfDownload(state),
    progress: mergeProgress(previous.progress, state),
    error: state.error,
    needsPermission: state.needsPermission,
    message: state.message,
    target: previous.target === null || state.path === null ? previous.target : { ...previous.target, path: state.path },
    updatedAt: Date.now(),
  };
}

/**
 * 开始（或替换）后台下载：关弹窗不影响它，再次打开弹窗/到设备页读同一份任务。
 * 返回最终任务，调用方可以 await（界面不 await，只订阅）。
 */
export async function startBackgroundUpdate(
  manifest: UpdateManifest | null,
  options: StartUpdateOptions = {},
): Promise<UpdateTask> {
  controller?.abort();
  controller = null;
  lastManifest = manifest;
  lastOptions = options;
  const platform = options.platform ?? updatePlatform();
  const version = manifest?.version ?? null;
  // Windows 要先知道是便携版还是安装版，才能决定下 zip 还是 exe；检测失败按便携版。
  const installKind =
    platform === 'windows'
      ? (options.installKind ?? (await detectWindowsInstallKind()))
      : undefined;
  const plan = planUpdateDownload(manifest, platform, installKind);
  const base: UpdateTask = {
    ...IDLE_UPDATE_TASK,
    version,
    channel: manifest?.channel ?? null,
    target: buildTarget(plan, platform, version),
    updatedAt: Date.now(),
  };

  if (plan.kind === 'unavailable') {
    setTask({ ...base, status: 'failed', error: plan.reason });
    return task;
  }
  if (plan.kind === 'refresh') {
    setTask({ ...base, status: 'ready', message: '新版本已发布，刷新页面后生效' });
    return task;
  }
  if (platform === 'web') {
    setTask({ ...base, status: 'failed', error: '当前环境没有可自动安装的安装包，请到发布页下载' });
    return task;
  }

  const active = new AbortController();
  controller = active;
  host = options.host ?? createUpdateHost(platform === 'android' ? 'android' : 'windows', options.fetchImpl);
  setTask({ ...base, status: 'downloading', message: '正在下载安装包…' });

  const final = await prepareUpdateDownload({
    plan,
    host,
    signal: active.signal,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    onState: (state) => {
      if (controller !== active) return;
      setTask(mergeState(task, state));
    },
    onProgress: (progress) => {
      if (controller !== active) return;
      setTask({ ...task, progress, updatedAt: Date.now() });
    },
  });
  if (controller === active) {
    controller = null;
    setTask(mergeState(task, final));
  }
  return task;
}

/** 取消：中止网络并回到「已取消」；已下载的部分作废，重新开始会从头下载。 */
export function cancelUpdateTask(): void {
  if (controller !== null) {
    controller.abort();
    return;
  }
  if (task.status === 'downloading' || task.status === 'verifying') {
    setTask({ ...task, status: 'cancelled', message: '已取消下载', updatedAt: Date.now() });
  }
}

/** 失败/取消后重试：授权类失败直接重试安装，其余沿用最近一次清单与出口重新下载。 */
export function retryUpdateTask(): Promise<UpdateTask> {
  // Android 授权失败时安装包已经落盘：授权后只需再交给安装器，不必重新下载
  if (task.status === 'failed' && task.needsPermission && task.target !== null && task.target.path !== null) {
    return installUpdateTask().then(() => task);
  }
  if (lastManifest === null) return Promise.resolve(task);
  return startBackgroundUpdate(lastManifest, lastOptions);
}

/**
 * 安装已经就绪的更新：
 * - 安装版 → 交给 `run_installer`（exe/msi）或 Android `ApkInstaller`；
 * - 便携版 → 先解压并准备替换脚本，再退出应用让脚本覆盖 exe 并重启；
 * - Web 没有安装包，动作是刷新页面（由界面按钮触发实际刷新）。
 */
export async function installUpdateTask(): Promise<void> {
  const current = task;
  // ready 是常规入口；授权类失败时安装包已落盘，授权后也允许再交给安装器
  const authorizedRetry = current.status === 'failed' && current.needsPermission;
  if ((current.status !== 'ready' && !authorizedRetry) || current.target === null || current.installed) return;
  if (installing) return;
  if (current.target.platform === 'web') {
    setTask({ ...current, status: 'ready', installed: true, message: '刷新页面后生效', updatedAt: Date.now() });
    return;
  }
  const target = current.target;
  if (target.path === null) {
    setTask({ ...current, status: 'failed', error: '安装包路径丢失，请重新下载', updatedAt: Date.now() });
    return;
  }
  const installer = host ?? createUpdateHost(target.platform === 'android' ? 'android' : 'windows');
  installing = true;
  try {
    if (target.kind === 'portable') {
      if (installer.installPortable === undefined || installer.exitForUpdate === undefined) {
        throw new Error('当前平台不支持便携版自动替换，请到发布页手动下载');
      }
      await installer.installPortable(target.path);
      if (task !== current) return;
      // 先置成已安装，界面立即禁用「安装」并显示退出提示；随后退出由替换脚本接手
      setTask({
        ...current,
        status: 'ready',
        installed: true,
        message: '更新已准备，应用将退出并自动替换，随后重新启动',
        updatedAt: Date.now(),
      });
      try {
        await installer.exitForUpdate();
      } catch (cause: unknown) {
        setTask({
          ...updateTaskSnapshot(),
          status: 'failed',
          installed: false,
          error: `更新已准备，但自动退出失败（${errorMessage(cause)}），请手动退出应用以完成替换`,
          updatedAt: Date.now(),
        });
      }
      return;
    }
    const outcome = await installer.install(target.path);
    if (task !== current) return;
    if (outcome.needsPermission) {
      setTask({
        ...current,
        status: 'failed',
        needsPermission: true,
        error: '已跳转系统设置，请允许安装未知应用后重试',
        updatedAt: Date.now(),
      });
      return;
    }
    setTask({
      ...current,
      status: 'ready',
      installed: true,
      message: '安装程序已启动，请按提示完成安装',
      updatedAt: Date.now(),
    });
  } catch (cause: unknown) {
    if (task !== current) return;
    setTask({ ...current, status: 'failed', error: errorMessage(cause, '启动安装程序失败'), updatedAt: Date.now() });
  } finally {
    installing = false;
  }
}

/** 关闭/清理任务：进行中先取消，再把 store 复位到 idle。 */
export function dismissUpdateTask(): void {
  controller?.abort();
  controller = null;
  host = null;
  setTask(IDLE_UPDATE_TASK);
}

/** 任务是否占用（下载/校验中）：界面据此禁用重复触发。 */
export function isUpdateTaskBusy(status: UpdateTaskStatus): boolean {
  return status === 'downloading' || status === 'verifying';
}
