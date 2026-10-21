import type { Storage } from '@dawn-tick/core';
import { isAndroidApp, isDesktopApp, supportsNativeHttp } from './lib/capabilities.ts';
import { errorMessage } from './lib/errors.ts';
import { invokeNative, type LanSyncListen, type LanSyncRequest } from './lib/native.ts';
import { loadPlugin, type LanSyncPlugin } from './lib/plugins.ts';
import { logInfo, logWarn } from './log.ts';
import {
  LAN_SYNC_PROTOCOL_VERSION,
  MAX_REQUEST_BYTES,
  SESSION_TTL_MS,
  createPairing,
  formatScope,
  peerBaseUrl,
  type LanScope,
  type Pairing,
  type PeerAddress,
  type SessionGrant,
} from './lan-sync-protocol.ts';
import {
  applyLanEnvelope,
  buildLanEnvelope,
  parseLanEnvelope,
  type LanHttpReply,
} from './lan-sync-payload.ts';

export * from './lan-sync-protocol.ts';
export * from './lan-sync-payload.ts';

/**
 * 局域网同步（I-14）的客户端与服务端生命周期。
 *
 * 边界：
 * - 协议、范围与配对码在 `lan-sync-protocol.ts`，信封与服务端请求处理在
 *   `lan-sync-payload.ts`，这里只做 `fetch` / 原生桥 / 状态机；
 *   两端对照见 `apps/mobile/docs/lan-sync.contract.md`；
 * - 浏览器只做发起方；桌面与安卓既能开配对也能连对方；
 * - 原生层只转发，鉴权与数据处理都在 TS：轮询到的请求交给 `handleLanRequest`。
 */

/** 轮询原生请求队列的间隔。 */
export const LAN_SYNC_POLL_INTERVAL_MS = 400;

/** 是否能当服务端：桌面（Rust 监听）与安卓（Kotlin 监听）；浏览器不行。 */
export function canServeLanSync(): boolean {
  return isDesktopApp() || isAndroidApp();
}

/** 本机配对信息：监听地址、配对码与到期时间。 */
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

async function startNativeServer(): Promise<LanSyncListen | null> {
  if (isDesktopApp()) {
    return (await invokeNative<LanSyncListen>('lan_sync_start')) ?? null;
  }
  const plugin = await loadPlugin<LanSyncPlugin>('LanSync');
  if (plugin === null) return null;
  const result = await plugin.start();
  if (typeof result.host !== 'string' || result.host === '' || typeof result.port !== 'number') {
    return null;
  }
  return { host: result.host, port: result.port };
}

/** 开启配对：原生起监听，配对码与有效期由 TS 生成（鉴权单一事实来源）。 */
export async function startLanServer(now = Date.now()): Promise<StartLanServerResult> {
  if (!canServeLanSync()) {
    return { ok: false, info: null, error: '浏览器端不能开配对，请在桌面版或安卓版上操作' };
  }
  try {
    const listen = await startNativeServer();
    if (listen === null) return { ok: false, info: null, error: '当前平台不支持开启局域网配对' };
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
    logWarn('lan-sync', '开启局域网配对失败', { message: errorMessage(cause) });
    return { ok: false, info: null, error: errorMessage(cause) };
  }
}

/** 停止配对：原生关监听，内存里的令牌随之失效。 */
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

/** 服务端内存状态：当前配对码与已授权会话。 */
export interface LanRuntime {
  pairing: Pairing | null;
  session: SessionGrant | null;
}

/** `/pair` 成功后消耗配对码、保存新会话；纯函数，便于单测。 */
export function applyLanReply(runtime: LanRuntime, reply: LanHttpReply): LanRuntime {
  return {
    pairing: reply.consumePairing === true ? null : runtime.pairing,
    session: reply.session ?? runtime.session,
  };
}

async function lanFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (supportsNativeHttp()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, init);
  }
  return globalThis.fetch(url, init);
}

function responseError(status: number, text: string, action: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === 'string' && message !== '') return message;
  } catch {
    // 非 JSON 错误体：退回状态码文案
  }
  return `${action}失败（HTTP ${status}）`;
}

/** 已配对的对方：地址 + 一次性会话令牌。 */
export interface LanSession {
  peer: PeerAddress;
  token: string;
  expiresAt: number;
}

export function sessionExpired(session: LanSession, now = Date.now()): boolean {
  return now >= session.expiresAt;
}

export interface PairPeerResult {
  ok: boolean;
  session: LanSession | null;
  error: string | null;
}

