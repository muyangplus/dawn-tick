import { useSyncExternalStore } from 'react';

/**
 * 待重启登记（P1-06）：所有「改完要重启才生效」的路径只往这里登记来源，
 * 由设置页顶部 / 主壳的一条常驻条统一呈现，各路径不再各自渲染提示与重启按钮。
 */
export type PendingRestartSource =
  | 'storage-path'
  | 'wal'
  | 'snapshot-restore'
  | 'webdav-restore'
  | 'remote-restore'
  | 'preset-update';

/** 来源只用于去重与计数；界面不逐条罗列，避免又变成多处置提示。 */
let current: readonly PendingRestartSource[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 登记一项待重启改动；同一来源重复登记只算一项。 */
export function registerPendingRestart(source: PendingRestartSource): void {
  if (current.includes(source)) return;
  current = [...current, source];
  emit();
}

/** 重启后（或测试收尾）清空登记。 */
export function clearPendingRestart(): void {
  if (current.length === 0) return;
  current = [];
  emit();
}

export function pendingRestartSources(): readonly PendingRestartSource[] {
  return current;
}

export function subscribePendingRestart(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 组件读取：返回稳定的来源数组，只在登记变化时重渲染。 */
export function usePendingRestartSources(): readonly PendingRestartSource[] {
  return useSyncExternalStore(subscribePendingRestart, pendingRestartSources, pendingRestartSources);
}
