import {
  BACKUP_MODULES,
  exportBackup,
  importBackup,
  parseBackup,
  type AppSettings,
  type ImportResult,
  type Storage,
} from '@dawn-tick/core';
import { detectPlatform } from './platform-detect.ts';
import { activeSqlDriver } from './db/active-driver.ts';
import { dayStampLocal } from './lib/dates.ts';
import { logInfo, logWarn } from './log.ts';

/** 数据库快照：Windows 用原生文件快照（VACUUM INTO 写 backups/），Web 与 Android 把 JSON 存进 app_meta。 */

export interface SnapshotEntry {
  /** 文件快照是文件名，JSON 快照是 app_meta 的键 */
  id: string;
  createdAt: number;
  bytes: number;
  kind: 'file' | 'json';
}

const SNAPSHOT_PREFIX = 'backup:';
/** 同一分钟内不重复做启动快照 */
const FRESH_MS = 60_000;

export function snapshotKind(): 'file' | 'json' {
  return detectPlatform() === 'tauri' ? 'file' : 'json';
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke<T>(command, args)) as T;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function listJsonSnapshots(storage: Storage): Promise<SnapshotEntry[]> {
  const rows = await storage.collection<{ key: string; value: string }>('app_meta').getAll();
  return rows
    .filter((row) => row.key.startsWith(SNAPSHOT_PREFIX))
    .map((row) => ({
      id: row.key,
      createdAt: Number(row.key.slice(SNAPSHOT_PREFIX.length)) || 0,
      bytes: row.value.length,
      kind: 'json' as const,
    }))
    .sort((left, right) => right.createdAt - left.createdAt);
}

async function listFileSnapshots(): Promise<SnapshotEntry[]> {
  try {
    const rows = await invokeTauri<Array<{ name: string; bytes: number; createdAt: number }>>(
      'list_backups',
    );
    return rows.map((row) => ({
      id: row.name,
      createdAt: row.createdAt,
      bytes: row.bytes,
      kind: 'file' as const,
    }));
  } catch (cause: unknown) {
    logWarn('backup', '读取快照列表失败', { message: describe(cause) });
    return [];
  }
}

/** 快照列表，最新的排在最前。 */
export async function listSnapshots(storage: Storage): Promise<SnapshotEntry[]> {
  return snapshotKind() === 'json' ? listJsonSnapshots(storage) : listFileSnapshots();
}

async function createJsonSnapshot(storage: Storage, now: number): Promise<SnapshotEntry> {
  const payload = await exportBackup(storage, { now, modules: BACKUP_MODULES });
  const value = JSON.stringify(payload);
  await storage.writeMeta(`${SNAPSHOT_PREFIX}${now}`, value);
  return { id: `${SNAPSHOT_PREFIX}${now}`, createdAt: now, bytes: value.length, kind: 'json' };
}

async function createFileSnapshot(now: number): Promise<SnapshotEntry> {
  const driver = activeSqlDriver();
  if (driver === null) throw new Error('数据库尚未打开');
  const target = await invokeTauri<{ name: string; path: string; sqlLiteral: string }>('backup_target');
  try {
    await driver.all(`VACUUM INTO ${target.sqlLiteral}`);
  } catch (cause: unknown) {
    // VACUUM INTO 失败会留下 0 字节文件，清掉；启动时的空快照清理兜底
    try {
      await invokeTauri('delete_backup', { name: target.name });
    } catch {
      // 清理失败只影响磁盘占用
    }
    throw cause;
  }
  const entries = await listFileSnapshots();
  return (
    entries.find((entry) => entry.id === target.name) ?? {
      id: target.name,
      createdAt: now,
      bytes: 0,
      kind: 'file' as const,
    }
  );
}

/** 启动自检结论：Windows 侧在打开数据库之前自检，读一次后清空。 */
export async function takeRecoveryNotice(): Promise<string | null> {
  if (detectPlatform() !== 'tauri') return null;
  try {
    const text = await invokeTauri<string | null>('recovery_notice');
    return typeof text === 'string' && text.trim() !== '' ? text : null;
  } catch (cause: unknown) {
    logWarn('backup', '读取启动自检结论失败', { message: describe(cause) });
    return null;
  }
}

