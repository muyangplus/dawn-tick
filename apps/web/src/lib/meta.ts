import type { Storage } from '@dawn-tick/core';
import { describeError, logWarn } from '../log.ts';

/**
 * `app_meta` 里 JSON 值的统一读写：解析、校验、失败兜底与日志只写一次，
 * 调用方只提供「结构对不对」的判断与兜底值。
 * 键名清单见 `lib/meta-keys.ts`；这里只管字符串 ↔ 对象，不管某个键的含义。
 */

type MetaReader = Pick<Storage, 'readMeta'>;
type MetaWriter = Pick<Storage, 'writeMeta'>;

export interface MetaJsonReadOptions<T> {
  /** 校验并收窄结构；返回 `null` 表示结构不合法，此时回落到 `fallback` 并记一条 warn。 */
  parse: (value: unknown) => T | null;
  /** 键缺失、JSON 损坏或结构不合法时的返回值。 */
  fallback: T;
  /** 失败日志的 scope；传 `null` 关闭日志（默认 `'meta'`）。 */
  scope?: string | null;
}

function scopeOf(scope: string | null | undefined): string | null {
  return scope === undefined ? 'meta' : scope;
}

/**
 * 读取并校验一个 JSON 值。键不存在、内容为空、解析失败、校验不通过、存储读失败
 * 都返回 `fallback`，只有前两种情况不记日志。
 */
export async function readMetaJson<T>(
  storage: MetaReader,
  key: string,
  options: MetaJsonReadOptions<T>,
): Promise<T> {
  const scope = scopeOf(options.scope);
  const warn = (message: string, detail: Record<string, unknown> = {}): void => {
    if (scope !== null) logWarn(scope, message, { key, ...detail });
  };

  let raw: string | undefined;
  try {
    raw = await storage.readMeta(key);
  } catch (cause: unknown) {
    warn('读取 app_meta 失败', { message: describeError(cause) });
    return options.fallback;
  }
  if (raw === undefined || raw === null || raw.trim() === '') return options.fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause: unknown) {
    warn('app_meta 不是合法 JSON', { message: describeError(cause) });
    return options.fallback;
  }

  let value: T | null;
  try {
    value = options.parse(parsed);
  } catch (cause: unknown) {
    warn('app_meta 校验失败', { message: describeError(cause) });
    return options.fallback;
  }
  if (value === null) {
    warn('app_meta 结构不正确');
    return options.fallback;
  }
  return value;
}

export interface MetaJsonWriteOptions {
  /** 失败日志的 scope；传 `null` 关闭日志（默认 `'meta'`）。 */
  scope?: string | null;
}

/**
 * 序列化并写入一个 JSON 值，返回写进存储的文本（长度即快照体积口径）。
 * 序列化或写入失败会记一条 warn 后抛出：是否吞掉由调用方决定。
 */
export async function writeMetaJson(
  storage: MetaWriter,
  key: string,
  value: unknown,
  options: MetaJsonWriteOptions = {},
): Promise<string> {
  const scope = scopeOf(options.scope);
  const warn = (message: string, detail: Record<string, unknown> = {}): void => {
    if (scope !== null) logWarn(scope, message, { key, ...detail });
  };

  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (cause: unknown) {
    warn('app_meta 序列化失败', { message: describeError(cause) });
    throw cause;
  }
  if (text === undefined) {
    const error = new TypeError('app_meta 值无法序列化为 JSON');
    warn(error.message);
    throw error;
  }
  try {
    await storage.writeMeta(key, text);
  } catch (cause: unknown) {
    warn('写入 app_meta 失败', { message: describeError(cause) });
    throw cause;
  }
  return text;
}

/**
 * 读取一个十进制数字形式的 meta 值（不是 JSON）：缺失、空串或不是有限数时回落 `fallback`。
 * WebDAV 的「上次上传时间」这类老键仍是裸数字串，不为其改成 JSON 以免旧版本读不懂。
 */
export async function readMetaNumber(
  storage: MetaReader,
  key: string,
  fallback: number,
  options: { scope?: string | null } = {},
): Promise<number> {
  const scope = scopeOf(options.scope);
  let raw: string | undefined;
  try {
    raw = await storage.readMeta(key);
  } catch (cause: unknown) {
    if (scope !== null) logWarn(scope, '读取 app_meta 失败', { key, message: describeError(cause) });
    return fallback;
  }
  if (raw === undefined || raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    if (scope !== null) logWarn(scope, 'app_meta 不是数字', { key });
    return fallback;
  }
  return value;
}
