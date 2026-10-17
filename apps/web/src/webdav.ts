import {
  BACKUP_MODULES,
  exportBackup,
  importBackup,
  parseBackup,
  zipStore,
  type AppSettings,
  type BackupModule,
  type BackupPayload,
  type ImportResult,
  type Storage,
} from '@dawn-tick/core';
import { detectPlatform } from './platform-detect.ts';
import { PRESET_CONTENT_META_KEY, PRESET_SNAPSHOT_META_KEY } from './preset-update.ts';
import { logInfo, logWarn } from './log.ts';
import { pickBackupText, readZipEntries } from './zip-read.ts';

/** WebDAV 同步：整库快照 + 设置与预设打成一个 zip 传到远端目录。 */
/** Windows 走 Tauri 官方 http 插件，Android 由 Capacitor 接管 fetch，Web 用浏览器 fetch。 */

const FIXED_NAME = 'DawnTick-backup.zip';
/** 上次上传时间：判断远端是不是更新的依据 */
const LAST_UPLOAD_KEY = 'webdav_last_upload';
/** 上次自动同步日期，用于「每天一次」 */
const LAST_SYNC_KEY = 'webdav_last_sync';

export interface DavSettings {
  webdavUrl: string;
  webdavUser: string;
  webdavPassword: string;
  webdavHistory: boolean;
}

export function normalizeDavUrl(raw: string): string {
  const text = raw.trim();
  if (text === '') return '';
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  return withScheme.replace(/\/+$/, '');
}

export function davConfigured(settings: Pick<AppSettings, 'webdavUrl'>): boolean {
  return normalizeDavUrl(settings.webdavUrl).length > 0;
}

function basicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

/** 开启「保留历史多份」时按时间戳命名，否则固定名覆盖。 */
export function remoteName(now: number, history: boolean): string {
  if (!history) return FIXED_NAME;
  const date = new Date(now);
  const pad = (value: number): string => `${value}`.padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `DawnTick-backup-${stamp}.zip`;
}

export function remoteUrl(settings: Pick<AppSettings, 'webdavUrl'>, name: string): string {
  return `${normalizeDavUrl(settings.webdavUrl)}/${name}`;
}

async function davFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (detectPlatform() === 'tauri') {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, init);
  }
  return globalThis.fetch(url, init);
}

