import {
  BACKUP_MODULES,
  exportBackup,
  importBackup,
  parseBackup,
  summarizeBackup,
  toBase64Utf8,
  fromBase64Utf8,
  zipStore,
  type BackupModule,
  type BackupPayload,
  type ImportMode,
  type ImportResult,
  type Storage,
} from '@dawn-tick/core';
import { logInfo, logWarn, logsText } from './log.ts';
import { PRESET_CONTENT_META_KEY, PRESET_SNAPSHOT_META_KEY } from './preset-update.ts';
import { saveBinaryFile, saveTextFile } from './system-actions.ts';
import { pickBackupText, readZipEntries } from './zip-read.ts';

/** 数据管理：本地配置数据的导出与导入（JSON / Base64 / 整包 zip）。 */

export type ExportFormat = 'json' | 'base64' | 'zip';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['json', 'base64', 'zip'];

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  json: 'JSON 文件',
  base64: 'Base64 文本',
  zip: '整包 zip',
};

export interface ExportRequest {
  modules: readonly BackupModule[];
  format: ExportFormat;
  /** 整包时一并打包预设快照 */
  bundlePresets: boolean;
  /** 整包时一并打包日志 */
  bundleLogs: boolean;
  now?: number;
}

export interface ExportOutcome {
  ok: boolean;
  cancelled: boolean;
  path: string | null;
  error: string | null;
  /** Base64 格式给界面文本框用的内容 */
  text: string | null;
  /** 实际写出或生成的字节数 */
  bytes: number;
  name: string;
  /** 模块与行数统计，用于界面提示与日志 */
  modules: readonly BackupModule[];
  rows: number;
}

function dayStamp(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function exportFileName(format: ExportFormat, now = Date.now()): string {
  const day = dayStamp(now);
  if (format === 'base64') return `DawnTick-backup-${day}.base64.txt`;
  if (format === 'zip') return `DawnTick-backup-${day}.zip`;
  return `DawnTick-backup-${day}.json`;
}

function countRows(payload: BackupPayload): number {
  return Object.values(payload.stores).reduce(
    (total, rows) => total + (Array.isArray(rows) ? rows.length : 0),
    0,
  );
}

/** 导出：按格式写出文件，或在 Base64 格式下只生成文本交给界面。 */
export async function exportConfig(storage: Storage, request: ExportRequest): Promise<ExportOutcome> {
  const now = request.now ?? Date.now();
  const name = exportFileName(request.format, now);
  const base: ExportOutcome = {
    ok: false,
    cancelled: false,
    path: null,
    error: null,
    text: null,
    bytes: 0,
    name,
    modules: request.modules,
    rows: 0,
  };
  if (request.modules.length === 0) {
    return { ...base, error: '请至少勾选一个模块' };
  }
  const payload = await exportBackup(storage, { modules: request.modules, now });
  const json = JSON.stringify(payload, null, 2);
  const rows = countRows(payload);

  if (request.format === 'base64') {
    const text = toBase64Utf8(json);
    logInfo('backup', '生成 Base64 备份文本', { modules: [...request.modules], rows });
    return { ...base, ok: true, text, bytes: new TextEncoder().encode(text).length, rows };
  }

  if (request.format === 'zip') {
    const encoder = new TextEncoder();
    const entries = [{ name: 'backup.json', data: encoder.encode(json) }];
    if (request.bundlePresets) {
      const snapshot = await storage.readMeta(PRESET_SNAPSHOT_META_KEY);
      if (snapshot !== undefined) {
        entries.push({ name: 'presets/snapshot.json', data: encoder.encode(snapshot) });
      }
      const content = await storage.readMeta(PRESET_CONTENT_META_KEY);
      if (content !== undefined) {
        entries.push({ name: 'presets/content.json', data: encoder.encode(content) });
      }
    }
    if (request.bundleLogs) {
      entries.push({ name: 'logs/dawn-tick.log', data: encoder.encode(logsText()) });
    }
    const bytes = zipStore(entries, { date: new Date(now) });
    const saved = await saveBinaryFile(name, bytes, { extension: 'zip', filterName: 'ZIP 整包' });
    const outcome = {
      ...base,
      ok: saved.ok,
      cancelled: saved.cancelled,
      path: saved.path,
      error: saved.error,
      bytes: bytes.length,
      rows,
    };
    if (outcome.ok) {
      logInfo('backup', '导出整包', {
        modules: [...request.modules],
        rows,
        entries: entries.map((entry) => entry.name),
      });
    } else if (!outcome.cancelled) {
      logWarn('backup', '导出整包失败', { error: outcome.error });
    }
    return outcome;
  }

  const saved = await saveTextFile(name, json, { extension: 'json', filterName: 'JSON 备份' });
  const outcome = {
    ...base,
    ok: saved.ok,
    cancelled: saved.cancelled,
    path: saved.path,
    error: saved.error,
    bytes: json.length,
    rows,
  };
  if (outcome.ok) {
    logInfo('backup', '导出备份', { modules: [...request.modules], rows });
  } else if (!outcome.cancelled) {
    logWarn('backup', '导出备份失败', { error: outcome.error });
  }
  return outcome;
}

/** 解析粘贴或选入的文本：JSON 与 Base64 都接受。 */
export function parseImportText(text: string): BackupPayload {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('内容为空');
  if (trimmed.startsWith('{')) return parseBackup(trimmed);
  return parseBackup(fromBase64Utf8(trimmed));
}

export interface ImportFileResult {
  payload: BackupPayload | null;
  error: string | null;
}

/** 读入备份文件：.json / .base64.txt 直接读文本，.zip 取包里的 backup.json。 */
export async function readImportFile(file: File): Promise<ImportFileResult> {
  try {
    if (file.name.toLowerCase().endsWith('.zip')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = await readZipEntries(bytes);
      const text = pickBackupText(entries);
      if (text === null) return { payload: null, error: '整包里没有 backup.json' };
      const payload = parseBackup(text);
      logInfo('backup', '读取整包', { name: file.name, entries: entries.size });
      return { payload, error: null };
    }
    return { payload: parseImportText(await file.text()), error: null };
  } catch (cause: unknown) {
    const error = cause instanceof Error ? cause.message : String(cause);
    logWarn('backup', '读取备份文件失败', { name: file.name, error });
    return { payload: null, error };
  }
}

/** 备份里有内容的模块，供导入界面默认勾选。 */
export function presentModules(payload: BackupPayload): BackupModule[] {
  const present = summarizeBackup(payload)
    .filter((item) => item.rows > 0)
    .map((item) => item.module);
  return present.length > 0 ? present : [...BACKUP_MODULES];
}

export async function importConfig(
  storage: Storage,
  payload: BackupPayload,
  options: { modules: readonly BackupModule[]; mode: ImportMode },
): Promise<ImportResult> {
  const result = await importBackup(storage, payload, {
    mode: options.mode,
    modules: options.modules,
  });
  logInfo('backup', '导入备份', {
    mode: options.mode,
    modules: [...options.modules],
    imported: result.imported,
    skipped: result.skipped,
    removed: result.removed,
  });
  return result;
}

export function importResultText(result: ImportResult, mode: ImportMode): string {
  const head =
    mode === 'skip'
      ? '保留现有数据'
      : mode === 'overwrite'
        ? '覆盖为备份内容'
        : mode === 'clear'
          ? '先清空所选模块再导入'
          : '按修改时间合并';
  const removed = result.removed > 0 ? `，清空 ${result.removed} 条` : '';
  return `${head}：写入 ${result.imported} 条，跳过 ${result.skipped} 条${removed}`;
}
