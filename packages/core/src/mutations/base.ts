// 写入的公共底座：上下文、插入/更新/软删除与级联辅助。只给 mutations/ 内部用，不从包入口导出。
import { normalizeRow } from '../columns.ts';
import type { Storage } from '../storage.ts';
import type { ReminderTargetType } from '../types.ts';
import { assertValid, isValidatedStorage } from '../validation.ts';

export type Row = Record<string, unknown>;

export function uuidv7(nowMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  const cryptoObject = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (typeof cryptoObject?.getRandomValues === 'function') cryptoObject.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);

  const stamp = BigInt(nowMs);
  bytes[0] = Number((stamp >> 40n) & 0xffn);
  bytes[1] = Number((stamp >> 32n) & 0xffn);
  bytes[2] = Number((stamp >> 24n) & 0xffn);
  bytes[3] = Number((stamp >> 16n) & 0xffn);
  bytes[4] = Number((stamp >> 8n) & 0xffn);
  bytes[5] = Number(stamp & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface WriteOptions {
  now?: () => number;
  id?: () => string;
}

export interface Context {
  storage: Storage;
  now: () => number;
  id: () => string;
}

export function context(storage: Storage, options: WriteOptions = {}): Context {
  return {
    storage,
    now: options.now ?? (() => Date.now()),
    id: options.id ?? (() => uuidv7()),
  };
}

/** 写入前校验；存储已经由 validatedStorage 包过时由它在 put 里校验，这里不重复读表。 */
async function check(ctx: Context, store: Parameters<Storage['collection']>[0], row: Row): Promise<void> {
  if (!isValidatedStorage(ctx.storage)) await assertValid(ctx.storage, store, row);
}

/**
 * 写入前把对象键翻译成真实列名。
 * 对外输入是驼峰（shortName、startDate…），表里是下划线（short_name、start_date…），
 * 不翻译的话 SQLite 会报 `table X has no column named Y`。
 */
export async function insert(ctx: Context, store: Parameters<Storage['collection']>[0], row: Row): Promise<Row> {
  const values = normalizeRow(store, row);
  await check(ctx, store, values);
  await ctx.storage.collection(store).put(values);
  return values;
}

export async function patch(
  ctx: Context,
  store: Parameters<Storage['collection']>[0],
  id: string,
  changes: Row,
): Promise<Row> {
  const existing = await ctx.storage.collection<Row>(store).get(id);
  if (existing === undefined) throw new Error(`${store} 不存在: ${id}`);
  const updated: Row = {
    ...existing,
    ...normalizeRow(store, changes),
    updated_at: ctx.now(),
    rev: Number(existing['rev'] ?? 0) + 1,
    dirty: 1,
  };
  await check(ctx, store, updated);
  await ctx.storage.collection(store).put(updated);
  return updated;
}

export async function remove(
  ctx: Context,
  store: Parameters<Storage['collection']>[0],
  id: string,
): Promise<void> {
  const existing = await ctx.storage.collection<Row>(store).get(id);
  if (existing === undefined) return;
  const removed: Row = {
    ...existing,
    deleted_at: ctx.now(),
    updated_at: ctx.now(),
    rev: Number(existing['rev'] ?? 0) + 1,
    dirty: 1,
  };
  await check(ctx, store, removed);
  await ctx.storage.collection(store).put(removed);
}

export async function dropReminders(ctx: Context, targetType: ReminderTargetType, targetId: string): Promise<void> {
  const rows = await ctx.storage.collection<Row>('reminders').getAll();
  for (const row of rows) {
    if (row['deleted_at'] !== null) continue;
    if (row['target_type'] !== targetType || row['target_id'] !== targetId) continue;
    await remove(ctx, 'reminders', String(row['id']));
  }
}

/** 命中的事件连同 parent_id 链上的全部子孙事件。 */
export function withDescendants(events: readonly Row[], seed: (row: Row) => boolean): Row[] {
  const alive = events.filter((row) => row['deleted_at'] === null || row['deleted_at'] === undefined);
  const picked = new Set(alive.filter(seed).map((row) => String(row['id'])));
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of alive) {
      const id = String(row['id']);
      if (!picked.has(id) && row['parent_id'] !== null && picked.has(String(row['parent_id']))) {
        picked.add(id);
        grew = true;
      }
    }
  }
  return alive.filter((row) => picked.has(String(row['id'])));
}

/** 删除一批事件及挂在它们上面的提醒。 */
export async function removeEventsDeep(ctx: Context, rows: readonly Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  const ids = new Set(rows.map((row) => String(row['id'])));
  for (const reminder of await ctx.storage.collection<Row>('reminders').getAll()) {
    if (reminder['deleted_at'] !== null || reminder['target_type'] !== 'event') continue;
    if (ids.has(String(reminder['target_id']))) await remove(ctx, 'reminders', String(reminder['id']));
  }
  for (const id of ids) await remove(ctx, 'events', id);
  return ids.size;
}

/** 删除一条排课及挂在它上面的排课级提醒与调课/停课记录（含其子事件与提醒）：不留指向已删排课的孤儿。 */
export async function removeScheduleDeep(ctx: Context, id: string): Promise<void> {
  await dropReminders(ctx, 'schedule', id);
  const events = await ctx.storage.collection<Row>('events').getAll();
  await removeEventsDeep(ctx, withDescendants(events, (row) => row['ref_schedule_id'] === id));
  await remove(ctx, 'course_schedules', id);
}

export function isAlive(row: Row): boolean {
  return row['deleted_at'] === null || row['deleted_at'] === undefined;
}
