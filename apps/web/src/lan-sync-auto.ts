import { LAN_SCOPES, parseScope, formatScope, type LanScope } from './lan-sync-protocol.ts';

/**
 * 局域网同步二期：后台自动同步策略。
 *
 * 边界：
 * - 纯策略 + localStorage 配置编解码，不直接跑网络；
 * - 自动同步只使用当前内存里的配对会话（一期令牌 10 分钟有效，不落盘）；
 *   令牌过期或重启后需要用户重新配对，策略会把「没有可同步的配对」当作跳过；
 * - 失败静默重试一次，仍失败只记日志，不弹提示；
 * - 协议见 `apps/mobile/docs/lan-sync.contract.md`。
 */

export type LanAutoMode = 'off' | 'startup' | 'interval30';

export const LAN_AUTO_MODES: readonly LanAutoMode[] = ['off', 'startup', 'interval30'];
export const LAN_AUTO_MODE_LABEL: Record<LanAutoMode, string> = {
  off: '关闭',
  startup: '每次启动',
  interval30: '每 30 分钟',
};
/** 30 分钟自动同步间隔。 */
export const LAN_AUTO_INTERVAL_MS = 30 * 60_000;
/** 本地配置键：只放模式、范围与上次运行时间，不放配对码或令牌。 */
export const LAN_AUTO_STORAGE_KEY = 'dt.lan.auto.v1';

export interface LanAutoConfig {
  mode: LanAutoMode;
  scopes: LanScope[];
  lastRunAt: number | null;
}

export function defaultAutoConfig(): LanAutoConfig {
  return { mode: 'off', scopes: [...LAN_SCOPES], lastRunAt: null };
}

export function parseAutoConfig(raw: string | null | undefined): LanAutoConfig {
  if (raw === null || raw === undefined || raw.trim() === '') return defaultAutoConfig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultAutoConfig();
  }
  if (typeof parsed !== 'object' || parsed === null) return defaultAutoConfig();
  const value = parsed as Partial<LanAutoConfig>;
  const mode = LAN_AUTO_MODES.includes(value.mode as LanAutoMode) ? (value.mode as LanAutoMode) : 'off';
  const scopes = Array.isArray(value.scopes)
    ? parseScope(value.scopes.filter((item) => typeof item === 'string').join(','))
    : [...LAN_SCOPES];
  const lastRunAt =
    typeof value.lastRunAt === 'number' && Number.isFinite(value.lastRunAt) && value.lastRunAt > 0
      ? value.lastRunAt
      : null;
  return { mode, scopes: scopes.length > 0 ? scopes : [...LAN_SCOPES], lastRunAt };
}

export function serializeAutoConfig(config: LanAutoConfig): string {
  return JSON.stringify({
    mode: config.mode,
    scopes: LAN_SCOPES.filter((scope) => config.scopes.includes(scope)),
    lastRunAt: config.lastRunAt,
  });
}

interface AutoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 读本机自动同步配置；localStorage 不可用或内容损坏时回退默认值。 */
export function loadAutoConfig(storage: AutoStorage | undefined = globalThis.localStorage): LanAutoConfig {
  try {
    return parseAutoConfig(storage?.getItem(LAN_AUTO_STORAGE_KEY));
  } catch {
    return defaultAutoConfig();
  }
}

/** 写本机自动同步配置；只存模式、范围与上次运行时间，不存配对码或令牌。 */
export function saveAutoConfig(config: LanAutoConfig, storage: AutoStorage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(LAN_AUTO_STORAGE_KEY, serializeAutoConfig(config));
  } catch {
    // 浏览器禁用 localStorage：自动同步只在本次会话生效
  }
}

/** 自动同步的范围文案，例如「课表、待办」。 */
export function formatAutoScopes(config: LanAutoConfig): string {
  return formatScope(config.scopes);
}

/**
 * 是否该跑一次。
 *
 * - `startup`：本次启动（`launchAt`）还没跑过；
 * - `interval30`：从没跑过，或距上次已满 30 分钟。
 * 配了对但范围为空时跳过，避免发出空请求。
 */
export function shouldAutoSync(config: LanAutoConfig, now: number, launchAt: number): boolean {
  if (config.mode === 'off') return false;
  if (config.scopes.length === 0) return false;
  if (config.lastRunAt === null) return true;
  if (config.mode === 'startup') return config.lastRunAt < launchAt;
  return now - config.lastRunAt >= LAN_AUTO_INTERVAL_MS;
}

/** 距离下一次检查的毫秒数：给 UI 的定时器用。 */
export function nextAutoDelay(config: LanAutoConfig, now: number): number {
  if (config.mode !== 'interval30' || config.lastRunAt === null) return 0;
  return Math.max(0, config.lastRunAt + LAN_AUTO_INTERVAL_MS - now);
}

export interface AutoRetryResult<T> {
  ok: boolean;
  value: T | null;
  attempts: number;
  error: string | null;
}

/**
 * 失败静默重试一次：第一次失败等 `retryDelayMs` 再试，第二次仍失败就返回错误；
 * 日志由调用方按 `onAttempt` 决定，本函数不碰 UI。
 */
export async function runAutoWithRetry<T>(
  task: () => Promise<T>,
  isOk: (value: T) => boolean,
  retryDelayMs = 1000,
): Promise<AutoRetryResult<T>> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const value = await task();
      if (isOk(value)) return { ok: true, value, attempts: attempt, error: null };
      lastError = '自动同步没有成功';
    } catch (cause: unknown) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
    if (attempt === 1 && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return { ok: false, value: null, attempts: 2, error: lastError ?? '自动同步失败' };
}
