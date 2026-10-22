import { useSyncExternalStore } from 'react';
import type { UpdateDownloadHost, UpdatePlan } from './update-download.ts';
import {
  installPreparedUpdate,
  runUpdateDownload,
  type UpdateDownloadState,
} from './update-download.ts';

/**
 * 后台更新任务：与弹窗解耦的单一事实来源。
 *
 * 边界：
 * - store 持有一份 `UpdateTaskState`，弹窗与设备页都订阅它；关闭弹窗不会取消下载；
 * - 下载/校验仍走 `update-download.ts` 的状态机（`deferInstall` 停在 ready），
 *   这里只做「后台任务视角」的映射与状态迁移（纯函数 `reduceUpdateTask`，单测不碰网络）；
 * - 平台出口与 fetch 由调用方注入，单测与冒烟都用桩，不加载原生模块。
 *
 * 生命周期：idle → downloading → verifying → ready（落盘并校验通过）→ ready(installed)；
 * 任一进行中阶段可 cancelled；failed/cancelled 可用同一份 start 输入重试。
 */

export type UpdateTaskStatus = 'idle' | 'downloading' | 'verifying' | 'ready' | 'failed' | 'cancelled';

/** ready 后要做什么：桌面/安卓交给安装器，Web 只能刷新页面。 */
export type UpdateTaskAction = 'install' | 'refresh';

export interface UpdateTaskState {
  status: UpdateTaskStatus;
  /** 该任务对应的目标版本 */
  version: string | null;
  /** 就绪后的动作 */
  action: UpdateTaskAction | null;
  /** 已接收字节 */
  received: number;
  /** 总字节；未知时为 null */
  total: number | null;
  /** 0–1 的进度 */
  progress: number | null;
  /** 瞬时速度（字节/秒） */
  bytesPerSecond: number | null;
  /** 剩余时间估算（毫秒） */
  remainingMs: number | null;
  /** 当前阶段的可读说明 */
  message: string | null;
  /** 失败原因（原始一句话，展示时由界面用 fail() 拼完整句） */
  error: string | null;
  /** 落盘路径：ready 后安装器要用 */
  path: string | null;
  /** Android 未授权「安装未知应用」时为 true */
  needsPermission: boolean;
  /** 安装器/刷新已经触发：就绪区不再给按钮，只留结果文案 */
  installed: boolean;
  /** 正在启动安装器：按钮临时禁用 */
  installing: boolean;
}

export const IDLE_UPDATE_TASK: UpdateTaskState = {
  status: 'idle',
  version: null,
  action: null,
  received: 0,
  total: null,
  progress: null,
  bytesPerSecond: null,
  remainingMs: null,
  message: null,
  error: null,
  path: null,
  needsPermission: false,
  installed: false,
  installing: false,
};

export type UpdateTaskEvent =
  | { type: 'start'; version: string; action: UpdateTaskAction }
  | { type: 'download'; state: UpdateDownloadState }
  | { type: 'failed'; version: string | null; error: string }
  | { type: 'cancelled' }
  | { type: 'installing' }
  | { type: 'installed'; message: string }
  | { type: 'reset' };

/**
 * 下载状态 → 后台任务状态。`deferInstall` 的 ready 与安装后的 done 都映射到 `ready`，
 * 后者额外标 `installed`，设备页据此收起「安装」按钮。
 */