export interface DavStatus {
  ok: boolean;
  /** 远端是否存在固定名备份 */
  exists: boolean;
  status: number;
  lastModified: number | null;
  size: number | null;
  error: string | null;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function statusOf(response: Response): DavStatus {
  const modified = response.headers.get('last-modified');
  const length = response.headers.get('content-length');
  return {
    ok: response.status < 400,
    exists: response.ok,
    status: response.status,
    lastModified: modified === null ? null : Date.parse(modified) || null,
    size: length === null ? null : Number(length),
    error: null,
  };
}

/** 探测远端固定名备份：先 HEAD，服务器不支持就退回带 Range 的 GET。 */
export async function remoteStatus(settings: DavSettings): Promise<DavStatus> {
  const url = remoteUrl(settings, FIXED_NAME);
  const headers = { Authorization: basicAuth(settings.webdavUser, settings.webdavPassword) };
  try {
    const head = await davFetch(url, { method: 'HEAD', headers });
    if (head.status !== 405 && head.status !== 501) return statusOf(head);
    const ranged = await davFetch(url, { method: 'GET', headers: { ...headers, Range: 'bytes=0-0' } });
    return statusOf(ranged);
  } catch (cause: unknown) {
    return {
      ok: false,
      exists: false,
      status: 0,
      lastModified: null,
      size: null,
      error: describe(cause),
    };
  }
}

/** 测试连接：能读到远端详情即通过；401/403 给出鉴权提示。 */
export async function testConnection(settings: DavSettings): Promise<DavStatus> {
  if (!davConfigured(settings)) {
    return { ok: false, exists: false, status: 0, lastModified: null, size: null, error: '请先填写 WebDAV 地址' };
  }
  const status = await remoteStatus(settings);
  if (status.error !== null) return status;
  if (status.status === 401 || status.status === 403) {
    return { ...status, ok: false, error: '鉴权失败，请检查用户名与密码' };
  }
  if (status.status === 404) {
    return { ...status, ok: true, error: null };
  }
  if (status.status >= 400) {
    return { ...status, ok: false, error: `服务器返回 ${status.status}` };
  }
  return status;
}

export interface PackageResult {
  ok: boolean;
  name: string;
  bytes: number;
  error: string | null;
}

/** 打整包：backup.json + 预设快照与正文。 */
export async function buildPackage(
  storage: Storage,
  now = Date.now(),
): Promise<{ bytes: Uint8Array; payload: BackupPayload }> {
  const payload = await exportBackup(storage, { now, modules: BACKUP_MODULES });
  const encoder = new TextEncoder();
  const entries = [{ name: 'backup.json', data: encoder.encode(JSON.stringify(payload, null, 2)) }];
  const snapshot = await storage.readMeta(PRESET_SNAPSHOT_META_KEY);
  if (snapshot !== undefined) {
    entries.push({ name: 'presets/snapshot.json', data: encoder.encode(snapshot) });
  }
  const content = await storage.readMeta(PRESET_CONTENT_META_KEY);
  if (content !== undefined) {
    entries.push({ name: 'presets/content.json', data: encoder.encode(content) });
  }
  return { bytes: zipStore(entries, { date: new Date(now) }), payload };
}

export async function uploadPackage(
  storage: Storage,
  settings: DavSettings,
  now = Date.now(),
): Promise<PackageResult> {
  const name = remoteName(now, settings.webdavHistory);
  if (!davConfigured(settings)) {
    return { ok: false, name, bytes: 0, error: '请先填写 WebDAV 地址' };
  }
  try {
    const { bytes } = await buildPackage(storage, now);
    const response = await davFetch(remoteUrl(settings, name), {
      method: 'PUT',
      headers: {
        Authorization: basicAuth(settings.webdavUser, settings.webdavPassword),
        'Content-Type': 'application/zip',
      },
      body: new Uint8Array(bytes) as unknown as BodyInit,
    });
    if (!response.ok) {
      return { ok: false, name, bytes: bytes.length, error: `服务器返回 ${response.status}` };
    }
    await storage.writeMeta(LAST_UPLOAD_KEY, String(now));
    logInfo('webdav', '已上传同步包', { name, bytes: bytes.length });
    return { ok: true, name, bytes: bytes.length, error: null };
  } catch (cause: unknown) {
    const error = describe(cause);
    logWarn('webdav', '上传失败', { name, error });
    return { ok: false, name, bytes: 0, error };
  }
}

export interface DownloadResult {
  ok: boolean;
  name: string;
  bytes: Uint8Array | null;
  error: string | null;
}

/** 下载固定名同步包（历史多份时也要手动指定名字）。 */
export async function downloadPackage(
  settings: DavSettings,
  name = FIXED_NAME,
): Promise<DownloadResult> {
  if (!davConfigured(settings)) {
    return { ok: false, name, bytes: null, error: '请先填写 WebDAV 地址' };
  }
  try {
    const response = await davFetch(remoteUrl(settings, name), {
      method: 'GET',
      headers: { Authorization: basicAuth(settings.webdavUser, settings.webdavPassword) },
    });
    if (!response.ok) {
      return { ok: false, name, bytes: null, error: `服务器返回 ${response.status}` };
    }
    const buffer = await response.arrayBuffer();
    logInfo('webdav', '已下载同步包', { name, bytes: buffer.byteLength });
    return { ok: true, name, bytes: new Uint8Array(buffer), error: null };
  } catch (cause: unknown) {
    const error = describe(cause);
    logWarn('webdav', '下载失败', { name, error });
    return { ok: false, name, bytes: null, error };
  }
}

export type ApplyMode = 'all' | 'settings';

export interface ApplyOutcome {
  ok: boolean;
  error: string | null;
  /** 恢复全部时的结果 */
  full: ImportResult | null;
  /** 只应用设置与预设时的结果 */
  settings: ImportResult | null;
  /** 整包里带上了预设正文或清单 */
  presets: boolean;
}

/** 应用同步包：all 覆盖整库，settings 只写设置与预设（可热加载）。 */
export async function applyPackage(
  storage: Storage,
  bytes: Uint8Array,
  mode: ApplyMode,
): Promise<ApplyOutcome> {
  try {
    const entries = await readZipEntries(bytes);
    const text = pickBackupText(entries);
    if (text === null) {
      return { ok: false, error: '同步包里没有 backup.json', full: null, settings: null, presets: false };
    }
    const payload = parseBackup(text);
    const modules: readonly BackupModule[] = mode === 'all' ? BACKUP_MODULES : ['settings'];
    const result = await importBackup(storage, payload, {
      mode: mode === 'all' ? 'clear' : 'overwrite',
      modules: [...modules],
      now: Date.now(),
    });

    let presets = false;
    const snapshot = entries.get('presets/snapshot.json');
    if (snapshot !== undefined) {
      await storage.writeMeta(PRESET_SNAPSHOT_META_KEY, new TextDecoder().decode(snapshot));
      presets = true;
    }
    const content = entries.get('presets/content.json');
    if (content !== undefined) {
      await storage.writeMeta(PRESET_CONTENT_META_KEY, new TextDecoder().decode(content));
      presets = true;
    }
    logInfo('webdav', '已应用同步包', {
      mode,
      imported: result.imported,
      removed: result.removed,
      presets,
    });
    return {
      ok: true,
      error: null,
      full: mode === 'all' ? result : null,
      settings: mode === 'settings' ? result : null,
      presets,
    };
  } catch (cause: unknown) {
    const error = describe(cause);
    logWarn('webdav', '应用同步包失败', { mode, error });
    return { ok: false, error, full: null, settings: null, presets: false };
  }
}

export interface AutoSyncOutcome {
  action: 'skipped' | 'uploaded' | 'remote-newer' | 'error';
  name: string;
  detail: string | null;
}

export interface SyncApplyResult {
  ok: boolean;
  error: string | null;
  outcome: ApplyOutcome | null;
}

/** 下载同步包并应用：下载失败时不碰本机数据。 */
export async function downloadAndApply(
  storage: Storage,
  settings: DavSettings,
  mode: ApplyMode,
  name = FIXED_NAME,
): Promise<SyncApplyResult> {
  const download = await downloadPackage(settings, name);
  if (!download.ok || download.bytes === null) {
    return { ok: false, error: download.error ?? '下载失败', outcome: null };
  }
  const outcome = await applyPackage(storage, download.bytes, mode);
  return { ok: outcome.ok, error: outcome.error, outcome };
}

/** 自动同步：远端更新则提示下载，否则把本机状态传上去；只上传、不自动下载。 */
export async function maybeAutoSync(
  storage: Storage,
  settings: AppSettings,
  options: { startup: boolean; now?: number },
): Promise<AutoSyncOutcome> {
  if (!settings.webdavAuto || !davConfigured(settings)) {
    return { action: 'skipped', name: FIXED_NAME, detail: null };
  }
  const now = options.now ?? Date.now();
  if (!options.startup && !settings.webdavDaily) {
    return { action: 'skipped', name: FIXED_NAME, detail: null };
  }
  const today = new Date(now).toDateString();
  const lastSync = await storage.readMeta(LAST_SYNC_KEY);
  if (!options.startup && lastSync === today) {
    return { action: 'skipped', name: FIXED_NAME, detail: null };
  }
  if (options.startup && !settings.webdavOnStart && lastSync === today) {
    return { action: 'skipped', name: FIXED_NAME, detail: null };
  }
  const status = await remoteStatus(settings);
  if (status.error !== null) {
    return { action: 'error', name: FIXED_NAME, detail: status.error };
  }
  const lastUpload = Number((await storage.readMeta(LAST_UPLOAD_KEY)) ?? 0);
  if (status.exists && status.lastModified !== null && status.lastModified > lastUpload + 1000) {
    await storage.writeMeta(LAST_SYNC_KEY, today);
    return { action: 'remote-newer', name: FIXED_NAME, detail: '远端备份比本机上传的新' };
  }
  const uploaded = await uploadPackage(storage, settings, now);
  await storage.writeMeta(LAST_SYNC_KEY, today);
  return uploaded.ok
    ? { action: 'uploaded', name: uploaded.name, detail: null }
    : { action: 'error', name: uploaded.name, detail: uploaded.error };
}