/** 做一份快照；失败返回 null 并记日志。 */
export async function createSnapshot(
  storage: Storage,
  now = Date.now(),
): Promise<SnapshotEntry | null> {
  try {
    const entry =
      snapshotKind() === 'json'
        ? await createJsonSnapshot(storage, now)
        : await createFileSnapshot(now);
    logInfo('backup', '已生成快照', { kind: entry.kind, name: entry.id, bytes: entry.bytes });
    return entry;
  } catch (cause: unknown) {
    logWarn('backup', '生成快照失败', { message: describe(cause) });
    return null;
  }
}

export async function deleteSnapshot(storage: Storage, entry: SnapshotEntry): Promise<boolean> {
  try {
    if (entry.kind === 'json') {
      await storage.collection('app_meta').delete(entry.id);
    } else {
      await invokeTauri('delete_backup', { name: entry.id });
    }
    logInfo('backup', '已删除快照', { name: entry.id });
    return true;
  } catch (cause: unknown) {
    logWarn('backup', '删除快照失败', { name: entry.id, message: describe(cause) });
    return false;
  }
}

/** 只保留最新的 keep 份，返回删掉的份数。 */
export async function pruneSnapshots(storage: Storage, keep: number): Promise<number> {
  const entries = await listSnapshots(storage);
  const extra = entries.slice(Math.max(1, keep));
  if (extra.length === 0) return 0;
  if (snapshotKind() === 'file') {
    try {
      return await invokeTauri<number>('prune_backups', { keep: Math.max(1, keep) });
    } catch (cause: unknown) {
      logWarn('backup', '清理快照失败', { message: describe(cause) });
      return 0;
    }
  }
  let removed = 0;
  for (const entry of extra) {
    if (await deleteSnapshot(storage, entry)) removed += 1;
  }
  return removed;
}

export interface RestoreOutcome {
  ok: boolean;
  error: string | null;
  /** 需要重启才生效（文件快照） */
  needsRestart: boolean;
  result: ImportResult | null;
}

/** 恢复快照：文件快照排队到下次启动，JSON 快照当场覆盖数据。 */
export async function restoreSnapshot(
  storage: Storage,
  entry: SnapshotEntry,
): Promise<RestoreOutcome> {
  try {
    if (entry.kind === 'file') {
      await invokeTauri('restore_backup', { name: entry.id });
      return { ok: true, error: null, needsRestart: true, result: null };
    }
    const raw = await storage.readMeta(entry.id);
    if (raw === undefined) throw new Error('快照内容不存在');
    const payload = parseBackup(raw);
    const result = await importBackup(storage, payload, {
      mode: 'clear',
      modules: BACKUP_MODULES,
      now: Date.now(),
    });
    logInfo('backup', '已恢复快照', {
      name: entry.id,
      imported: result.imported,
      removed: result.removed,
    });
    return { ok: true, error: null, needsRestart: false, result };
  } catch (cause: unknown) {
    const message = describe(cause);
    logWarn('backup', '恢复快照失败', { name: entry.id, message });
    return { ok: false, error: message, needsRestart: false, result: null };
  }
}

export function snapshotsToday(entries: readonly SnapshotEntry[], now: number): SnapshotEntry[] {
  const today = dayStampLocal(now);
  return entries.filter((entry) => dayStampLocal(entry.createdAt) === today);
}

/** 自动备份：「启动时备份」只管启动那一次，「每天备份」管运行中补当天那份。 */
export async function maybeAutoBackup(
  storage: Storage,
  settings: AppSettings,
  options: { startup: boolean; now?: number },
): Promise<SnapshotEntry | null> {
  if (!settings.autoBackup) return null;
  const now = options.now ?? Date.now();
  const entries = await listSnapshots(storage);
  const fresh = entries.some((entry) => now - entry.createdAt < FRESH_MS);
  const today = snapshotsToday(entries, now);
  // 启动那次：启动开关或当天还缺一份都算要备；运行中只按每天开关补当天那份
  const wanted = options.startup
    ? (settings.backupOnStart && !fresh) || (settings.backupDaily && today.length === 0)
    : settings.backupDaily && today.length === 0;
  if (!wanted) return null;
  const created = await createSnapshot(storage, now);
  if (created === null) return null;
  await pruneSnapshots(storage, settings.backupKeep);
  return created;
}
