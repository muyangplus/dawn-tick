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
  'widget_background',
  'auto_start',
  'start_hidden',
  'show_other_weeks',
  'class_reminder_enabled',
  'class_reminder_minutes',
  'tomorrow_preview',
  'semester_countdown',
  'holiday_countdown',
  'widget_variant',
  'receive_beta',
  'auto_check_update',
  'todo_sort',
  'dev_features',
  'log_enabled',
  'log_level',
  'wal_mode',
  'auto_backup',
  'backup_on_start',
  'backup_daily',
  'backup_keep',
  // WebDAV 密码不进导出：备份文件可能被分享出去
  'webdav_url',
  'webdav_user',
  'webdav_auto',
  'webdav_on_start',
  'webdav_daily',
  'webdav_history',
];

/** 备份模块：界面按模块勾选，导出与导入共用同一分组。 */
export type BackupModule = 'semesters' | 'courses' | 'events' | 'reminders' | 'settings';

export const BACKUP_MODULES: readonly BackupModule[] = [
  'semesters',
  'courses',
  'events',
  'reminders',
  'settings',
];

export const BACKUP_MODULE_LABEL: Record<BackupModule, string> = {
  semesters: '学期与节次',
  courses: '课程与排课',
  events: '日程与待办',
  reminders: '提醒',
  settings: '设置',
};

export const BACKUP_MODULE_STORES: Record<BackupModule, readonly StoreName[]> = {
  semesters: ['users', 'semesters', 'time_slots'],
  courses: ['courses', 'course_schedules'],
  events: ['events'],
  reminders: ['reminders'],
  settings: [],
};

export function moduleStores(modules: readonly BackupModule[]): StoreName[] {
  const selected = new Set<StoreName>();
  for (const module of modules) {
    for (const store of BACKUP_MODULE_STORES[module]) selected.add(store);
  }
  return [...selected];
}

/** 导入冲突处理：skip 保留现有数据，overwrite 用备份内容替换，clear 先清空所选模块，merge 同 id 取较新的一份。 */
export type ImportMode = 'skip' | 'overwrite' | 'clear' | 'merge';

export const IMPORT_MODES: readonly ImportMode[] = ['skip', 'overwrite', 'clear', 'merge'];

export const IMPORT_MODE_LABEL: Record<ImportMode, string> = {
  skip: '跳过已有数据',
  overwrite: '覆盖已有数据',
  clear: '清空所选模块后导入',
  merge: '按修改时间合并',
};

export interface ExportBackupOptions {
  modules?: readonly BackupModule[];
  now?: number;
}

export interface ImportBackupOptions {
  mode?: ImportMode;
  modules?: readonly BackupModule[];
  now?: number;
}

export interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  stores: Partial<Record<StoreName, unknown[]>>;
  meta: Record<string, string>;
  /** 导出时勾选的模块，供导入界面展示 */
  modules?: BackupModule[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  /** clear 模式清掉的本地行数 */
  removed: number;
  warnings: string[];
}

export async function exportBackup(
  storage: Storage,
  options: ExportBackupOptions = {},
): Promise<BackupPayload> {
  const modules = options.modules ?? [...BACKUP_MODULES];
  const stores: Partial<Record<StoreName, unknown[]>> = {};
  for (const store of moduleStores(modules)) {
    stores[store] = await storage.collection(store).getAll();
  }

  const meta: Record<string, string> = {};
  if (modules.includes('settings')) {
    for (const key of BACKUP_META_KEYS) {
      const value = await storage.readMeta(key);
      if (value !== undefined) meta[key] = value;
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: options.now ?? Date.now(),
    stores,
    meta,
    modules: [...modules],
  };
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
  options: ImportBackupOptions = {},
): Promise<ImportResult> {
  let imported = 0;
  let skipped = 0;
  let removed = 0;
  const warnings: string[] = [];
  const mode = options.mode ?? 'skip';
  const modules = options.modules ?? BACKUP_MODULES;
  const allowed = new Set(moduleStores(modules));
  const includeSettings = modules.includes('settings');
  const now = options.now ?? Date.now();

  // clear：先把所选模块的本地行删干净，再整份导入
  if (mode === 'clear') {
    for (const store of allowed) {
      const collection = storage.collection<Record<string, unknown>>(store);
      for (const row of await collection.getAll()) {
        const id = row['id'];
        if (typeof id !== 'string') continue;
        await collection.delete(id);
        removed += 1;
      }
    }
  }

  for (const store of STORE_NAMES) {
    const rows = payload.stores[store];
    if (!Array.isArray(rows)) continue;
    if (store === 'app_meta' || !allowed.has(store)) continue;

    const collection = storage.collection<Record<string, unknown>>(store);
    for (const raw of rows) {
      if (typeof raw !== 'object' || raw === null) {
        skipped += 1;
        continue;
      }
      const row = raw as Record<string, unknown>;
      const id = row['id'];
      if (typeof id !== 'string' || id.length === 0) {
        skipped += 1;
        warnings.push(`${store}: 缺少 id`);
        continue;
      }
      const existing = await collection.get(id);
      if (existing !== undefined) {
        if (mode === 'skip') {
          skipped += 1;
          continue;
        }
        if (mode === 'merge' && !isNewer(row, existing)) {
          skipped += 1;
          continue;
        }
      }
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

  if (includeSettings) {
    for (const [key, value] of Object.entries(payload.meta)) {
      if (!BACKUP_META_KEYS.includes(key)) continue;
      const existing = await storage.readMeta(key);
      if (existing !== undefined && mode === 'skip') {
        skipped += 1;
        continue;
      }
      await storage.writeMeta(key, value);
      imported += 1;
    }
  }

  return { imported, skipped, removed, warnings };
}

/** merge 用：备份里的 updated_at 比本地新才算新的一份。 */
function isNewer(incoming: Record<string, unknown>, existing: Record<string, unknown>): boolean {
  const incomingAt = Number(incoming['updated_at'] ?? 0);
  const existingAt = Number(existing['updated_at'] ?? 0);
  if (!Number.isFinite(incomingAt)) return false;
  if (!Number.isFinite(existingAt)) return true;
  return incomingAt > existingAt;
}

/** 备份文件里各模块的行数，供导入界面展示与勾选。 */
export function summarizeBackup(payload: BackupPayload): Array<{ module: BackupModule; rows: number }> {
  return BACKUP_MODULES.map((module) => {
    const stores = BACKUP_MODULE_STORES[module];
    const rows =
      module === 'settings'
        ? Object.keys(payload.meta).length
        : stores.reduce((total, store) => total + (Array.isArray(payload.stores[store]) ? (payload.stores[store]?.length ?? 0) : 0), 0);
    return { module, rows };
  });
}
