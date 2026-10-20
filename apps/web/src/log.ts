import type { Storage } from '@dawn-tick/core';
import { readMetaJson, writeMetaJson } from './lib/meta.ts';
import { LOG_META_KEY } from './lib/meta-keys.ts';
import { supportsNativeLog } from './lib/capabilities.ts';
import { invokeNative } from './lib/native.ts';
import { detectPlatform } from './platform-detect.ts';

export { LOG_META_KEY };

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** 日志级别次序：数值越大越详细。 */
export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];
const LEVEL_RANK: Record<LogLevel, number> = { error: 1, warn: 2, info: 3, debug: 4, trace: 5 };

export interface LogEntry {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
  detail?: Record<string, unknown>;
}

declare const __DT_CHANNEL__: string | undefined;
const MAX_ENTRIES = 300;

/** dev 渠道默认 trace（最详细），其余渠道默认 info。 */
export function defaultLogLevel(channel: string): LogLevel {
  return channel === 'dev' ? 'trace' : 'info';
}

let currentLevel: LogLevel = defaultLogLevel(typeof __DT_CHANNEL__ === 'string' ? __DT_CHANNEL__ : 'dev');
let fileEnabled = true;

/** 设置里的「应用诊断日志」：级别门槛 + 是否写 dawn-tick.log（控制台始终输出）。 */
export function applyLogSettings(options: { level: LogLevel; fileEnabled: boolean }): void {
  currentLevel = options.level;
  fileEnabled = options.fileEnabled;
  void (async () => {
    if (!supportsNativeLog()) return;
    try {
      await invokeNative('set_log_settings', { level: options.level, fileEnabled: options.fileEnabled });
    } catch {
      // 原生日志不可用时只影响内存与本地存储
    }
  })();
}

export function logLevel(): LogLevel {
  return currentLevel;
}

/** 异常转一行内部原因：界面只显示用户语言，原始信息只进日志。 */
export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function logFileEnabled(): boolean {
  return fileEnabled;
}

function allowed(level: LogLevel): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[currentLevel];
}

let buffer: LogEntry[] = [];
let storage: Storage | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function platformLabel(): string {
  return detectPlatform();
}

async function writeToNative(entry: LogEntry): Promise<void> {
  if (!supportsNativeLog()) return;
  try {
    await invokeNative('log_event', {
      level: entry.level,
      scope: entry.scope,
      message: entry.message,
      detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
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
    // scope 传 null：写日志失败不能再记一条日志，否则会自触发下一轮 flush
    await writeMetaJson(storage, LOG_META_KEY, buffer, { scope: null });
  } catch {
    // 日志写入失败不影响主流程
  }
}

export function attachLogStorage(target: Storage): void {
  storage = target;
}

/** 校验落盘日志：只收结构完整的行，坏行丢弃；整体不是数组时返回 null 交给兜底。 */
function parseLogEntries(value: unknown): LogEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: LogEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const at = record['at'];
    const level = record['level'];
    const scope = record['scope'];
    const message = record['message'];
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (typeof level !== 'string' || !(LOG_LEVELS as readonly string[]).includes(level)) continue;
    if (typeof scope !== 'string' || typeof message !== 'string') continue;
    const entry: LogEntry = { at, level: level as LogLevel, scope, message };
    const detail = record['detail'];
    if (detail !== null && typeof detail === 'object' && !Array.isArray(detail)) {
      entry.detail = detail as Record<string, unknown>;
    }
    entries.push(entry);
  }
  return entries;
}

export async function loadLogs(): Promise<void> {
  if (storage === null) return;
  const loaded = await readMetaJson<LogEntry[] | null>(storage, LOG_META_KEY, {
    parse: parseLogEntries,
    fallback: null,
    scope: 'log',
  });
  // null = 没存过或读不出：保留内存里已有的条目
  if (loaded !== null) buffer = loaded.slice(-MAX_ENTRIES);
}

function record(level: LogLevel, scope: string, message: string, detail?: Record<string, unknown>): void {
  // release 渠道不记 debug；其余渠道四个等级全部记录，控制台、文件与导出一致
  if (!allowed(level)) return;
  const entry: LogEntry = { at: Date.now(), level, scope, message, ...(detail === undefined ? {} : { detail }) };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  const line = `${formatLogTimestamp(entry.at)} [${level}] [${platformLabel()}] ${scope}: ${message}`;
  if (level === 'error') console.error(line, detail ?? '');
  else if (level === 'warn') console.warn(line, detail ?? '');
  else if (level === 'debug') console.debug(line, detail ?? '');
  else if (level === 'trace') console.debug(line, detail ?? '');
  else console.info(line, detail ?? '');
  void writeToNative(entry);
  scheduleFlush();
}

/** 未捕获的异常与未处理的 Promise 也写进日志。 */
export function installLogHandlers(): void {
  const target = globalThis as {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  };
  if (typeof target.addEventListener !== 'function') return;
  target.addEventListener('error', (event) => {
    const detail = event as { message?: string; filename?: string; lineno?: number; error?: { stack?: string } };
    logError('runtime', detail.message ?? '脚本错误', {
      file: detail.filename ?? '',
      line: detail.lineno ?? 0,
      stack: detail.error?.stack ?? '',
    });
  });
  target.addEventListener('unhandledrejection', (event) => {
    const reason = (event as { reason?: unknown }).reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? (reason.stack ?? '') : '';
    logError('runtime', `未处理的失败：${message}`, { stack });
  });
}

/** 调试日志（第 4 级）。 */
export function logDebug(scope: string, message: string, detail?: Record<string, unknown>): void {
  record('debug', scope, message, detail);
}

/** 最详细一级：请求/响应、解析细节等。 */
export function logTrace(scope: string, message: string, detail?: Record<string, unknown>): void {
  record('trace', scope, message, detail);
}

export function debugEnabled(): boolean {
  return allowed('debug');
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

/** 日志时间戳：`2026-10-13 18:01:34.123 +08:00`；与原生侧 `startup.log` 同口径（本地时间 + UTC 偏移，毫秒）。 */
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
