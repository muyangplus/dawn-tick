import {
  BACKUP_FORMAT,
  exportBackup,
  importBackup,
  parseBackup,
  type BackupPayload,
  type ImportMode,
  type ImportResult,
  type Storage,
} from '@dawn-tick/core';
import {
  LAN_SCOPES,
  LAN_SYNC_KIND,
  LAN_SYNC_PROTOCOL_VERSION,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  findTrustedToken,
  issueTrustedToken,
  parseScope,
  pruneTrustedTokens,
  revokeTrustedToken,
  rotateTrustedToken,
  scopeModules,
  touchTrustedToken,
  verifyPairCode,
  type LanScope,
  type Pairing,
  type TokenCheck,
  type TrustedToken,
} from './lan-sync-protocol.ts';

/**
 * 局域网同步（I-14）的载荷层：同步信封的编解码、导入应用与「服务端请求处理」。
 *
 * 边界：
 * - 信封复用 `exportBackup` / `importBackup`（与 WebDAV 整包同一套格式与冲突规则）；
 * - 这里是服务端鉴权的唯一实现：原生层只转发，请求处理是纯函数 + Storage，可直接单测；
 * - 可信令牌只保存 SHA-256 哈希；明文令牌仅在 `POST /pair` / `POST /pair/refresh`
 *   的响应里出现一次，由客户端自行持久化；
 * - 与两端对照见 `apps/mobile/docs/lan-sync.contract.md`。
 */

/** 同步信封：`backup` 就是通用备份载荷，schema 版本单独一层。 */
export interface LanEnvelope {
  kind: typeof LAN_SYNC_KIND;
  schemaVersion: number;
  generatedAt: number;
  scope: LanScope[];
  backup: BackupPayload;
}

export async function buildLanEnvelope(
  storage: Storage,
  scopes: readonly LanScope[],
  now = Date.now(),
): Promise<LanEnvelope> {
  const backup = await exportBackup(storage, { modules: scopeModules(scopes), now });
  return {
    kind: LAN_SYNC_KIND,
    schemaVersion: LAN_SYNC_PROTOCOL_VERSION,
    generatedAt: now,
    scope: LAN_SCOPES.filter((scope) => scopes.includes(scope)),
    backup,
  };
}

/** 解析信封：标识、版本、备份格式逐项校验；不合法抛错，由调用方转 400。 */
export function parseLanEnvelope(text: string): LanEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('同步数据不是合法 JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('同步数据结构不正确');
  const envelope = parsed as Partial<LanEnvelope> & { backup?: unknown; scope?: unknown };
  if (envelope.kind !== LAN_SYNC_KIND) throw new Error('不是晓刻局域网同步数据');
  if (envelope.schemaVersion !== LAN_SYNC_PROTOCOL_VERSION) {
    throw new Error(`同步数据版本 ${String(envelope.schemaVersion)} 不受支持`);
  }
  if (typeof envelope.backup !== 'object' || envelope.backup === null) {
    throw new Error('同步数据缺少备份内容');
  }
  const backup = parseBackup(JSON.stringify(envelope.backup));
  if (backup.format !== BACKUP_FORMAT) throw new Error('同步数据不是晓刻备份格式');
  const scope = parseScope(
    Array.isArray(envelope.scope) ? envelope.scope.filter((item) => typeof item === 'string').join(',') : '',
  );
  return {
    kind: LAN_SYNC_KIND,
    schemaVersion: LAN_SYNC_PROTOCOL_VERSION,
    generatedAt: typeof envelope.generatedAt === 'number' ? envelope.generatedAt : 0,
    scope,
    backup,
  };
}

export interface ApplyLanOptions {
  /** 本次请求声明的范围；给了就与信封范围取交集 */
  scopes?: readonly LanScope[];
  mode?: ImportMode;
  now?: number;
}

/** 应用信封：与备份导入共用 `importBackup`，冲突规则不在本模块新增。 */
export async function applyLanEnvelope(
  storage: Storage,
  envelope: LanEnvelope,
  options: ApplyLanOptions = {},
): Promise<ImportResult> {
  const requested = options.scopes ?? envelope.scope;
  const scope = requested.filter((item) => envelope.scope.includes(item));
  const modules = scopeModules(scope);
  return importBackup(storage, envelope.backup, {
    mode: options.mode ?? 'merge',
    modules,
    now: options.now ?? Date.now(),
  });
}

