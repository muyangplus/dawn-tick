import {
  BACKUP_MODULES,
  exportBackup,
  importBackup,
  parseBackup,
  type AppSettings,
  type ImportResult,
  type Storage,
} from '@dawn-tick/core';
import { usesNativeSnapshots } from './lib/capabilities.ts';
import { invokeNative, nativeErrorMessage } from './lib/native.ts';
import { activeSqlDriver } from './db/active-driver.ts';
import { dayStampLocal } from './lib/dates.ts';
import { readMetaJson, writeMetaJson } from './lib/meta.ts';
import { SNAPSHOT_INDEX_META_KEY, SNAPSHOT_META_PREFIX } from './lib/meta-keys.ts';
import { logInfo, logWarn } from './log.ts';

/** 数据库快照：Windows 用原生文件快照（VACUUM INTO 写 backups/），Web 与 Android 把 JSON 存进 app_meta。 */

export interface SnapshotEntry {
  /** 文件快照是文件名，JSON 快照是 app_meta 的键 */
  id: string;
  createdAt: number;
  bytes: number;
  kind: 'file' | 'json';
}

/** 索引里的一行：没有 `kind`，因为索引只服务 JSON 快照。 */
type SnapshotIndexEntry = Omit<SnapshotEntry, 'kind'>;

const SNAPSHOT_PREFIX = SNAPSHOT_META_PREFIX;
/** 同一分钟内不重复做启动快照 */
const FRESH_MS = 60_000;

export function snapshotKind(): 'file' | 'json' {
  return usesNativeSnapshots() ? 'file' : 'json';
}

function describe(cause: unknown): string {
  return nativeErrorMessage(cause);
}

/** 校验快照索引：结构不对时整份作废，回退一次全表扫描重建。 */
function parseSnapshotIndex(value: unknown): SnapshotIndexEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: SnapshotIndexEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const id = record['id'];
    const createdAt = record['createdAt'];
    const bytes = record['bytes'];
    if (typeof id !== 'string' || !id.startsWith(SNAPSHOT_PREFIX)) return null;
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    entries.push({ id, createdAt, bytes });
  }
  return entries;
}

function newestFirst(left: SnapshotIndexEntry, right: SnapshotIndexEntry): number {
  return right.createdAt - left.createdAt;
}

/** 全表扫描：只在没有索引（旧库）或索引损坏时走一次，扫完立刻写索引。 */
async function scanJsonSnapshots(storage: Storage): Promise<SnapshotIndexEntry[]> {
  const rows = await storage.collection<{ key: string; value: string }>('app_meta').getAll();
  return rows
    .filter((row) => row.key.startsWith(SNAPSHOT_PREFIX))
    .map((row) => ({
      id: row.key,
      createdAt: Number(row.key.slice(SNAPSHOT_PREFIX.length)) || 0,
      bytes: typeof row.value === 'string' ? row.value.length : 0,
    }))
    .sort(newestFirst);
}

async function readSnapshotIndex(storage: Storage): Promise<SnapshotIndexEntry[] | null> {
  return readMetaJson<SnapshotIndexEntry[] | null>(storage, SNAPSHOT_INDEX_META_KEY, {
    parse: parseSnapshotIndex,
    fallback: null,
    scope: 'backup',
  });
}

/** 索引写不进去只影响下次列表的读取量，列表本身仍可用。 */
async function persistSnapshotIndex(storage: Storage, entries: SnapshotIndexEntry[]): Promise<void> {
  try {
    await writeMetaJson(storage, SNAPSHOT_INDEX_META_KEY, entries, { scope: 'backup' });
  } catch {
    // writeMetaJson 已记日志；这里只保证快照功能不因索引失败而中断
  }
}

async function listJsonSnapshots(storage: Storage): Promise<SnapshotEntry[]> {
  let entries = await readSnapshotIndex(storage);
  if (entries === null) {
    // 无索引旧库：读一次全表，把列表索引补上，之后只读索引
    entries = await scanJsonSnapshots(storage);
    await persistSnapshotIndex(storage, entries);
  }
  return [...entries].sort(newestFirst).map((entry) => ({ ...entry, kind: 'json' as const }));
}

async function listFileSnapshots(): Promise<SnapshotEntry[]> {
  try {
    const rows = await invokeNative<Array<{ name: string; bytes: number; createdAt: number }>>(
      'list_backups',
    );
    if (rows === undefined) return [];
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

/** 把新快照登记进索引；索引缺失时先扫一次全表（旧库升级路径）。 */
async function registerSnapshot(storage: Storage, entry: SnapshotEntry): Promise<void> {
  const current = (await readSnapshotIndex(storage)) ?? (await scanJsonSnapshots(storage));
  const next = current.filter((item) => item.id !== entry.id);
  next.push({ id: entry.id, createdAt: entry.createdAt, bytes: entry.bytes });
  next.sort(newestFirst);
  await writeMetaJson(storage, SNAPSHOT_INDEX_META_KEY, next, { scope: 'backup' });
}

/** 从索引移除；没有索引时不用管，下次列表扫描自然看不到已删正文。 */
async function unregisterSnapshot(storage: Storage, id: string): Promise<void> {
  const current = await readSnapshotIndex(storage);
  if (current === null) return;
  await persistSnapshotIndex(
    storage,
    current.filter((item) => item.id !== id),
  );
}

async function createJsonSnapshot(storage: Storage, now: number): Promise<SnapshotEntry> {
  const payload = await exportBackup(storage, { now, modules: BACKUP_MODULES });
  const id = `${SNAPSHOT_PREFIX}${now}`;
  const text = await writeMetaJson(storage, id, payload, { scope: 'backup' });
  const entry: SnapshotEntry = { id, createdAt: now, bytes: text.length, kind: 'json' };
  try {
    await registerSnapshot(storage, entry);
  } catch (cause: unknown) {
    // 索引没写成：回滚正文，避免留下一份列表里看不到、又永远不被清理的快照
    try {
      await storage.collection('app_meta').delete(id);
    } catch {
      // 回滚失败只会多一份孤儿正文
    }
    throw cause;
  }
  return entry;
}

async function createFileSnapshot(now: number): Promise<SnapshotEntry> {
  const driver = activeSqlDriver();
  if (driver === null) throw new Error('数据库尚未打开');
  const target = await invokeNative<{ name: string; path: string; sqlLiteral: string }>('backup_target');
  if (target === undefined) throw new Error('当前平台不支持文件快照');
  try {
    await driver.all(`VACUUM INTO ${target.sqlLiteral}`);
  } catch (cause: unknown) {
    // VACUUM INTO 失败会留下 0 字节文件，清掉；启动时的空快照清理兜底
    try {
      await invokeNative('delete_backup', { name: target.name });
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
  if (!usesNativeSnapshots()) return null;
  try {
    const text = await invokeNative<string | null>('recovery_notice');
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
      await unregisterSnapshot(storage, entry.id);
    } else {
      await invokeNative('delete_backup', { name: entry.id });
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
      return (await invokeNative<number>('prune_backups', { keep: Math.max(1, keep) })) ?? 0;
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
      await invokeNative('restore_backup', { name: entry.id });
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
