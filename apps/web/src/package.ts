import { parseBackup, zipStore, type BackupPayload, type Storage } from '@dawn-tick/core';
import { PRESET_CONTENT_META_KEY, PRESET_SNAPSHOT_META_KEY } from './preset-update.ts';
import { pickBackupText, readZipEntries } from './zip-read.ts';

/**
 * 整包格式：`backup.json` + 可选 `presets/snapshot.json`、`presets/content.json`、`logs/dawn-tick.log`。
 * 导出侧与导入侧共用这一处，避免应用内导入与 WebDAV 各写一套。
 */

export interface PackagePresets {
  snapshot: string | null;
  content: string | null;
}

export interface PackageExtras {
  presets: PackagePresets;
  logs: string | null;
}

export const EMPTY_PACKAGE_EXTRAS: PackageExtras = {
  presets: { snapshot: null, content: null },
  logs: null,
};

export interface PackageInput {
  backupJson: string;
  presets?: PackagePresets | undefined;
  logs?: string | null | undefined;
  now?: number | undefined;
}

export interface PackageEntry {
  name: string;
  data: Uint8Array;
}

/** 拼整包条目：只按内容有无决定是否放预设与日志。 */
export function buildPackageEntries(input: PackageInput): PackageEntry[] {
  const encoder = new TextEncoder();
  const entries: PackageEntry[] = [
    { name: 'backup.json', data: encoder.encode(input.backupJson) },
  ];
  const snapshot = input.presets?.snapshot ?? null;
  if (snapshot !== null) {
    entries.push({ name: 'presets/snapshot.json', data: encoder.encode(snapshot) });
  }
  const content = input.presets?.content ?? null;
  if (content !== null) {
    entries.push({ name: 'presets/content.json', data: encoder.encode(content) });
  }
  if (typeof input.logs === 'string') {
    entries.push({ name: 'logs/dawn-tick.log', data: encoder.encode(input.logs) });
  }
  return entries;
}

/** 拼整包并压成 zip 字节。 */
export function buildPackageBytes(input: PackageInput): Uint8Array {
  return zipStore(buildPackageEntries(input), { date: new Date(input.now ?? Date.now()) });
}

/** 从库内元数据取当前预设快照与正文，供导出侧打包。 */
export async function readPresetExtras(storage: Storage): Promise<PackagePresets> {
  const [snapshot, content] = await Promise.all([
    storage.readMeta(PRESET_SNAPSHOT_META_KEY),
    storage.readMeta(PRESET_CONTENT_META_KEY),
  ]);
  return { snapshot: snapshot ?? null, content: content ?? null };
}

export interface ReadPackageResult {
  payload: BackupPayload;
  extras: PackageExtras;
}

/** 读整包：备份正文走 `parseBackup`，预设与日志原样带出。 */
export async function readPackageEntries(bytes: Uint8Array): Promise<ReadPackageResult> {
  const entries = await readZipEntries(bytes);
  const text = pickBackupText(entries);
  if (text === null) throw new Error('整包里没有 backup.json');
  const decoder = new TextDecoder();
  const snapshot = entries.get('presets/snapshot.json');
  const content = entries.get('presets/content.json');
  const logs = entries.get('logs/dawn-tick.log');
  return {
    payload: parseBackup(text),
    extras: {
      presets: {
        snapshot: snapshot === undefined ? null : decoder.decode(snapshot),
        content: content === undefined ? null : decoder.decode(content),
      },
      logs: logs === undefined ? null : decoder.decode(logs),
    },
  };
}

export interface ApplyExtrasOutcome {
  /** 是否写回了预设快照或正文 */
  presets: boolean;
  /** 整包里带了日志但未覆盖本机日志 */
  logsSkipped: boolean;
}

/** 写回整包里的预设；日志只读不写（导出侧日志不得覆盖本机日志）。 */
export async function applyPackageEntries(
  storage: Storage,
  extras: PackageExtras,
  options: { restorePresets?: boolean } = {},
): Promise<ApplyExtrasOutcome> {
  let presets = false;
  if (options.restorePresets !== false) {
    if (extras.presets.snapshot !== null) {
      await storage.writeMeta(PRESET_SNAPSHOT_META_KEY, extras.presets.snapshot);
      presets = true;
    }
    if (extras.presets.content !== null) {
      await storage.writeMeta(PRESET_CONTENT_META_KEY, extras.presets.content);
      presets = true;
    }
  }
  return { presets, logsSkipped: extras.logs !== null };
}
