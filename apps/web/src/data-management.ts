import {
  BACKUP_MODULES,
  exportBackup,
  importBackup,
  parseBackup,
  summarizeBackup,
  toBase64Utf8,
  fromBase64Utf8,
  type BackupModule,
  type BackupPayload,
  type ImportMode,
  type ImportResult,
  type Storage,
} from '@dawn-tick/core';
import { logInfo, logWarn, logsText } from './log.ts';
import {
  BackupCryptoError,
  decryptBackup,
  decryptBackupBytes,
  encryptBackup,
  encryptBackupBytes,
  isEncryptedBackup,
  isEncryptedBackupBytes,
} from './lib/backup-crypto.ts';
import { errorMessage } from './lib/errors.ts';
import { dayStampUtc } from './lib/dates.ts';
import { saveBinaryFile, saveTextFile } from './system-actions.ts';
import {
  applyPackageEntries,
  buildPackageBytes,
  buildPackageEntries,
  readPackageEntries,
  readPresetExtras,
  type PackageExtras,
} from './package.ts';

export type { PackageExtras } from './package.ts';

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
  /** 用口令加密导出内容；不传表示保持明文（历史行为） */
  password?: string | undefined;
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

/** 加密文本导出不再伪装成 .json：内容已是信封文本，扩展名跟内容一致。 */
export function exportFileName(format: ExportFormat, now = Date.now(), encrypted = false): string {
  const day = dayStampUtc(now);
  if (format === 'base64') return `DawnTick-backup-${day}.base64.txt`;
  if (format === 'zip') return `DawnTick-backup-${day}.zip`;
  return encrypted ? `DawnTick-backup-${day}.enc.txt` : `DawnTick-backup-${day}.json`;
}

function countRows(payload: BackupPayload): number {
  return Object.values(payload.stores).reduce(
    (total, rows) => total + (Array.isArray(rows) ? rows.length : 0),
    0,
  );
}

/** 导出内容需要加密时套信封；不传口令保持明文。 */
async function sealText(text: string, password: string | undefined): Promise<string> {
  return password === undefined ? text : encryptBackup(text, password);
}

async function sealBytes(bytes: Uint8Array, password: string | undefined): Promise<Uint8Array> {
  return password === undefined ? bytes : encryptBackupBytes(bytes, password);
}

/** 导出：按格式写出文件，或在 Base64 格式下只生成文本交给界面。 */
export async function exportConfig(storage: Storage, request: ExportRequest): Promise<ExportOutcome> {
  const now = request.now ?? Date.now();
  const password = request.password;
  const encrypted = password !== undefined;
  const name = exportFileName(request.format, now, encrypted);
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
  try {
    const payload = await exportBackup(storage, { modules: request.modules, now });
    const json = JSON.stringify(payload, null, 2);
    const rows = countRows(payload);

    if (request.format === 'base64') {
      const plain = toBase64Utf8(json);
      const text = await sealText(plain, password);
      logInfo('backup', encrypted ? '生成加密 Base64 备份文本' : '生成 Base64 备份文本', {
        modules: [...request.modules],
        rows,
      });
      return { ...base, ok: true, text, bytes: new TextEncoder().encode(text).length, rows };
    }

    if (request.format === 'zip') {
      const presets = request.bundlePresets ? await readPresetExtras(storage) : undefined;
      const logs = request.bundleLogs ? logsText() : undefined;
      const entries = buildPackageEntries({ backupJson: json, presets, logs });
      const plain = buildPackageBytes({ backupJson: json, presets, logs, now });
      const bytes = await sealBytes(plain, password);
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
        logInfo('backup', encrypted ? '导出加密整包' : '导出整包', {
          modules: [...request.modules],
          rows,
          entries: entries.map((entry) => entry.name),
        });
      } else if (!outcome.cancelled) {
        logWarn('backup', encrypted ? '导出加密整包失败' : '导出整包失败', { error: outcome.error });
      }
      return outcome;
    }

    const text = await sealText(json, password);
    const saved = await saveTextFile(
      name,
      text,
      encrypted ? { extension: 'txt', filterName: '加密备份文本' } : { extension: 'json', filterName: 'JSON 备份' },
    );
    const outcome = {
      ...base,
      ok: saved.ok,
      cancelled: saved.cancelled,
      path: saved.path,
      error: saved.error,
      bytes: new TextEncoder().encode(text).length,
      rows,
    };
    if (outcome.ok) {
      logInfo('backup', encrypted ? '导出加密备份' : '导出备份', {
        modules: [...request.modules],
        rows,
      });
    } else if (!outcome.cancelled) {
      logWarn('backup', encrypted ? '导出加密备份失败' : '导出备份失败', { error: outcome.error });
    }
    return outcome;
  } catch (cause: unknown) {
    const error = errorMessage(cause);
    logWarn('backup', encrypted ? '加密导出失败' : '导出备份失败', {
      format: request.format,
      error,
    });
    return { ...base, error };
  }
}

/** 解析粘贴或选入的明文文本：JSON 与 Base64 都接受；加密信封要走异步入口。 */
export function parseImportText(text: string): BackupPayload {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('内容为空');
  if (isEncryptedBackup(trimmed)) {
    throw new BackupCryptoError('password-required', '备份已加密，请输入口令后再导入');
  }
  if (trimmed.startsWith('{')) return parseBackup(trimmed);
  return parseBackup(fromBase64Utf8(trimmed));
}

