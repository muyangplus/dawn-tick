import type { Storage } from '@dawn-tick/core';
import { isAndroidApp, isDesktopApp } from './lib/capabilities.ts';
import { errorMessage } from './lib/errors.ts';
import { invokeNative, type LanSyncListen, type LanSyncRequest } from './lib/native.ts';
import { loadPlugin, type LanSyncPlugin } from './lib/plugins.ts';
import { logInfo, logWarn } from './log.ts';
import {
  createPairing,
  type Pairing,
  type TrustedToken,
} from './lan-sync-protocol.ts';
import type { LanHttpReply } from './lan-sync-payload.ts';

export * from './lan-sync-protocol.ts';
export * from './lan-sync-payload.ts';
export * from './lan-sync-client.ts';

/**
 * 局域网同步（I-14）的**服务端生命周期**：开/停监听、轮询原生队列、回写响应。
 *
 * 边界：
 * - 协议、地址、配对码与令牌在 `lan-sync-protocol.ts`，信封与请求处理在
 *   `lan-sync-payload.ts`，客户端配对/传输/状态机在 `lan-sync-client.ts`；
 * - 原生层（Rust / Kotlin）只做传输与限额；本模块只做 `invoke` / 插件调用与运行时状态；
 * - 原生监听绑定通配地址（0.0.0.0），对外广播的是选中网卡地址；
 * - 两边对照见 `apps/mobile/docs/lan-sync.contract.md`。
 */

/** 轮询原生请求队列的间隔。 */
export const LAN_SYNC_POLL_INTERVAL_MS = 400;

/** 是否能当服务端：桌面（Rust 监听）与安卓（Kotlin 监听）；浏览器不行。 */
export function canServeLanSync(): boolean {
  return isDesktopApp() || isAndroidApp();
}

/** 本机配对信息：对外展示的地址、配对码与到期时间。 */
export interface LanServerInfo {
  host: string;
  port: number;
  code: string;
  expiresAt: number;
  address: string;
}

export interface StartLanServerResult {
  ok: boolean;
  info: LanServerInfo | null;
  error: string | null;
}

/**
 * 原生「开始监听」的超时：安卓绑定 socket 与启动 UDP 广播都在后台线程，
 * 个别机型会卡住不回调；超过 8 秒按失败处理，让界面回到可重试状态。
 */
export const LAN_SERVER_START_TIMEOUT_MS = 8_000;

/** 超时原因：由 `startLanServer` 统一加上「开启配对失败：」前缀后展示。 */
export const LAN_SERVER_START_TIMEOUT_MESSAGE = '原生监听在 8 秒内没有响应，请确认已连接 Wi-Fi 后重试';

/** 失败文案统一前缀：超时与原生异常都拼在冒号后面，界面直接展示。 */
export const LAN_SERVER_START_ERROR_PREFIX = '开启配对失败：';

/** 把原因拼成可直接展示的一行；已带前缀时不重复。 */
export function startLanServerError(reason: string | null | undefined): string {
  const text = (reason ?? '').trim();
  if (text === '') return `${LAN_SERVER_START_ERROR_PREFIX}请稍后重试`;
  if (text.startsWith(LAN_SERVER_START_ERROR_PREFIX)) return text;
  return `${LAN_SERVER_START_ERROR_PREFIX}${text}`;
}

/** 给任意 Promise 加超时；超时后底层调用可能仍在进行，调用方按可重试处理。 */
export function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

/** 起监听的统一形状：桌面与安卓都归一到 `{host, port}`。 */
export type LanServerStarter = (host?: string) => Promise<LanSyncListen | null>;

/** 冒烟 / 单测注入：替代原生调用，验证超时与地址透传。 */
let starterOverride: LanServerStarter | null = null;

export function setLanServerStarterForTests(next: LanServerStarter | null): void {
  starterOverride = next;
}

async function defaultLanServerStarter(host?: string): Promise<LanSyncListen | null> {
  const selected = host === undefined || host.trim() === '' ? undefined : host.trim();
  if (isDesktopApp()) {
    return (
      (await invokeNative<LanSyncListen>(
        'lan_sync_start',
        selected === undefined ? undefined : { host: selected },
      )) ?? null
    );
  }
  const plugin = await loadPlugin<LanSyncPlugin>('LanSync');
  if (plugin === null) return null;
  const result = await plugin.start(selected === undefined ? undefined : { host: selected });
  if (typeof result.host !== 'string' || result.host === '' || typeof result.port !== 'number') {
    throw new Error('原生层没有返回监听地址与端口');
  }
  if (result.listening === false) {
    throw new Error('原生层报告监听没有开启');
  }
  return { host: result.host, port: result.port };
}

async function startNativeServer(
  host?: string,
  timeoutMs = LAN_SERVER_START_TIMEOUT_MS,
): Promise<LanSyncListen | null> {
  const starter = starterOverride ?? defaultLanServerStarter;
  return withTimeout(starter(host), timeoutMs, LAN_SERVER_START_TIMEOUT_MESSAGE);
}

