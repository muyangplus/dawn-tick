import { useSyncExternalStore } from 'react';
import type { UpdateStatus } from '../update.ts';

/**
 * 更新弹窗的唯一数据源：启动自检与设置页「检查更新」都发布同一份 `UpdateStatus`，
 * 由应用根节点的 `UpdateDialog` 统一消费，避免两处各写一套弹窗与数据形状。
 */
let current: UpdateStatus | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 发现可用更新：发布给更新弹窗（只在严格更高版本时调用）。 */
export function requestUpdatePrompt(status: UpdateStatus): void {
  current = status;
  emit();
}

export function closeUpdatePrompt(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function updatePromptSnapshot(): UpdateStatus | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdatePrompt(): UpdateStatus | null {
  return useSyncExternalStore(subscribe, updatePromptSnapshot, updatePromptSnapshot);
}