function fromDownload(state: UpdateDownloadState, current: UpdateTaskState): UpdateTaskState {
  switch (state.phase) {
    case 'downloading':
      return {
        ...current,
        status: 'downloading',
        received: state.received,
        total: state.total,
        progress: state.progress,
        bytesPerSecond: state.bytesPerSecond,
        remainingMs: state.remainingMs,
        message: state.message,
        error: null,
        needsPermission: false,
      };
    case 'verifying':
      return {
        ...current,
        status: 'verifying',
        progress: 1,
        bytesPerSecond: null,
        remainingMs: null,
        message: state.message,
        error: null,
      };
    case 'ready':
      return {
        ...current,
        status: 'ready',
        total: state.total ?? current.total,
        progress: 1,
        bytesPerSecond: null,
        remainingMs: null,
        message: state.message,
        error: null,
        path: state.path ?? current.path,
        needsPermission: false,
      };
    case 'installing':
      return { ...current, installing: true, message: state.message };
    case 'done':
      return {
        ...current,
        status: 'ready',
        installed: true,
        installing: false,
        progress: 1,
        bytesPerSecond: null,
        remainingMs: null,
        message: state.message,
        error: null,
        path: state.path ?? current.path,
        needsPermission: false,
      };
    case 'failed':
      return {
        ...current,
        status: 'failed',
        installing: false,
        bytesPerSecond: null,
        remainingMs: null,
        error: state.error,
        needsPermission: state.needsPermission,
        path: state.path ?? current.path,
      };
    case 'idle':
      return {
        ...current,
        status: 'cancelled',
        installing: false,
        bytesPerSecond: null,
        remainingMs: null,
        message: state.message ?? '已取消下载',
        error: null,
      };
    default:
      // checking 等与后台任务无关的阶段不改变任务状态
      return current;
  }
}

/** 后台任务纯状态机：非法事件原样返回，迁移规则集中在这里便于单测。 */
export function reduceUpdateTask(state: UpdateTaskState, event: UpdateTaskEvent): UpdateTaskState {
  switch (event.type) {
    case 'start':
      return {
        ...IDLE_UPDATE_TASK,
        status: event.action === 'refresh' ? 'ready' : 'downloading',
        version: event.version,
        action: event.action,
        ...(event.action === 'refresh'
          ? { progress: 1, message: '新版本已发布，刷新页面后生效' }
          : { message: '正在下载安装包…' }),
      };
    case 'download':
      return fromDownload(event.state, state);
    case 'failed':
      return {
        ...state,
        status: 'failed',
        version: event.version ?? state.version,
        installing: false,
        bytesPerSecond: null,
        remainingMs: null,
        error: event.error,
        message: null,
      };
    case 'cancelled':
      return {
        ...state,
        status: 'cancelled',
        installing: false,
        bytesPerSecond: null,
        remainingMs: null,
        message: '已取消下载',
        error: null,
      };
    case 'installing':
      return { ...state, installing: true, message: '正在启动安装程序…' };
    case 'installed':
      return {
        ...state,
        status: 'ready',
        installed: true,
        installing: false,
        message: event.message,
        error: null,
        needsPermission: false,
      };
    case 'reset':
      return IDLE_UPDATE_TASK;
    default:
      return state;
  }
}

/** 正在下载/校验：界面提供「取消下载」。 */
export function isUpdateTaskBusy(state: UpdateTaskState): boolean {
  return state.status === 'downloading' || state.status === 'verifying';
}

/** 后台任务是否需要占位：设备页常驻区只在有内容（非 idle）时出现。 */
export function isUpdateTaskActive(state: UpdateTaskState): boolean {
  return state.status !== 'idle';
}

export interface StartUpdateTaskInput {
  /** 目标版本：弹窗拿的是 `status.latest` */
  version: string;
  plan: UpdatePlan;
  host: UpdateDownloadHost;
  /** 覆盖下载用的 fetch（测试桩与冒烟桩） */
  fetchImpl?: typeof fetch;
}

export interface UpdateTaskStoreOptions {
  /** 测试注入：Web 渠道「刷新页面」的实现 */
  reload?: () => void;
}

export interface UpdateTaskStore {
  getState: () => UpdateTaskState;
  subscribe: (listener: () => void) => () => void;
  start: (input: StartUpdateTaskInput) => Promise<UpdateTaskState>;
  /** 取消正在进行的下载；已就绪的安装包保留，可再次安装 */
  cancel: () => void;
  /** 用最近一次输入重跑（失败/取消后） */
  retry: () => Promise<UpdateTaskState>;
  /** 就绪后启动安装器；Web 渠道换成刷新页面 */
  install: () => Promise<UpdateTaskState>;
  reset: () => void;
}

