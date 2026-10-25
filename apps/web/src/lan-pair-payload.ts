import {
  LAN_SYNC_PORT,
  TRUSTED_TOKEN_NAME_MAX,
  isLanAddress,
  type PeerAddress,
} from './lan-sync-protocol.ts';

/**
 * 局域网配对的「标准化连接格式」：纯函数，不碰网络、二维码或界面。
 *
 * 标准形态（二维码与「复制配对信息」都用它）：
 *   dawn-tick://pair?schema=1&host=192.168.1.23&port=8765&code=123456&name=PC
 *
 * 解析保持宽容，接受：
 *   1. 上面的链接（`dawn-tick://pair?…`，也接受 `dawn-tick:pair?…` 与
 *      `http(s)://<host>:<port>/pair?…`）；
 *   2. 人类可读文本 `192.168.1.23:8765 123456`；
 *   3. `192.168.1.23:8765#123456`；
 *   4. 整段被 URL 编码过的文本（扫码/聊天工具二次编码后的结果）。
 *
 * 所有入口最终都走同一套校验：地址必须是局域网 IPv4（`parsePeerAddress`），
 * 端口 1–65535，配对码 6 位数字。失败返回可直接展示的错误原因。
 */

/** 标准链接的 scheme 与路径：`dawn-tick://pair`。 */
export const PAIR_LINK_SCHEME = 'dawn-tick';
export const PAIR_LINK_PATH = 'pair';
export const PAIR_LINK_PREFIX = `${PAIR_LINK_SCHEME}://${PAIR_LINK_PATH}`;
/** 链接内的格式版本：不认识就拒绝，不做猜测兼容。 */
export const PAIR_PAYLOAD_SCHEMA = 1;
/** 名称只用于展示，过长时截断，避免二维码溢出。 */
export const PAIR_PAYLOAD_NAME_MAX = TRUSTED_TOKEN_NAME_MAX;

/** 解析成功的载荷：`name` 是可选的展示名（扫码后写入已配对设备）。 */
export interface PairPayload extends PeerAddress {
  code: string;
  name?: string;
}

export type PairParseResult =
  | { ok: true; payload: PairPayload }
  | { ok: false; error: string };

/** 标准化链接；端口缺省 8765，名称空白或超长按规则归一。 */
export function formatPairPayload(input: {
  host: string;
  port?: number;
  code: string;
  name?: string;
}): string {
  const host = input.host.trim();
  const port = normalizePort(input.port ?? LAN_SYNC_PORT) ?? LAN_SYNC_PORT;
  const code = input.code.trim();
  const params = new URLSearchParams();
  params.set('schema', String(PAIR_PAYLOAD_SCHEMA));
  params.set('host', host);
  params.set('port', String(port));
  params.set('code', code);
  const name = normalizeName(input.name);
  if (name !== undefined) params.set('name', name);
  return `${PAIR_LINK_PREFIX}?${params.toString()}`;
}

/** 二维码下方的人类可读文本：`192.168.1.23:8765 123456`（同样能被解析）。 */
export function formatPairingText(payload: PairPayload): string {
  return `${payload.host}:${payload.port} ${payload.code}`;
}

/** 宽容解析；返回载荷或可展示的错误原因。 */
export function parsePairPayload(text: string): PairParseResult {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (raw === '') return failure('配对信息为空，请扫码或粘贴对方显示的链接');

  for (const candidate of candidatesOf(raw)) {
    const fromLink = parseLink(candidate);
    if (fromLink !== null) return fromLink;
  }
  for (const candidate of candidatesOf(raw)) {
    const fromText = parseBasicText(candidate);
    if (fromText !== null) return fromText;
  }
  return failure('无法识别配对信息：请粘贴 dawn-tick://pair?… 或「IP:端口 配对码」');
}

function failure(error: string): PairParseResult {
  return { ok: false, error };
}

