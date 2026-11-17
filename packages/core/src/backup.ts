import { STORE_NAMES, type Storage, type StoreName } from './storage.ts';
import { collectViolations } from './validation.ts';
import { EXPORT_EXCLUDED_KEYS, SETTING_META_KEYS } from './settings.ts';

export const BACKUP_FORMAT = 'dawn-tick-backup';
export const BACKUP_VERSION = 1;

/**
 * 参与备份的设置项：由 settings.ts 的键清单派生。
 * 排除 device_id 与 sync_cursor（见 D73），以及 EXPORT_EXCLUDED_KEYS 里的 WebDAV 密码。
 * 不含 schema_version：它描述的是本机库结构，导入别处的值会让迁移重放或被跳过。
 */
export const BACKUP_META_KEYS: readonly string[] = SETTING_META_KEYS.filter(
  (key) => !EXPORT_EXCLUDED_KEYS.includes(key),
);

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

/**
 * 来源与本机各有一个当前学期时怎么办：
 * `keep-local` 保留本机当前学期，来源学期按非当前导入；`use-incoming` 切换到来源学期。
 */
export type ActiveSemesterChoice = 'keep-local' | 'use-incoming';

export interface ImportBackupOptions {
  mode?: ImportMode;
  modules?: readonly BackupModule[];
  now?: number;
  /** 缺省：合并/跳过（含局域网同步）保留本机；覆盖/清空（显式恢复）以备份为准 */
  activeSemester?: ActiveSemesterChoice;
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
    ...(Array.isArray(payload.modules)
      ? { modules: payload.modules.filter((item): item is BackupModule => BACKUP_MODULES.includes(item)) }
      : {}),
  };
}

/** 外键：各表引用的父表与字段（与 001_init.sql 一致）；导入前逐行确认父行存在。 */
const FOREIGN_KEYS: Partial<Record<StoreName, ReadonlyArray<{ column: string; parent: StoreName; nullable: boolean }>>> = {
  semesters: [{ column: 'user_id', parent: 'users', nullable: false }],
  time_slots: [{ column: 'semester_id', parent: 'semesters', nullable: false }],
  courses: [{ column: 'semester_id', parent: 'semesters', nullable: false }],
  course_schedules: [{ column: 'course_id', parent: 'courses', nullable: false }],
  events: [
    { column: 'user_id', parent: 'users', nullable: false },
    { column: 'semester_id', parent: 'semesters', nullable: true },
    { column: 'parent_id', parent: 'events', nullable: true },
    { column: 'ref_schedule_id', parent: 'course_schedules', nullable: true },
  ],
  reminders: [{ column: 'user_id', parent: 'users', nullable: false }],
};

/** 清空时子表先删：与 SQLite 级联方向一致，IndexedDB 上也得到同样的结果。users 只有本机一行，不清。 */
const CLEAR_ORDER: readonly StoreName[] = ['reminders', 'events', 'course_schedules', 'courses', 'time_slots', 'semesters'];

/** 父行在前：events 内部的 parent_id 按层级排序，避免子行先于父行写入。 */
function parentFirst(rows: readonly unknown[]): unknown[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of rows) {
    if (typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>)['id'] === 'string') {
      byId.set((raw as Record<string, unknown>)['id'] as string, raw as Record<string, unknown>);
    }
  }
  const depth = (row: Record<string, unknown>, seen = new Set<string>()): number => {
    const parent = row['parent_id'];
    if (typeof parent !== 'string' || seen.has(parent)) return 0;
    const next = byId.get(parent);
    if (next === undefined) return 0;
    seen.add(parent);
    return 1 + depth(next, seen);
  };
  return [...rows].sort((left, right) => {
    const l = typeof left === 'object' && left !== null ? depth(left as Record<string, unknown>) : 0;
    const r = typeof right === 'object' && right !== null ? depth(right as Record<string, unknown>) : 0;
    return l - r;
  });
}