/**
 * 创建后台任务 store（单测与冒烟用工厂，应用用下面的模块级单例）。
 * 只保留一个任务：开始新任务会中止旧的，避免两份安装包抢带宽。
 */
export function createUpdateTaskStore(options: UpdateTaskStoreOptions = {}): UpdateTaskStore {
  let state = IDLE_UPDATE_TASK;
  let controller: AbortController | null = null;
  let currentHost: UpdateDownloadHost | null = null;
  let lastInput: StartUpdateTaskInput | null = null;
  const listeners = new Set<() => void>();
  const reload =
    options.reload ??
    ((): void => {
      globalThis.location?.reload();
    });

  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  const apply = (event: UpdateTaskEvent): UpdateTaskState => {
    state = reduceUpdateTask(state, event);
    emit();
    return state;
  };

  async function start(input: StartUpdateTaskInput): Promise<UpdateTaskState> {
    controller?.abort();
    controller = null;
    lastInput = input;
    currentHost = input.host;

    if (input.plan.kind === 'unavailable') {
      apply({ type: 'start', version: input.version, action: 'install' });
      return apply({ type: 'failed', version: input.version, error: input.plan.reason });
    }
    if (input.plan.kind === 'refresh') {
      return apply({ type: 'start', version: input.version, action: 'refresh' });
    }

    const token = new AbortController();
    controller = token;
    apply({ type: 'start', version: input.version, action: 'install' });
    const final = await runUpdateDownload({
      plan: input.plan,
      host: input.host,
      signal: token.signal,
      deferInstall: true,
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      onState: (next) => {
        if (controller === token) apply({ type: 'download', state: next });
      },
    });
    if (controller !== token) return state;
    controller = null;
    return apply({ type: 'download', state: final });
  }

  function cancel(): void {
    const running = controller;
    controller = null;
    running?.abort();
    if (isUpdateTaskBusy(state)) apply({ type: 'cancelled' });
  }

  async function retry(): Promise<UpdateTaskState> {
    if (lastInput === null) return state;
    return start(lastInput);
  }

  async function install(): Promise<UpdateTaskState> {
    if (state.status !== 'ready' || state.installed || state.installing) return state;
    if (state.action === 'refresh') {
      apply({ type: 'installed', message: '请刷新页面后使用新版本' });
      reload();
      return state;
    }
    const host = currentHost;
    const path = state.path;
    if (host === null || path === null) {
      return apply({ type: 'failed', version: state.version, error: '安装包还没有准备好，请重新下载' });
    }
    apply({ type: 'installing' });
    await installPreparedUpdate({
      host,
      path,
      onState: (next) => apply({ type: 'download', state: next }),
    });
    return state;
  }

  function reset(): void {
    controller?.abort();
    controller = null;
    currentHost = null;
    lastInput = null;
    state = IDLE_UPDATE_TASK;
    emit();
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    cancel,
    retry,
    install,
    reset,
  };
}

/** 应用唯一的后台任务实例：弹窗与设备页都从这里读。 */
export const updateTaskStore = createUpdateTaskStore();

export function useUpdateTask(): UpdateTaskState {
  return useSyncExternalStore(updateTaskStore.subscribe, updateTaskStore.getState, updateTaskStore.getState);
}

export function startUpdateTask(input: StartUpdateTaskInput): Promise<UpdateTaskState> {
  return updateTaskStore.start(input);
}

export function cancelUpdateTask(): void {
  updateTaskStore.cancel();
}

export function retryUpdateTask(): Promise<UpdateTaskState> {
  return updateTaskStore.retry();
}

export function installUpdateTask(): Promise<UpdateTaskState> {
  return updateTaskStore.install();
}

export function resetUpdateTask(): void {
  updateTaskStore.reset();
}