/** 原文与整段 URL 解码结果都试一遍（二次编码的二维码很常见）。 */
function candidatesOf(raw: string): string[] {
  const candidates = [raw];
  if (/%(?:[0-9a-f]{2})/i.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded !== raw) candidates.push(decoded.trim());
    } catch {
      // 非法百分号编码：忽略解码结果，继续按原文解析
    }
  }
  return candidates;
}

function normalizePort(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
  }
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value.trim())) return null;
  const port = Number(value.trim());
  return port >= 1 && port <= 65535 ? port : null;
}

function normalizeName(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  if (text === '') return undefined;
  return [...text].slice(0, PAIR_PAYLOAD_NAME_MAX).join('');
}

/** 从查询参数归一载荷；缺字段时给出具体原因。 */
function fromParams(params: URLSearchParams): PairParseResult {
  const schema = params.get('schema');
  if (schema !== null && schema.trim() !== '' && schema.trim() !== String(PAIR_PAYLOAD_SCHEMA)) {
    return failure(`配对信息版本 ${schema.trim()} 不受支持，请升级应用`);
  }
  const host = (params.get('host') ?? '').trim();
  const code = (params.get('code') ?? '').trim();
  const portText = params.get('port');
  if (host === '') return failure('配对信息里没有对方地址（host）');
  if (code === '') return failure('配对信息里没有配对码（code）');
  const port = portText === null || portText.trim() === '' ? LAN_SYNC_PORT : normalizePort(portText);
  return validate(host, port, code, normalizeName(params.get('name')));
}

/** 链接形态：`dawn-tick://pair?…`、`dawn-tick:pair?…`、`http(s)://x/pair?…`。 */
function parseLink(text: string): PairParseResult | null {
  const trimmed = text.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(trimmed);
  if (scheme === null) return null;
  const lower = trimmed.toLowerCase();
  const looksOurLink = lower.startsWith(`${PAIR_LINK_SCHEME}:`);
  const looksHttpLink = /^https?:\/\//i.test(trimmed) && /\/pair(?:[/?#]|$)/i.test(trimmed);
  if (!looksOurLink && !looksHttpLink) return null;

  const queryIndex = trimmed.indexOf('?');
  const beforeQuery = queryIndex < 0 ? trimmed : trimmed.slice(0, queryIndex);
  if (looksOurLink) {
    // scheme 之后只接受 `pair`（带不带 //、结尾斜杠都行）
    const rest = beforeQuery.replace(new RegExp(`^${PAIR_LINK_SCHEME}:`, 'i'), '').replace(/^\/+/, '');
    if (rest.replace(/\/+$/, '').toLowerCase() !== PAIR_LINK_PATH) return null;
  }
  if (queryIndex < 0) return failure('配对链接缺少参数：请重新生成二维码');
  return fromParams(new URLSearchParams(trimmed.slice(queryIndex + 1)));
}

/** 人类可读文本：`IP[:端口][#或空白]配对码`。 */
function parseBasicText(text: string): PairParseResult | null {
  const stripped = text.trim().replace(/^https?:\/\//i, '');
  const match =
    /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?(?:\s*[#\s]\s*(\d{1,6}))?$/.exec(stripped);
  if (match === null) return null;
  const host = match[1] ?? '';
  const port = normalizePort(match[2] ?? String(LAN_SYNC_PORT));
  const code = (match[3] ?? '').trim();
  if (code === '') return failure('配对信息里没有配对码：应为「IP:端口 6 位配对码」');
  return validate(host, port, code, undefined);
}

function validate(
  host: string,
  port: number | null,
  code: string,
  name: string | undefined,
): PairParseResult {
  if (port === null) return failure('配对信息里的端口不正确：应为 1–65535');
  if (!/^\d{6}$/.test(code)) return failure('配对码应为 6 位数字');
  if (!isLanAddress(host)) return failure(`对方地址不是局域网 IPv4：${host}`);
  return {
    ok: true,
    payload: {
      host: host.toLowerCase() === 'localhost' ? '127.0.0.1' : host,
      port,
      code,
      ...(name === undefined ? {} : { name }),
    },
  };
}