/** 客户端配对：`POST /pair` 换令牌。 */
export async function pairWithPeer(
  peer: PeerAddress,
  code: string,
  now = Date.now(),
): Promise<PairPeerResult> {
  if (!/^\d{6}$/.test(code.trim())) {
    return { ok: false, session: null, error: '配对码应为 6 位数字' };
  }
  try {
    const response = await lanFetch(`${peerBaseUrl(peer)}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim(), schemaVersion: LAN_SYNC_PROTOCOL_VERSION }),
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, session: null, error: responseError(response.status, text, '配对') };
    const body = JSON.parse(text) as { token?: unknown; expiresAt?: unknown };
    if (typeof body.token !== 'string' || body.token === '') {
      return { ok: false, session: null, error: '配对响应缺少会话令牌' };
    }
    const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : now + SESSION_TTL_MS;
    logInfo('lan-sync', '已与对方配对', { peer: `${peer.host}:${peer.port}` });
    return { ok: true, session: { peer, token: body.token, expiresAt }, error: null };
  } catch (cause: unknown) {
    const error = errorMessage(cause);
    logWarn('lan-sync', '配对失败', { peer: `${peer.host}:${peer.port}`, error });
    return { ok: false, session: null, error };
  }
}

export interface LanTransferResult {
  ok: boolean;
  imported: number;
  skipped: number;
  warnings: string[];
  error: string | null;
  bytes: number;
}

function transferFailure(error: string): LanTransferResult {
  return { ok: false, imported: 0, skipped: 0, warnings: [], error, bytes: 0 };
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 拉取：`GET /export` → 按 merge 规则合并进本机；设置项由调用方热加载。 */
export async function pullFromPeer(
  storage: Storage,
  session: LanSession,
  scopes: readonly LanScope[],
  now = Date.now(),
): Promise<LanTransferResult> {
  if (scopes.length === 0) return transferFailure('请至少勾选一个同步范围');
  if (sessionExpired(session, now)) return transferFailure('配对已过期，请重新配对');
  try {
    const response = await lanFetch(`${peerBaseUrl(session.peer)}/export?scope=${formatScope(scopes)}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    const text = await response.text();
    if (!response.ok) return transferFailure(responseError(response.status, text, '拉取'));
    const envelope = parseLanEnvelope(text);
    const result = await applyLanEnvelope(storage, envelope, { scopes, mode: 'merge', now });
    logInfo('lan-sync', '已从对方拉取', { imported: result.imported, skipped: result.skipped });
    return {
      ok: true,
      imported: result.imported,
      skipped: result.skipped,
      warnings: result.warnings,
      error: null,
      bytes: utf8Length(text),
    };
  } catch (cause: unknown) {
    const error = errorMessage(cause);
    logWarn('lan-sync', '拉取失败', { error });
    return transferFailure(error);
  }
}

/** 推送：`POST /import?mode=merge`；冲突按 updated_at 由接收端裁决。 */
export async function pushToPeer(
  storage: Storage,
  session: LanSession,
  scopes: readonly LanScope[],
  now = Date.now(),
): Promise<LanTransferResult> {
  if (scopes.length === 0) return transferFailure('请至少勾选一个同步范围');
  if (sessionExpired(session, now)) return transferFailure('配对已过期，请重新配对');
  try {
    const envelope = await buildLanEnvelope(storage, scopes, now);
    const body = JSON.stringify(envelope);
    const bytes = utf8Length(body);
    if (bytes > MAX_REQUEST_BYTES) return transferFailure('要推送的数据超过 5MB，请缩小同步范围');
    const response = await lanFetch(
      `${peerBaseUrl(session.peer)}/import?scope=${formatScope(scopes)}&mode=merge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body,
      },
    );
    const text = await response.text();
    if (!response.ok) return transferFailure(responseError(response.status, text, '推送'));
    const parsed = JSON.parse(text) as { imported?: unknown; skipped?: unknown; warnings?: unknown };
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === 'string')
      : [];
    logInfo('lan-sync', '已推送到对方', { imported: parsed.imported ?? 0 });
    return {
      ok: true,
      imported: typeof parsed.imported === 'number' ? parsed.imported : 0,
      skipped: typeof parsed.skipped === 'number' ? parsed.skipped : 0,
      warnings,
      error: null,
      bytes,
    };
  } catch (cause: unknown) {
    const error = errorMessage(cause);
    logWarn('lan-sync', '推送失败', { error });
    return transferFailure(error);
  }
}

/** 客户端状态机：空闲 → 配对中 → 已配对 / 失败，超时自动退回空闲。 */
export type LanClientPhase = 'idle' | 'pairing' | 'paired' | 'failed';

export interface LanClientState {
  phase: LanClientPhase;
  session: LanSession | null;
  error: string | null;
}

export const LAN_CLIENT_IDLE: LanClientState = { phase: 'idle', session: null, error: null };

export type LanClientEvent =
  | { type: 'pairing' }
  | { type: 'paired'; session: LanSession }
  | { type: 'failed'; error: string }
  | { type: 'reset' }
  | { type: 'expire'; now: number };

export function reduceLanClient(state: LanClientState, event: LanClientEvent): LanClientState {
  switch (event.type) {
    case 'pairing':
      return { phase: 'pairing', session: null, error: null };
    case 'paired':
      return { phase: 'paired', session: event.session, error: null };
    case 'failed':
      return { phase: 'failed', session: null, error: event.error };
    case 'reset':
      return LAN_CLIENT_IDLE;
    case 'expire':
      if (state.session === null || event.now < state.session.expiresAt) return state;
      return { phase: 'idle', session: null, error: '配对已过期，请重新配对' };
  }
}