/** 原生层转来的一个请求（字段与 Rust/Kotlin 一致）。 */
export interface LanHttpRequest {
  method: string;
  path: string;
  query: string;
  authorization: string | null;
  body: string;
}

export interface LanHttpReply {
  status: number;
  body: string;
  /** `/pair` 成功即消耗配对码：调用方要把配对码置空 */
  consumePairing?: boolean;
  /** 本次请求改变了可信令牌列表：调用方要把整份快照写入 `app_meta` */
  tokens?: TrustedToken[];
}

export interface LanServerContext {
  storage: Storage;
  /** 当前配对码；已用掉或未开启时为 null */
  pairing: Pairing | null;
  /** 已授权的长期令牌（只含哈希）；没有配对时为空数组 */
  tokens: readonly TrustedToken[];
  now?: number;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function errorReply(
  status: number,
  code: string,
  message: string,
  tokens?: TrustedToken[],
): LanHttpReply {
  const reply: LanHttpReply = { status, body: JSON.stringify({ error: { code, message } }) };
  return tokens === undefined ? reply : { ...reply, tokens };
}

function jsonReply(
  status: number,
  payload: unknown,
  options: { tokens?: TrustedToken[] } = {},
): LanHttpReply {
  const reply: LanHttpReply = { status, body: JSON.stringify(payload) };
  return options.tokens === undefined ? reply : { ...reply, tokens: options.tokens };
}

/**
 * 处理一个转发请求。纯函数 + Storage，原生层轮询到请求后调用它，再用结果回应。
 *
 * 校验顺序固定：体积 → 路径/方法 → 鉴权 → 业务；错误体统一。
 * 令牌相关的响应会带 `tokens` 快照，调用方负责写入 `app_meta`。
 */
export async function handleLanRequest(
  context: LanServerContext,
  request: LanHttpRequest,
): Promise<LanHttpReply> {
  const now = context.now ?? Date.now();
  const method = request.method.toUpperCase();

  if (utf8Bytes(request.body) > MAX_REQUEST_BYTES) {
    return errorReply(413, 'payload_too_large', '请求体超过 5MB 上限');
  }
  if (method === 'OPTIONS') return { status: 204, body: '' };
  if (request.path === '/pair') {
    if (method !== 'POST') return errorReply(405, 'method_not_allowed', '配对只接受 POST');
    return handlePair(context, request, now);
  }
  if (request.path === '/pair/refresh') {
    if (method !== 'POST') return errorReply(405, 'method_not_allowed', '刷新令牌只接受 POST');
    return handleRefresh(context, request, now);
  }
  if (request.path === '/pair/revoke') {
    if (method !== 'POST') return errorReply(405, 'method_not_allowed', '吊销令牌只接受 POST');
    return handleRevoke(context, request, now);
  }
  if (request.path === '/export' || request.path === '/import') {
    const auth = findTrustedToken(context.tokens, request.authorization, now);
    if (!auth.ok || auth.record === null) {
      return errorReply(401, 'unauthorized', auth.error ?? '未配对或配对令牌已失效，请重新配对');
    }
    if (request.path === '/export') {
      if (method !== 'GET') {
        return errorReply(405, 'method_not_allowed', '导出只接受 GET', touched(context, auth, now));
      }
      const reply = await handleExport(context, request, now);
      return withTokens(reply, touched(context, auth, now));
    }
    if (method !== 'POST') {
      return errorReply(405, 'method_not_allowed', '导入只接受 POST', touched(context, auth, now));
    }
    const reply = await handleImport(context, request, now);
    return withTokens(reply, touched(context, auth, now));
  }
  return errorReply(404, 'not_found', '没有该接口');
}

/** 鉴权成功后的令牌快照：`lastUsedAt` 记为本次请求时间。 */
function touched(context: LanServerContext, auth: TokenCheck, now: number): TrustedToken[] {
  return auth.record === null ? [...context.tokens] : touchTrustedToken(context.tokens, auth.record.tokenHash, now);
}

/** 响应成功才带上新令牌快照；错误回复保持原样。 */
function withTokens(reply: LanHttpReply, tokens: TrustedToken[]): LanHttpReply {
  return reply.status >= 400 ? reply : { ...reply, tokens };
}

async function handlePair(
  context: LanServerContext,
  request: LanHttpRequest,
  now: number,
): Promise<LanHttpReply> {
  let body: { code?: unknown; name?: unknown };
  try {
    body = JSON.parse(request.body) as { code?: unknown; name?: unknown };
  } catch {
    return errorReply(400, 'bad_request', '配对请求不是合法 JSON');
  }
  const code = typeof body.code === 'string' ? body.code : '';
  const check = verifyPairCode(context.pairing, code, now);
  if (!check.ok) return errorReply(401, 'unauthorized', check.error ?? '配对码不正确');
  // 长期令牌：每次成功配对都新增一条可信设备，不再限制「同时只有一台」
  const issued = issueTrustedToken(typeof body.name === 'string' ? body.name : '未知设备', now);
  const tokens = [...pruneTrustedTokens(context.tokens, now), issued.record];
  return {
    status: 200,
    body: JSON.stringify({
      token: issued.token,
      expiresAt: issued.record.expiresAt,
      schemaVersion: LAN_SYNC_PROTOCOL_VERSION,
    }),
    consumePairing: true,
    tokens,
  };
}

/** 用现有令牌换新令牌：旧哈希立即作废，有效期从本次刷新起重新计算。 */
function handleRefresh(
  context: LanServerContext,
  request: LanHttpRequest,
  now: number,
): LanHttpReply {
  const auth = findTrustedToken(context.tokens, request.authorization, now);
  if (!auth.ok || auth.record === null) {
    return errorReply(401, 'unauthorized', auth.error ?? '配对已失效，请重新配对');
  }
  const rotated = rotateTrustedToken(context.tokens, auth.record, now);
  return {
    status: 200,
    body: JSON.stringify({
      token: rotated.token,
      expiresAt: rotated.record.expiresAt,
      schemaVersion: LAN_SYNC_PROTOCOL_VERSION,
    }),
    tokens: rotated.tokens,
  };
}

/** 吊销令牌：移除后该设备的后续请求一律 401；客户端失败时也删除本地记录。 */
function handleRevoke(
  context: LanServerContext,
  request: LanHttpRequest,
  now: number,
): LanHttpReply {
  const auth = findTrustedToken(context.tokens, request.authorization, now);
  if (!auth.ok || auth.record === null) {
    return errorReply(401, 'unauthorized', auth.error ?? '配对已失效，请重新配对');
  }
  return jsonReply(200, { revoked: true, schemaVersion: LAN_SYNC_PROTOCOL_VERSION }, {
    tokens: revokeTrustedToken(context.tokens, auth.record.tokenHash),
  });
}

async function handleExport(
  context: LanServerContext,
  request: LanHttpRequest,
  now: number,
): Promise<LanHttpReply> {
  const query = new URLSearchParams(request.query);
  const scope = parseScope(query.get('scope'));
  if (scope.length === 0) return errorReply(400, 'bad_request', '请至少选择一个同步范围');
  const envelope = await buildLanEnvelope(context.storage, scope, now);
  const body = JSON.stringify(envelope);
  if (utf8Bytes(body) > MAX_RESPONSE_BYTES) {
    return errorReply(500, 'payload_too_large', '同步数据超过 20MB 上限，请缩小范围');
  }
  return { status: 200, body };
}

async function handleImport(
  context: LanServerContext,
  request: LanHttpRequest,
  now: number,
): Promise<LanHttpReply> {
  const query = new URLSearchParams(request.query);
  const mode = query.get('mode') ?? 'merge';
  if (mode !== 'merge' && mode !== 'overwrite') {
    return errorReply(400, 'bad_request', '导入方式只支持 merge 或 overwrite');
  }
  let envelope: LanEnvelope;
  try {
    envelope = parseLanEnvelope(request.body);
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : '同步数据不正确';
    return errorReply(400, 'bad_request', message);
  }
  const requested = parseScope(query.get('scope'));
  const scope = (requested.length > 0 ? requested : envelope.scope).filter((item) =>
    envelope.scope.includes(item),
  );
  if (scope.length === 0) return errorReply(400, 'bad_request', '没有可导入的同步范围');
  try {
    const result = await applyLanEnvelope(context.storage, envelope, { scopes: scope, mode, now });
    return jsonReply(200, {
      imported: result.imported,
      skipped: result.skipped,
      removed: result.removed,
      warnings: result.warnings,
    });
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : '导入失败';
    return errorReply(500, 'internal', message);
  }
}