const STORE_LABEL: Partial<Record<StoreName, string>> = {
  users: '用户',
  semesters: '学期',
  courses: '课程',
  course_schedules: '排课',
  events: '条目',
};

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
    if (allowed.has('semesters') && !allowed.has('courses')) {
      const localCourses = await storage.collection<Record<string, unknown>>('courses').getAll();
      if (localCourses.length > 0) throw new Error('清空「学期与节次」会连带删除课程，请同时勾选「课程与排课」');
    }
    const removedSchedules = new Set<string>();
    const removedSemesters = new Set<string>();
    for (const store of CLEAR_ORDER) {
      if (!allowed.has(store)) continue;
      const collection = storage.collection<Record<string, unknown>>(store);
      for (const row of await collection.getAll()) {
        const id = row['id'];
        if (typeof id !== 'string') continue;
        await collection.delete(id);
        removed += 1;
        if (store === 'course_schedules') removedSchedules.add(id);
        if (store === 'semesters') removedSemesters.add(id);
      }
    }
    // 未选「条目」时，删排课/学期对条目的影响按 SQLite 外键语义显式处理，两种存储结果一致
    if (!allowed.has('events') && (removedSchedules.size > 0 || removedSemesters.size > 0)) {
      const events = storage.collection<Record<string, unknown>>('events');
      let dropped = 0;
      for (const row of await events.getAll()) {
        const id = row['id'];
        if (typeof id !== 'string') continue;
        if (typeof row['ref_schedule_id'] === 'string' && removedSchedules.has(row['ref_schedule_id'])) {
          await events.delete(id);
          dropped += 1;
          continue;
        }
        if (typeof row['semester_id'] === 'string' && removedSemesters.has(row['semester_id'])) {
          await events.put({ ...row, semester_id: null });
        }
      }
      if (dropped > 0) warnings.push(`清空排课时一并删除了 ${dropped} 条停课/调课记录`);
    }
  }

  // 当前学期冲突：每个用户只能有一个当前学期
  const choice = options.activeSemester ?? (mode === 'merge' || mode === 'skip' ? 'keep-local' : 'use-incoming');
  const incomingActive = allowed.has('semesters')
    ? (payload.stores.semesters ?? []).filter(
        (raw): raw is Record<string, unknown> =>
          typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>)['is_active'] === 1,
      )
    : [];
  const demote = new Set<string>();
  if (incomingActive.length > 0) {
    const semesters = storage.collection<Record<string, unknown>>('semesters');
    for (const local of await semesters.getAll()) {
      if (local['deleted_at'] !== null || local['is_active'] !== 1) continue;
      const clash = incomingActive.find((row) => row['user_id'] === local['user_id'] && row['id'] !== local['id']);
      if (clash === undefined) continue;
      if (choice === 'use-incoming') {
        await semesters.put({ ...local, is_active: 0, updated_at: now, dirty: 1 });
      } else {
        demote.add(String(clash['id']));
      }
    }
  }

  // 合并/跳过保留来源的 updated_at：后写胜才成立；覆盖/清空是显式恢复，按本次导入时刻计
  const keepTimestamps = mode === 'merge' || mode === 'skip';

  for (const store of STORE_NAMES) {
    const listed = payload.stores[store];
    if (!Array.isArray(listed)) continue;
    if (store === 'app_meta' || !allowed.has(store)) continue;
    const rows = store === 'events' ? parentFirst(listed) : listed;

    const collection = storage.collection<Record<string, unknown>>(store);
    for (const raw of rows) {
      if (typeof raw !== 'object' || raw === null) {
        skipped += 1;
        continue;
      }
      let row = raw as Record<string, unknown>;
      const id = row['id'];
      if (typeof id !== 'string' || id.length === 0) {
        skipped += 1;
        warnings.push(`${store}: 缺少 id`);
        continue;
      }
      if (store === 'semesters' && demote.has(id)) row = { ...row, is_active: 0 };
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
      const missing = await missingParent(storage, store, row);
      if (missing !== null) {
        skipped += 1;
        warnings.push(`${store}: 缺少关联的${STORE_LABEL[missing] ?? missing}`);
        continue;
      }
      await collection.put(keepTimestamps ? { ...row, dirty: 1 } : { ...row, dirty: 1, updated_at: now });
      imported += 1;
    }
  }

  if (includeSettings) {
    for (const [key, value] of Object.entries(payload.meta)) {
      if (!BACKUP_META_KEYS.includes(key)) continue;
      const existing = await storage.readMeta(key);
      // 值没变不算导入：否则每次局域网同步都报告有改动并触发整页重载
      if (existing === value) continue;
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

/** 备份里的当前学期与本机当前学期不是同一个时，返回双方名称（导入界面让用户选保留哪个）。 */
export async function activeSemesterConflict(
  storage: Storage,
  payload: BackupPayload,
): Promise<{ local: string; incoming: string } | null> {
  const incoming = (payload.stores.semesters ?? []).find(
    (raw): raw is Record<string, unknown> =>
      typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>)['is_active'] === 1,
  );
  if (incoming === undefined) return null;
  for (const local of await storage.collection<Record<string, unknown>>('semesters').getAll()) {
    if (local['deleted_at'] !== null || local['is_active'] !== 1) continue;
    if (local['id'] === incoming['id'] || local['user_id'] !== incoming['user_id']) continue;
    return { local: String(local['name'] ?? '本机学期'), incoming: String(incoming['name'] ?? '备份学期') };
  }
  return null;
}

/** 外键父行是否存在（含软删的行：SQLite 外键只看行在不在）；缺失时返回父表名。 */
async function missingParent(
  storage: Storage,
  store: StoreName,
  row: Record<string, unknown>,
): Promise<StoreName | null> {
  for (const key of FOREIGN_KEYS[store] ?? []) {
    const value = row[key.column];
    if (value === null || value === undefined) {
      if (key.nullable) continue;
      return key.parent;
    }
    if (typeof value !== 'string') return key.parent;
    if ((await storage.collection(key.parent).get(value)) === undefined) return key.parent;
  }
  return null;
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
