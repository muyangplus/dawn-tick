import type { Storage } from '@dawn-tick/core';
import { isAndroidApp, isDesktopApp } from './lib/capabilities.ts';
import { errorMessage } from './lib/errors.ts';
import { logInfo, logWarn } from './log.ts';
import {
  LAN_PAIRING_TTL_MS,
  LAN_SYNC_PROTOCOL_VERSION,
  MAX_REQUEST_BYTES,
  formatScope,
  peerBaseUrl,
  type LanScope,
  type PeerAddress,
} from './lan-sync-protocol.ts';
import { applyLanEnvelope, buildLanEnvelope, parseLanEnvelope } from './lan-sync-payload.ts';
import { lanFetch, lanResponseError, lanUtf8Length } from './lan-sync-http.ts';

/**
 * 局域网同步（I-14）的**客户端**：配对、刷新/吊销令牌、拉取/推送与客户端状态机。
 *
 * 边界：
 * - 只做 `fetch` 与状态，不碰原生桥；服务端生命周期在 `lan-sync.ts`；
 * - 配对得到的是 **180 天长期令牌**（`LAN_PAIRING_TTL_MS`），持久化与自动重连在
 *   `lan-pairings.ts`；令牌由服务端只存哈希，客户端保存明文用于重连；
 * - 拉取/推送复用 `lan-sync-payload.ts` 的信封与冲突规则；
 * - 协议见 `apps/mobile/docs/lan-sync.contract.md`。
 */

/** 本机平台的可读名：写进服务端可信令牌列表，也用于配对二维码的展示名。 */
export function defaultDeviceName(): string {
  if (isAndroidApp()) return 'Android 手机';
  if (isDesktopApp()) return 'Windows 电脑';
  return '浏览器';
}

/** 已配对的对方：地址 + 长期令牌。 */
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

/** 客户端配对：`POST /pair` 换长期令牌；`name` 是写给服务端「已配对设备」的设备名。 */
export async function pairWithPeer(
  peer: PeerAddress,
  code: string,
  now = Date.now(),
  name?: string,
): Promise<PairPeerResult> {
  if (!/^\d{6}$/.test(code.trim())) {
    return { ok: false, session: null, error: '配对码应为 6 位数字' };
  }
  try {
    const response = await lanFetch(`${peerBaseUrl(peer)}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.trim(),
        name: name?.trim() || defaultDeviceName(),
        schemaVersion: LAN_SYNC_PROTOCOL_VERSION,
      }),
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, session: null, error: lanResponseError(response.status, text, '配对') };
    const body = JSON.parse(text) as { token?: unknown; expiresAt?: unknown };
    if (typeof body.token !== 'string' || body.token === '') {
      return { ok: false, session: null, error: '配对响应缺少配对令牌' };
    }
    const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : now + LAN_PAIRING_TTL_MS;
    logInfo('lan-sync', '已与对方配对', { peer: `${peer.host}:${peer.port}` });
    return { ok: true, session: { peer, token: body.token, expiresAt }, error: null };
  } catch (cause: unknown) {
    const error = errorMessage(cause);
    logWarn('lan-sync', '配对失败', { peer: `${peer.host}:${peer.port}`, error });
    return { ok: false, session: null, error };
  }
}

/** 刷新结果：`status` 用来区分「网络离线」（0/5xx）与「令牌已失效」（401）。 */
export interface RefreshPairResult {
  ok: boolean;
  status: number;
  token: string | null;
  expiresAt: number | null;
  error: string | null;
}

/** 自动重连的探测：`POST /pair/refresh` 换新令牌并顺延 180 天。 */
export async function refreshPairing(session: LanSession, now = Date.now()): Promise<RefreshPairResult> {
  try {
    const response = await lanFetch(`${peerBaseUrl(session.peer)}/pair/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ schemaVersion: LAN_SYNC_PROTOCOL_VERSION }),
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        token: null,
        expiresAt: null,
        error: lanResponseError(response.status, text, '刷新配对'),
      };
    }
    const body = JSON.parse(text) as { token?: unknown; expiresAt?: unknown };
    if (typeof body.token !== 'string' || body.token === '') {
      return { ok: false, status: response.status, token: null, expiresAt: null, error: '刷新响应缺少配对令牌' };
    }
    const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : now + LAN_PAIRING_TTL_MS;
    return { ok: true, status: response.status, token: body.token, expiresAt, error: null };
  } catch (cause: unknown) {
    return { ok: false, status: 0, token: null, expiresAt: null, error: errorMessage(cause) };
  }
}

/** 移除配对时通知服务端吊销令牌；失败也继续本地删除，由调用方提示。 */
export async function revokePairing(session: LanSession): Promise<{ ok: boolean; error: string | null }> {
  try {
    const response = await lanFetch(`${peerBaseUrl(session.peer)}/pair/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ schemaVersion: LAN_SYNC_PROTOCOL_VERSION }),
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, error: lanResponseError(response.status, text, '移除配对') };
    return { ok: true, error: null };
  } catch (cause: unknown) {
    return { ok: false, error: errorMessage(cause) };
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
    if (!response.ok) return transferFailure(lanResponseError(response.status, text, '拉取'));
    const envelope = parseLanEnvelope(text);
    const result = await applyLanEnvelope(storage, envelope, { scopes, mode: 'merge', now });
    logInfo('lan-sync', '已从对方拉取', { imported: result.imported, skipped: result.skipped });
    return {
      ok: true,
      imported: result.imported,
      skipped: result.skipped,
      warnings: result.warnings,
      error: null,
      bytes: lanUtf8Length(text),
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
    const bytes = lanUtf8Length(body);
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
    if (!response.ok) return transferFailure(lanResponseError(response.status, text, '推送'));
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
  | { type: 'expire'; now: number }
  | { type: 'refresh'; token: string; expiresAt: number };

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
    case 'refresh':
      if (state.session === null) return state;
      return {
        ...state,
        session: { ...state.session, token: event.token, expiresAt: event.expiresAt },
        error: null,
      };
    case 'expire':
      if (state.session === null || event.now < state.session.expiresAt) return state;
      return { phase: 'idle', session: null, error: '配对已过期，请重新配对' };
  }
}
