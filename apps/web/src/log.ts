import type { Storage } from '@dawn-tick/core';
import { detectPlatform } from './platform-detect.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
  detail?: Record<string, unknown>;
}

export const LOG_META_KEY = 'app_log';
const MAX_ENTRIES = 300;
/** dev / beta 渠道记录 debug 级日志；release 只留 info 及以上。 */
const DEBUG_ENABLED = __DT_CHANNEL__ !== 'release';

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
  if (level === 'debug' && !DEBUG_ENABLED) return;
  const entry: LogEntry = { at: Date.now(), level, scope, message, ...(detail === undefined ? {} : { detail }) };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  const line = `[${platformLabel()}] ${scope}: ${message}`;
  if (level === 'error') console.error(line, detail ?? '');
  else if (level === 'warn') console.warn(line, detail ?? '');
  else if (level === 'debug') console.debug(line, detail ?? '');
  else console.info(line, detail ?? '');
  void writeToNative(entry);
  scheduleFlush();
}

/** 调试日志：dev / beta 渠道完整记录；release 渠道自动丢弃。 */
export function logDebug(scope: string, message: string, detail?: Record<string, unknown>): void {
  record('debug', scope, message, detail);
}

export function debugEnabled(): boolean {
  return DEBUG_ENABLED;
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

/**
 * 日志时间戳：`2026-10-13 18:01:34.123 +08:00`。
 * 与原生侧 `startup.log` 同一口径（本地时间 + 与 UTC 的偏移，毫秒精度）。
 */
export function formatLogTimestamp(at: number): string {
  const date = new Date(at);
  const pad = (value: number, width = 2): string => String(Math.abs(value)).padStart(width, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)} ` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

export function logsText(): string {
  return buffer
    .map((entry) => {
      const detail = entry.detail === undefined ? '' : ` ${JSON.stringify(entry.detail)}`;
      return `${formatLogTimestamp(entry.at)} [${entry.level}] ${entry.scope}: ${entry.message}${detail}`;
    })
    .join('\n');
}

/** 导出后清空，避免日志无限累积。 */
export async function clearLogs(): Promise<void> {
  buffer = [];
  await flush();
}
