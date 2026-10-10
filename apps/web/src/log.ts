import type { Storage } from '@dawn-tick/core';
import { detectPlatform } from './platform-detect.ts';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
  detail?: Record<string, unknown>;
}

export const LOG_META_KEY = 'app_log';
const MAX_ENTRIES = 300;

let buffer: LogEntry[] = [];
let storage: Storage | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function platformLabel(): string {
  return detectPlatform();
}

async function writeToNative(entry: LogEntry): Promise<void> {
  if (detectPlatform() !== 'tauri') return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('log_event', {
      level: entry.level,
      scope: entry.scope,
      message: entry.message,
    });
  } catch {
    // 原生日志不可用时仅保留内存与本地存储
  }
}

function scheduleFlush(): void {
  if (storage === null || flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 400);
}

async function flush(): Promise<void> {
  if (storage === null) return;
  try {
    await storage.writeMeta(LOG_META_KEY, JSON.stringify(buffer));
  } catch {
    // 日志写入失败不影响主流程
  }
}

export function attachLogStorage(target: Storage): void {
  storage = target;
}

export async function loadLogs(): Promise<void> {
  if (storage === null) return;
  try {
    const raw = await storage.readMeta(LOG_META_KEY);
    if (raw === null || raw === undefined || raw === '') return;
    const parsed = JSON.parse(raw) as LogEntry[];
    if (Array.isArray(parsed)) buffer = parsed.slice(-MAX_ENTRIES);
  } catch {
    buffer = [];
  }
}

function record(level: LogLevel, scope: string, message: string, detail?: Record<string, unknown>): void {
  const entry: LogEntry = { at: Date.now(), level, scope, message, ...(detail === undefined ? {} : { detail }) };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  const line = `[${platformLabel()}] ${scope}: ${message}`;
  if (level === 'error') console.error(line, detail ?? '');
  else if (level === 'warn') console.warn(line, detail ?? '');
  else console.debug(line, detail ?? '');
  void writeToNative(entry);
  scheduleFlush();
}

export function logInfo(scope: string, message: string, detail?: Record<string, unknown>): void {
  record('info', scope, message, detail);
}

export function logWarn(scope: string, message: string, detail?: Record<string, unknown>): void {
  record('warn', scope, message, detail);
}

export function logError(scope: string, message: string, detail?: Record<string, unknown>): void {
  record('error', scope, message, detail);
}

export function logEntries(): readonly LogEntry[] {
  return buffer;
}

export function logsText(): string {
  return buffer
    .map((entry) => {
      const time = new Date(entry.at).toISOString();
      const detail = entry.detail === undefined ? '' : ` ${JSON.stringify(entry.detail)}`;
      return `${time} [${entry.level}] ${entry.scope}: ${entry.message}${detail}`;
    })
    .join('\n');
}

/** 导出后清空，避免日志无限累积。 */
export async function clearLogs(): Promise<void> {
  buffer = [];
  await flush();
}
