import { BACKUP_META_KEYS, moduleStores, type Storage } from '@dawn-tick/core';
import { errorMessage } from './lib/errors.ts';
import { logInfo, logWarn } from './log.ts';
import {
  LAN_SCOPES,
  formatScope,
  peerBaseUrl,
  scopeModules,
  type LanScope,
} from './lan-sync-protocol.ts';
import {
  applyLanEnvelope,
  parseLanEnvelope,
  type LanEnvelope,
} from './lan-sync-payload.ts';
import { lanFetch, lanResponseError, lanUtf8Length } from './lan-sync-http.ts';
import type { LanSession, LanTransferResult } from './lan-sync.ts';

/**
 * 局域网同步二期：拉取前预览。
 *
 * 边界：
 * - 统计只读本机 Storage 与对方的信封，不写库；合并仍走 `applyLanEnvelope`
 *   （`importBackup` 的 merge 规则），不新增冲突规则；
 * - 预览与合并用同一份信封，避免「看完数量后对方又变了」的二次拉取；
 * - 统计口径与 `importBackup` 的 merge 一致：本地没有该 id，或对方 `updated_at` 更新。
 */

export interface LanChangeStats {
  timetable: number;
  todos: number;
  settings: number;
  total: number;
}

export const EMPTY_LAN_CHANGE_STATS: LanChangeStats = { timetable: 0, todos: 0, settings: 0, total: 0 };

export interface LanPreviewResult {
  ok: boolean;
  envelope: LanEnvelope | null;
  stats: LanChangeStats;
  bytes: number;
  error: string | null;
}

function emptyPreview(error: string | null): LanPreviewResult {
  return { ok: false, envelope: null, stats: EMPTY_LAN_CHANGE_STATS, bytes: 0, error };
}

/** 与 `importBackup` 的 merge 判定一致：缺 id 或非法行不算变更。 */
function wouldApply(incoming: unknown, existing: Record<string, unknown> | undefined): boolean {
  if (typeof incoming !== 'object' || incoming === null) return false;
  const row = incoming as Record<string, unknown>;
  if (typeof row['id'] !== 'string' || row['id'].length === 0) return false;
  if (existing === undefined) return true;
  const incomingAt = Number(row['updated_at'] ?? 0);
  const existingAt = Number(existing['updated_at'] ?? 0);
  if (!Number.isFinite(incomingAt)) return false;
  if (!Number.isFinite(existingAt)) return true;
  return incomingAt > existingAt;
}

async function countRows(
  storage: Storage,
  envelope: LanEnvelope,
  scope: LanScope,
): Promise<number> {
  const stores = moduleStores(scopeModules([scope]));
  let count = 0;
  for (const store of stores) {
    const rows = envelope.backup.stores[store];
    if (!Array.isArray(rows)) continue;
    const local = new Map<string, Record<string, unknown>>();
    for (const row of await storage.collection<Record<string, unknown>>(store).getAll()) {
      const id = row['id'];
      if (typeof id === 'string') local.set(id, row);
    }
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const id = (row as Record<string, unknown>)['id'];
      if (typeof id !== 'string') continue;
      if (wouldApply(row, local.get(id))) count += 1;
    }
  }
  return count;
}

async function countSettings(storage: Storage, envelope: LanEnvelope): Promise<number> {
  let count = 0;
  for (const key of BACKUP_META_KEYS) {
    const incoming = envelope.backup.meta[key];
    if (incoming === undefined) continue;
    const existing = await storage.readMeta(key);
    if (existing !== incoming) count += 1;
  }
  return count;
}

/** 统计对方信封会带来的变更数，按课表 / 待办 / 设置分组。 */
export async function countLanChanges(
  storage: Storage,
  envelope: LanEnvelope,
  scopes: readonly LanScope[],
): Promise<LanChangeStats> {
  const selected = new Set(scopes);
  const counts = { timetable: 0, todos: 0, settings: 0, total: 0 };
  for (const scope of LAN_SCOPES) {
    if (!selected.has(scope) || !envelope.scope.includes(scope)) continue;
    counts[scope] = scope === 'settings' ? await countSettings(storage, envelope) : await countRows(storage, envelope, scope);
    counts.total += counts[scope];
  }
  return counts;
}

/** 拉取信封并统计预览；不写本机数据。 */
export async function previewPullFromPeer(
  storage: Storage,
  session: LanSession,
  scopes: readonly LanScope[],
  now = Date.now(),
): Promise<LanPreviewResult> {
  if (scopes.length === 0) return emptyPreview('请至少勾选一个同步范围');
  if (now >= session.expiresAt) return emptyPreview('配对已过期，请重新配对');
  try {
    const response = await lanFetch(`${peerBaseUrl(session.peer)}/export?scope=${formatScope(scopes)}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    const text = await response.text();
    if (!response.ok) return emptyPreview(lanResponseError(response.status, text, '预览'));
    const envelope = parseLanEnvelope(text);
    const stats = await countLanChanges(storage, envelope, scopes);
    logInfo('lan-sync', '已取得同步预览', { total: stats.total });
    return { ok: true, envelope, stats, bytes: lanUtf8Length(text), error: null };
  } catch (cause: unknown) {
    const error = errorMessage(cause);
    logWarn('lan-sync', '预览失败', { error });
    return emptyPreview(error);
  }
}

/** 用户确认后再按 merge 合并预览里那份信封。 */
export async function applyLanPreview(
  storage: Storage,
  envelope: LanEnvelope,
  scopes: readonly LanScope[],
  now = Date.now(),
): Promise<LanTransferResult> {
  if (scopes.length === 0) {
    return { ok: false, imported: 0, skipped: 0, warnings: [], error: '请至少勾选一个同步范围', bytes: 0 };
  }
  try {
    const result = await applyLanEnvelope(storage, envelope, { scopes, mode: 'merge', now });
    logInfo('lan-sync', '已确认合并预览', { imported: result.imported, skipped: result.skipped });
    return {
      ok: true,
      imported: result.imported,
      skipped: result.skipped,
      warnings: result.warnings,
      error: null,
      bytes: 0,
    };
  } catch (cause: unknown) {
    const error = errorMessage(cause);
    logWarn('lan-sync', '合并预览失败', { error });
    return { ok: false, imported: 0, skipped: 0, warnings: [], error, bytes: 0 };
  }
}
