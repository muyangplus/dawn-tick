import { useSyncExternalStore } from 'react';
import type { Storage } from '@dawn-tick/core';
import type { UpdateStatus } from '../update.ts';
import { clearIgnoredVersion, readIgnoredVersion, writeIgnoredVersion } from '../lib/update-preferences.ts';

/**
 * 更新弹窗的唯一数据源：启动自检与设置页「检查更新」都发布同一份 `UpdateStatus`，
 * 由应用根节点的 `UpdateDialog` 统一消费，避免两处各写一套弹窗与数据形状。
 *
 * 「忽略此版本」也走这里：弹窗拿不到存储，由应用壳把存储绑定进来；
 * 忽略/取消忽略写入 `app_meta` 后同时刷新弹窗与设备页的更新区。
 */

export interface UpdatePrompt {
  status: UpdateStatus;
  /** 已忽略的版本；与最新版一致时弹窗给「取消忽略」入口 */
  ignoredVersion: string | null;
  /** 忽略当前发布的版本：写 `app_meta` 并关闭弹窗 */
  ignore: () => Promise<void>;
  /** 取消忽略：弹窗与设备页共用 */
  unignore: () => Promise<void>;
}

let current: UpdateStatus | null = null;
let boundStorage: Storage | null = null;
let ignoredVersion: string | null = null;
let snapshot: UpdatePrompt | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 重新组装快照：`ignoredVersion` 变了也要让弹窗重新渲染。 */
function rebuild(): void {
  snapshot =
    current === null
      ? null
      : { status: current, ignoredVersion, ignore: ignorePromptedVersion, unignore: unignoreUpdateVersion };
  emit();
}

/**
 * 绑定存储并读取已忽略的版本：应用壳就绪后调用一次；传 null 解绑（测试或存储不可用）。
 * 读取失败按「没有忽略」处理，不影响启动自检。
 */
export function bindUpdatePromptStorage(value: Storage | null): void {
  if (boundStorage === value) return;
  boundStorage = value;
  if (value === null) {
    ignoredVersion = null;
    rebuild();
    return;
  }
  void readIgnoredVersion(value).then((version) => {
    if (boundStorage !== value) return;
    ignoredVersion = version;
    rebuild();
  });
}

/** 当前已忽略的版本：手动检查的文案要用，不经过 React 订阅。 */
export function currentIgnoredVersion(): string | null {
  return ignoredVersion;
}

/** 忽略弹窗里的这个版本：写 `app_meta`，关闭弹窗；下次检查不再自动提示。 */
export async function ignorePromptedVersion(): Promise<void> {
  const status = current;
  if (status === null) return;
  const version = (status.manifest?.version ?? status.latest ?? '').trim();
  if (version === '') return;
  if (boundStorage !== null) await writeIgnoredVersion(boundStorage, version);
  ignoredVersion = version;
  current = null;
  rebuild();
}

/**
 * 取消忽略：设备页与更新弹窗共用。
 * `storage` 可显式传入（设备页手上就有一份），不传则用绑定进来的同一份存储。
 */
export async function unignoreUpdateVersion(storage: Storage | null = boundStorage): Promise<void> {
  if (storage !== null) await clearIgnoredVersion(storage);
  if (ignoredVersion === null) return;
  ignoredVersion = null;
  rebuild();
}

/** 发布一份更新结果：手动检查不受忽略限制，只在严格更高时调用。 */
export function requestUpdatePrompt(status: UpdateStatus): void {
  current = status;
  rebuild();
}

export function closeUpdatePrompt(): void {
  if (current === null) return;
  current = null;
  rebuild();
}

export function updatePromptSnapshot(): UpdatePrompt | null {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdatePrompt(): UpdatePrompt | null {
  return useSyncExternalStore(subscribe, updatePromptSnapshot, updatePromptSnapshot);
}

/** 已忽略的版本：设备页更新区据此显示「已忽略的版本 + 取消忽略」。 */
export function useIgnoredUpdateVersion(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => ignoredVersion,
    () => ignoredVersion,
  );
}