export interface StartLanServerOptions {
  /** 用户在「切换网络」里选中的本机地址；缺省自动选首选局域网。 */
  host?: string | undefined;
  now?: number;
  /** 单测用：缩短超时，生产固定 8 秒。 */
  timeoutMs?: number;
}

/** 开启配对：原生起监听，配对码与有效期由 TS 生成（鉴权单一事实来源）。 */
export async function startLanServer(options: StartLanServerOptions = {}): Promise<StartLanServerResult> {
  const now = options.now ?? Date.now();
  if (!canServeLanSync()) {
    return { ok: false, info: null, error: startLanServerError('浏览器端不能开配对，请在桌面版或安卓版上操作') };
  }
  try {
    const listen = await startNativeServer(options.host, options.timeoutMs);
    if (listen === null) {
      return { ok: false, info: null, error: startLanServerError('当前平台不支持开启局域网配对') };
    }
    const pairing = createPairing(now);
    logInfo('lan-sync', '已开启局域网配对', { host: listen.host, port: listen.port });
    return {
      ok: true,
      info: {
        host: listen.host,
        port: listen.port,
        code: pairing.code,
        expiresAt: pairing.expiresAt,
        address: `${listen.host}:${listen.port}`,
      },
      error: null,
    };
  } catch (cause: unknown) {
    const reason = errorMessage(cause);
    logWarn('lan-sync', '开启局域网配对失败', { message: reason });
    return { ok: false, info: null, error: startLanServerError(reason) };
  }
}

/** 停止配对：原生关监听；已持久化到对方设备上的长期令牌由对方 `/pair/revoke` 移除。 */
export async function stopLanServer(): Promise<void> {
  try {
    if (isDesktopApp()) {
      await invokeNative('lan_sync_stop');
      return;
    }
    if (isAndroidApp()) {
      const plugin = await loadPlugin<LanSyncPlugin>('LanSync');
      await plugin?.stop();
    }
  } catch (cause: unknown) {
    logWarn('lan-sync', '停止局域网配对失败', { message: errorMessage(cause) });
  }
}

function toLanSyncRequest(raw: Partial<LanSyncRequest> | null | undefined): LanSyncRequest | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw.id !== 'number' || typeof raw.method !== 'string' || typeof raw.path !== 'string') {
    return null;
  }
  return {
    id: raw.id,
    method: raw.method,
    path: raw.path,
    query: typeof raw.query === 'string' ? raw.query : '',
    authorization: typeof raw.authorization === 'string' ? raw.authorization : null,
    body: typeof raw.body === 'string' ? raw.body : '',
    receivedAt: typeof raw.receivedAt === 'number' ? raw.receivedAt : Date.now(),
  };
}

/** 取一条待处理请求；没有返回 null。 */
export async function pollLanServer(): Promise<LanSyncRequest | null> {
  if (isDesktopApp()) {
    return toLanSyncRequest(await invokeNative<LanSyncRequest | null>('lan_sync_poll'));
  }
  if (isAndroidApp()) {
    const plugin = await loadPlugin<LanSyncPlugin>('LanSync');
    if (plugin === null) return null;
    return toLanSyncRequest(await plugin.poll());
  }
  return null;
}

/** 把处理结果交回原生层；原生层写回 HTTP 响应。 */
export async function respondLanServer(id: number, status: number, body: string): Promise<void> {
  if (isDesktopApp()) {
    await invokeNative('lan_sync_respond', { id, status, body });
    return;
  }
  if (isAndroidApp()) {
    const plugin = await loadPlugin<LanSyncPlugin>('LanSync');
    await plugin?.respond({ id, status, body });
  }
}

/** 服务端运行时状态：当前配对码与可信令牌列表（只含哈希）。 */
export interface LanRuntime {
  pairing: Pairing | null;
  tokens: readonly TrustedToken[];
}

/** `/pair` 成功后消耗配对码；响应带令牌快照时整体替换（刷新/吊销/新增设备）。 */
export function applyLanReply(runtime: LanRuntime, reply: LanHttpReply): LanRuntime {
  const tokens = reply.tokens ?? runtime.tokens;
  return {
    pairing: reply.consumePairing === true ? null : runtime.pairing,
    tokens,
  };
}

/** 服务端请求处理上下文：与 `LanServerContext` 对齐，界面只传 storage 与运行时状态。 */
export function lanServerContext(
  storage: Storage,
  runtime: LanRuntime,
  now?: number,
): { storage: Storage; pairing: Pairing | null; tokens: readonly TrustedToken[]; now?: number } {
  return now === undefined
    ? { storage, pairing: runtime.pairing, tokens: runtime.tokens }
    : { storage, pairing: runtime.pairing, tokens: runtime.tokens, now };
}
