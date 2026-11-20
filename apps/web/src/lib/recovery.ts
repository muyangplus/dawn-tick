/**
 * 错误页的「从备份文件恢复」：损坏时数据库还打不开，不能走 Storage，
 * 因此这里复用原生文件快照（tauri 的 list_backups / restore_backup）——
 * 它们不读写数据库，只排队一次恢复请求，重启时由 Rust 侧覆盖。
 */
import type { Collection, Storage, StoreName } from '@dawn-tick/core';
import { listSnapshots, restoreSnapshot, type SnapshotEntry } from '../backup.ts';
import { describeError, logError, logInfo } from '../log.ts';
import { snapshotsCopy } from '../copy/backup-snapshots.ts';

/** 文件快照路径不需要 Storage；给备份函数一个占位对象，避免为恢复再造一条存储入口。 */
const UNAVAILABLE_STORAGE = {
  kind: 'memory',
  collection: (): Collection<unknown> => {
    throw new Error(snapshotsCopy.recoveryNoStorage);
  },
  readMeta: async (): Promise<undefined> => undefined,
  writeMeta: async (): Promise<void> => {
    throw new Error(snapshotsCopy.recoveryNoStorage);
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
    logError('backup', '备份列表读取失败', { message });
    return { ok: false, name: null, error: snapshotsCopy.recoveryListFailed };
  }
  const latest = entries[0];
  if (latest === undefined) {
    return { ok: false, name: null, error: snapshotsCopy.recoveryNoSnapshot };
  }
  const outcome = await restoreSnapshot(UNAVAILABLE_STORAGE, latest);
  if (!outcome.ok) {
    return { ok: false, name: latest.id, error: outcome.error ?? snapshotsCopy.recoveryFailed };
  }
  logInfo('backup', '最近快照已排队恢复', { name: latest.id, kind: latest.kind });
  return { ok: true, name: latest.id, error: null };
}