export interface ImportFileResult {
  payload: BackupPayload | null;
  /** 整包里带的预设与日志；JSON / Base64 输入为 null */
  extras: PackageExtras | null;
  error: string | null;
  /** 内容是加密信封，需要口令；此时 payload、extras 为空 */
  locked: boolean;
}

function lockedResult(): ImportFileResult {
  // error 只给不走口令流程的入口兜底（例如引导页）；设置页看到 locked 会直接弹口令框
  return {
    payload: null,
    extras: null,
    error: '备份已加密，需要输入口令后才能导入',
    locked: true,
  };
}

function failedResult(error: string): ImportFileResult {
  return { payload: null, extras: null, error, locked: false };
}

/**
 * 读入备份文件：明文按 .zip / 文本分流，加密信封返回 `locked`，
 * 由界面收一次口令后再带 `password` 调用同一函数重试。
 */
export async function readImportFile(file: File, password?: string): Promise<ImportFileResult> {
  try {
    if (file.name.toLowerCase().endsWith('.zip')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isEncryptedBackupBytes(bytes)) {
        if (password === undefined) {
          logInfo('backup', '整包已加密，等待口令', { name: file.name });
          return lockedResult();
        }
        const plain = await decryptBackupBytes(bytes, password);
        const { payload, extras } = await readPackageEntries(plain);
        logInfo('backup', '读取加密整包', {
          name: file.name,
          presets: extras.presets.snapshot !== null || extras.presets.content !== null,
          logs: extras.logs !== null,
        });
        return { payload, extras, error: null, locked: false };
      }
      const { payload, extras } = await readPackageEntries(bytes);
      logInfo('backup', '读取整包', {
        name: file.name,
        presets: extras.presets.snapshot !== null || extras.presets.content !== null,
        logs: extras.logs !== null,
      });
      return { payload, extras, error: null, locked: false };
    }
    const text = await file.text();
    if (isEncryptedBackup(text)) {
      if (password === undefined) {
        logInfo('backup', '备份文件已加密，等待口令', { name: file.name });
        return lockedResult();
      }
      const payload = parseImportText(await decryptBackup(text, password));
      logInfo('backup', '读取加密备份文件', { name: file.name });
      return { payload, extras: null, error: null, locked: false };
    }
    return { payload: parseImportText(text), extras: null, error: null, locked: false };
  } catch (cause: unknown) {
    const error = errorMessage(cause);
    logWarn('backup', '读取备份文件失败', { name: file.name, error });
    return failedResult(error);
  }
}

/** 粘贴文本的导入入口：先识别加密信封，再解析 JSON / Base64。 */
export async function importPastedText(
  text: string,
  password?: string,
): Promise<ImportFileResult> {
  const trimmed = text.trim();
  if (trimmed === '') return failedResult('内容为空');
  if (!isEncryptedBackup(trimmed)) {
    try {
      return { payload: parseImportText(trimmed), extras: null, error: null, locked: false };
    } catch (cause: unknown) {
      return failedResult(errorMessage(cause));
    }
  }
  if (password === undefined) return lockedResult();
  try {
    // 解密出的内容可能是 JSON，也可能是 Base64（加密前是哪种就还是哪种）
    const payload = parseImportText(await decryptBackup(trimmed, password));
    logInfo('backup', '已解密粘贴的备份文本');
    return { payload, extras: null, error: null, locked: false };
  } catch (cause: unknown) {
    const error = errorMessage(cause);
    logWarn('backup', '解密备份文本失败', { error });
    return failedResult(error);
  }
}

/** 备份里有内容的模块，供导入界面默认勾选。 */
export function presentModules(payload: BackupPayload): BackupModule[] {
  const present = summarizeBackup(payload)
    .filter((item) => item.rows > 0)
    .map((item) => item.module);
  return present.length > 0 ? present : [...BACKUP_MODULES];
}

export interface ImportConfigResult extends ImportResult {
  /** 整包里带了预设且已写回 */
  presets: boolean;
  /** 整包里带了日志但未覆盖本机日志 */
  logsSkipped: boolean;
}

export async function importConfig(
  storage: Storage,
  payload: BackupPayload,
  options: { modules: readonly BackupModule[]; mode: ImportMode; extras?: PackageExtras | null },
): Promise<ImportConfigResult> {
  const result = await importBackup(storage, payload, {
    mode: options.mode,
    modules: options.modules,
  });
  const extras = options.extras ?? null;
  let presets = false;
  if (extras !== null && options.modules.includes('settings')) {
    const applied = await applyPackageEntries(storage, extras, { restorePresets: true });
    presets = applied.presets;
  }
  const logsSkipped = extras !== null && extras.logs !== null;
  logInfo('backup', '导入备份', {
    mode: options.mode,
    modules: [...options.modules],
    imported: result.imported,
    skipped: result.skipped,
    removed: result.removed,
    presets,
    logsSkipped,
  });
  return { ...result, presets, logsSkipped };
}

export function importResultText(
  result: ImportResult & { presets?: boolean; logsSkipped?: boolean },
  mode: ImportMode,
): string {
  const head =
    mode === 'skip'
      ? '保留现有数据'
      : mode === 'overwrite'
        ? '覆盖为备份内容'
        : mode === 'clear'
          ? '先清空所选模块再导入'
          : '按修改时间合并';
  const removed = result.removed > 0 ? `，清空 ${result.removed} 条` : '';
  const presets = result.presets === true ? '，已恢复预设' : '';
  const logs = result.logsSkipped === true ? '，日志未覆盖' : '';
  return `${head}：写入 ${result.imported} 条，跳过 ${result.skipped} 条${removed}${presets}${logs}`;
}
