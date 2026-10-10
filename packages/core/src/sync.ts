import { STORE_KEYS, type Storage, type StoreName } from './storage.ts';

export const SYNC_CURSOR_KEY = 'sync_cursor';

/** 参与同步的集合；app_meta 为本地数据。 */
export const SYNC_STORES: readonly StoreName[] = [
  'users',
  'semesters',
  'time_slots',
  'courses',
  'course_schedules',
  'events',
  'reminders',
];

export interface SyncRow {
  store: StoreName;
  key: string;
  value: Record<string, unknown> | null;
  updated_at: number;
  rev: number;
}

export interface RemoteStore {
  push(rows: readonly SyncRow[]): Promise<{ accepted: number; cursor: string }>;
  pull(cursor: string | null): Promise<{ rows: SyncRow[]; cursor: string }>;
}

export interface ConflictRecord {
  store: StoreName;
  key: string;
  localRev: number;
  remoteRev: number;
  resolution: 'local' | 'remote';
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  conflicts: ConflictRecord[];
  cursor: string;
}

type StoredRow = Record<string, unknown> & { rev?: number; dirty?: number; updated_at?: number };

function revOf(row: StoredRow | undefined): number {
  return typeof row?.rev === 'number' ? row.rev : 0;
}

function updatedAtOf(row: StoredRow | undefined): number {
  return typeof row?.updated_at === 'number' ? row.updated_at : 0;
}

export async function collectDirty(storage: Storage): Promise<SyncRow[]> {
  const out: SyncRow[] = [];
  for (const store of SYNC_STORES) {
    const rows = await storage.collection<StoredRow>(store).getAll();
    for (const row of rows) {
      if (row.dirty !== 1) continue;
      const key = row[STORE_KEYS[store]];
      if (typeof key !== 'string') continue;
      out.push({ store, key, value: row, updated_at: updatedAtOf(row), rev: revOf(row) });
    }
  }
  return out;
}

export async function applyRemoteRows(
  storage: Storage,
  rows: readonly SyncRow[],
): Promise<{ applied: number; conflicts: ConflictRecord[] }> {
  let applied = 0;
  const conflicts: ConflictRecord[] = [];

  for (const incoming of rows) {
    if (!SYNC_STORES.includes(incoming.store)) continue;
    const collection = storage.collection<StoredRow>(incoming.store);
    const local = await collection.get(incoming.key);
    const localRev = revOf(local);
    const remoteRev = incoming.rev;

    if (local === undefined) {
      if (incoming.value !== null) {
        await collection.put({ ...incoming.value, dirty: 0 });
        applied += 1;
      }
      continue;
    }

    if (remoteRev > localRev) {
      if (local.dirty === 1) {
        conflicts.push({ store: incoming.store, key: incoming.key, localRev, remoteRev, resolution: 'remote' });
      }
      if (incoming.value === null) {
        await collection.put({ ...local, deleted_at: incoming.updated_at, rev: remoteRev, dirty: 0 });
      } else {
        await collection.put({ ...incoming.value, dirty: 0 });
      }
      applied += 1;
      continue;
    }

    if (remoteRev < localRev) {
      conflicts.push({ store: incoming.store, key: incoming.key, localRev, remoteRev, resolution: 'local' });
      await collection.put({ ...local, dirty: 1 });
      continue;
    }

    if (incoming.updated_at > updatedAtOf(local)) {
      if (incoming.value !== null) {
        await collection.put({ ...incoming.value, dirty: 0 });
        applied += 1;
      }
      conflicts.push({ store: incoming.store, key: incoming.key, localRev, remoteRev, resolution: 'remote' });
    } else {
      conflicts.push({ store: incoming.store, key: incoming.key, localRev, remoteRev, resolution: 'local' });
      await collection.put({ ...local, dirty: 1 });
    }
  }

  return { applied, conflicts };
}

async function clearDirty(storage: Storage, row: SyncRow): Promise<void> {
  const collection = storage.collection<StoredRow>(row.store);
  const current = await collection.get(row.key);
  if (current === undefined) return;
  if (revOf(current) !== row.rev) return;
  await collection.put({ ...current, dirty: 0 });
}

/** pull → push → pull。 */
export async function syncAll(storage: Storage, remote: RemoteStore): Promise<SyncReport> {
  const conflicts: ConflictRecord[] = [];
  let cursor = (await storage.readMeta(SYNC_CURSOR_KEY)) ?? null;
  let pulled = 0;
  let pushed = 0;

  const first = await remote.pull(cursor);
  const firstApplied = await applyRemoteRows(storage, first.rows);
  pulled += firstApplied.applied;
  conflicts.push(...firstApplied.conflicts);
  cursor = first.cursor;

  const dirty = await collectDirty(storage);
  if (dirty.length > 0) {
    const result = await remote.push(dirty);
    pushed = result.accepted;
    for (const row of dirty) await clearDirty(storage, row);
    cursor = result.cursor;
  }

  const second = await remote.pull(cursor);
  const secondApplied = await applyRemoteRows(storage, second.rows);
  pulled += secondApplied.applied;
  conflicts.push(...secondApplied.conflicts);
  cursor = second.cursor;

  await storage.writeMeta(SYNC_CURSOR_KEY, cursor);
  return { pulled, pushed, conflicts, cursor };
}

/** 本机可跑的远端实现，用于在没有服务端时验证同一套同步逻辑。 */
export class MemoryRemote implements RemoteStore {
  private clock = 0;
  private readonly rows = new Map<string, SyncRow & { seq: number }>();

  async push(rows: readonly SyncRow[]): Promise<{ accepted: number; cursor: string }> {
    for (const row of rows) {
      this.clock += 1;
      this.rows.set(`${row.store}|${row.key}`, { ...row, seq: this.clock });
    }
    return { accepted: rows.length, cursor: String(this.clock) };
  }

  async pull(cursor: string | null): Promise<{ rows: SyncRow[]; cursor: string }> {
    const from = cursor === null ? 0 : Number(cursor);
    const rows = [...this.rows.values()]
      .filter((row) => row.seq > from)
      .sort((left, right) => left.seq - right.seq)
      .map(({ seq: _seq, ...row }) => row);
    return { rows, cursor: String(this.clock) };
  }
}
