/**
 * 错误页的「从备份文件恢复」：损坏时数据库还打不开，不能走 Storage，
 * 因此这里复用原生文件快照（tauri 的 list_backups / restore_backup）——
 * 它们不读写数据库，只排队一次恢复请求，重启时由 Rust 侧覆盖。
 */
import type { Collection, Storage, StoreName } from '@dawn-tick/core';
import { listSnapshots, restoreSnapshot, type SnapshotEntry } from '../backup.ts';
import { describeError, logInfo, logWarn } from '../log.ts';

/** 文件快照路径不需要 Storage；给备份函数一个占位对象，避免为恢复再造一条存储入口。 */
const UNAVAILABLE_STORAGE = {
  kind: 'memory',
  collection: (): Collection<unknown> => {
    throw new Error('恢复备份不使用本地存储');
  },
  readMeta: async (): Promise<undefined> => undefined,
  writeMeta: async (): Promise<void> => {
    throw new Error('恢复备份不使用本地存储');
  },
  close: async (): Promise<void> => {},
} as unknown as Storage;

export interface LatestBackupResult {
  ok: boolean;
  /** 已排队恢复的快照名；失败时为 null 或最近找到的名字 */
  name: string | null;
  error: string | null;
}

/**
 * 用最近一份备份排队恢复。只处理文件快照（Windows）；
 * 其它平台没有不依赖 Storage 的恢复入口，返回可展示的失败原因。
 */
export async function restoreLatestBackupSnapshot(): Promise<LatestBackupResult> {
  let entries: SnapshotEntry[];
  try {
    entries = await listSnapshots(UNAVAILABLE_STORAGE);
  } catch (cause: unknown) {
    const message = describeError(cause);
    logWarn('backup', '读取备份列表失败', { message });
    return { ok: false, name: null, error: '当前平台无法读取备份目录' };
  }
  const latest = entries[0];
  if (latest === undefined) {
    return { ok: false, name: null, error: '备份目录里没有可用快照' };
  }
  const outcome = await restoreSnapshot(UNAVAILABLE_STORAGE, latest);
  if (!outcome.ok) {
    return { ok: false, name: latest.id, error: outcome.error ?? '恢复快照失败' };
  }
  logInfo('backup', '已排队恢复备份快照', { name: latest.id, kind: latest.kind });
  return { ok: true, name: latest.id, error: null };
}
