import { STORE_NAMES, type Storage, type StoreName } from './storage.ts';
import { collectViolations } from './validation.ts';

export const BACKUP_FORMAT = 'dawn-tick-backup';
export const BACKUP_VERSION = 1;

/** 参与备份的设置项；排除 device_id 与 sync_cursor（见 D73）。 */
export const BACKUP_META_KEYS: readonly string[] = [
  'schema_version',
  'time_zone',
  'auto_time_zone',
  'view_days',
  'theme',
  'theme_preset',
];

export interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  stores: Partial<Record<StoreName, unknown[]>>;
  meta: Record<string, string>;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  warnings: string[];
}

export async function exportBackup(storage: Storage, now: number = Date.now()): Promise<BackupPayload> {
  const stores: Partial<Record<StoreName, unknown[]>> = {};
  for (const store of STORE_NAMES) {
    stores[store] = await storage.collection(store).getAll();
  }

  const meta: Record<string, string> = {};
  for (const key of BACKUP_META_KEYS) {
    const value = await storage.readMeta(key);
    if (value !== undefined) meta[key] = value;
  }

  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, stores, meta };
}

export function parseBackup(text: string): BackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('备份文件不是合法 JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('备份文件结构不正确');
  const payload = parsed as Partial<BackupPayload>;
  if (payload.format !== BACKUP_FORMAT) throw new Error('不是晓刻 DawnTick 备份文件');
  if (typeof payload.version !== 'number' || payload.version > BACKUP_VERSION) {
    throw new Error(`备份版本 ${String(payload.version)} 高于当前支持的 ${BACKUP_VERSION}`);
  }
  return {
    format: BACKUP_FORMAT,
    version: payload.version,
    exportedAt: typeof payload.exportedAt === 'number' ? payload.exportedAt : 0,
    stores: payload.stores ?? {},
    meta: payload.meta ?? {},
  };
}

/** 逐行校验后写入；非法行计入 skipped 并给出警告，不中断整体导入。 */
export async function importBackup(
  storage: Storage,
  payload: BackupPayload,
  now: number = Date.now(),
): Promise<ImportResult> {
  let imported = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const store of STORE_NAMES) {
    const rows = payload.stores[store];
    if (!Array.isArray(rows)) continue;
    if (store === 'app_meta') continue;

    const collection = storage.collection<Record<string, unknown>>(store);
    for (const raw of rows) {
      if (typeof raw !== 'object' || raw === null) {
        skipped += 1;
        continue;
      }
      const row = raw as Record<string, unknown>;
      const violations = await collectViolations(storage, store, row);
      if (violations.length > 0) {
        skipped += 1;
        warnings.push(`${store}: ${violations.map((item) => item.rule).join(',')}`);
        continue;
      }
      await collection.put({ ...row, dirty: 1, updated_at: now });
      imported += 1;
    }
  }

  for (const [key, value] of Object.entries(payload.meta)) {
    if (!BACKUP_META_KEYS.includes(key)) continue;
    await storage.writeMeta(key, value);
  }

  return { imported, skipped, warnings };
}
