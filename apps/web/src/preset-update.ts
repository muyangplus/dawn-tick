/** 预设数据来自独立预设仓库；下载只写缓存、下次启动才套用，运行时不替换，失败回退内置。 */

import {
  BUILTIN_PRESET_VERSION as CORE_BUILTIN_PRESET_VERSION,
  canonicalPresetJson,
  effectivePresetVersion,
  setPresetOverride,
  sha256HexSync,
  validateSystems,
  validateTimetables,
  type Storage,
  type SystemConfig,
  type TimetablePreset,
} from '@dawn-tick/core';
import { compareVersions } from './update.ts';
import {
  presetContentsUrl,
  presetSnapshotUrl,
  presetVersionUrl,
  type DownloadSource,
} from './lib/download-source.ts';
import { PRESET_CONTENT_META_KEY, PRESET_SNAPSHOT_META_KEY } from './lib/meta-keys.ts';
import { errorMessage } from './lib/errors.ts';
import { withTimeout } from './lib/timeout.ts';
import type { PresetIndex } from './preset-index.ts';
import { presetUpdateCopy } from './copy/update-preset.ts';

/** 哈希口径与预设仓库 scripts/snapshot.mjs 一致，实现只有一份：core 的 packages/core/src/config/preset-hash.ts。 */
/** 这里只是转出，不重复实现。 */
export { canonicalPresetJson, sha256HexSync } from '@dawn-tick/core';

/** 预设仓库的版本清单地址（常量；运行时仅由「检查预设更新」发起请求）。 */
export const PRESET_VERSION_URL =
  'https://raw.githubusercontent.com/muyangplus/dawn-tick-presets/main/version.json';

/** 指定版本的快照地址。 */
export const PRESET_SNAPSHOT_URL = (version: string): string =>
  `https://raw.githubusercontent.com/muyangplus/dawn-tick-presets/main/snapshot/presets-${version}.json`;

/** 预设仓库的 contents 接口（回退取源）：raw 直连失败时改走这里，正文在 content 字段以 base64 返回。 */
/** 只访问 raw.githubusercontent.com 与 api.github.com，不带 token。 */
export const PRESET_VERSION_API_URL =
  'https://api.github.com/repos/muyangplus/dawn-tick-presets/contents/version.json';

/** 指定版本的快照在上述 contents 接口下的地址。 */
export const PRESET_SNAPSHOT_API_URL = (version: string): string =>
  `https://api.github.com/repos/muyangplus/dawn-tick-presets/contents/snapshot/presets-${version}.json`;

/** 预设数据的实际来源：`raw` 为 raw.githubusercontent.com / gitee.com 直连，`api` 为 contents 接口回退。 */
export type PresetRemoteSource = 'raw' | 'api';

/** GitHub 接口的 accept（raw 直连沿用 application/json）。 */
const GITHUB_API_ACCEPT = 'application/vnd.github+json';

/** 两个下载源互为回退。 */
const OTHER_SOURCE: Record<DownloadSource, DownloadSource> = { github: 'gitee', gitee: 'github' };

/** 内置预设的版本号：来自 core 的 `preset-version.json`（当前 = 预设仓库 0.1.0）。 */
export const BUILTIN_PRESET_VERSION: string = CORE_BUILTIN_PRESET_VERSION;

/** 本版应用能消费的快照数据格式版本；高于它的快照一律拒收。 */
export const PRESET_SCHEMA_VERSION = 1;

/** 快照在 `app_meta` 里的缓存键（清单见 `lib/meta-keys.ts`）；保留旧导出给整包与冒烟用。 */
export { PRESET_SNAPSHOT_META_KEY };

export interface PresetSnapshot {
  version: string;
  schemaVersion: number;
  generatedAt?: string;
  /** 预设文件清单（id / path / sha256）；adapters（{ 文件名: sha256 }）也在快照里并参与哈希，本模块只保存不执行。 */
  sources: { timetables: unknown[]; systems: unknown[]; adapters?: Record<string, string> };
  /** 索引（原 presets/index.json 的学校索引 + 系统引用），与清单同源同版本。 */
  /** 旧快照没有该字段，取索引会报可读错误。 */
  index?: PresetIndex;
  /** `sha256:<hex>`，对去掉本字段后的规范化 JSON 计算（含 `index`） */
  hash: string;
}

/** 检查更新的结果。`version` 为远端最新版本号；失败时为 null。 */
export interface PresetUpdateStatus {
  available: boolean;
  version: string | null;
  error: string | null;
  /** 实际取到数据的来源（raw / api）；失败时为 undefined（原有字段的含义与类型不变） */
  source?: PresetRemoteSource;
  /** 实际使用的下载源：Gitee 或 GitHub */
  downloadSource?: DownloadSource;
}

/** 预设取源选项：缺省走 GitHub + 同源 raw→API，保持既有调用点的行为。 */
export interface PresetFetchOptions {
  /** 首选下载源 */
  source?: DownloadSource;
  /** 首选源整条链路失败后是否回退另一个源（应用内自动模式传 true） */
  fallback?: boolean;
}

/** 当前应当使用的预设来源。 */
export interface PresetSource {
  version: string;
  kind: 'builtin' | 'cached';
  snapshot: PresetSnapshot | null;
}

// —— SHA-256 ——

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** 对字符串做 sha256，返回小写 hex；有 crypto.subtle 时优先走它，没有时退回同口径的 sha256HexSync。 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined && typeof subtle.digest === 'function') {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return bytesToHex(new Uint8Array(digest));
  }
  return sha256HexSync(text);
}

/** 去掉 `sha256:` 前缀并小写，便于比较。 */
function hashHex(value: string): string {
  return value.trim().toLowerCase().replace(/^sha256:/, '');
}

/** 语义化版本比较：a > b 返回正数。复用主仓库 update.ts 的实现。 */
export function comparePresetVersions(a: string, b: string): number {
  return compareVersions(a, b);
}

/** 校验快照内容哈希：去掉 hash 字段后规范化序列化取 sha256 与 snapshot.hash 比对；未通过即视为不可用。 */
export function verifySnapshot(snapshot: PresetSnapshot): boolean {
  const record = snapshot as unknown as Record<string, unknown>;
  const hash = record['hash'];
  if (typeof hash !== 'string') return false;
  const expected = hashHex(hash);
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  const { hash: _ignored, ...unsigned } = record;
  return sha256HexSync(canonicalPresetJson(unsigned)) === expected;
}

/** 结构校验；返回可读的问题描述，合法时返回 null。 */
export function describeSnapshotProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return presetUpdateCopy.snapshotNotObject;
  const record = value as Record<string, unknown>;
  if (typeof record['version'] !== 'string' || record['version'].trim() === '') {
    return presetUpdateCopy.snapshotMissingVersion;
  }
  const schemaVersion = record['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    return presetUpdateCopy.snapshotSchemaNotInteger;
  }
  if (schemaVersion > PRESET_SCHEMA_VERSION) {
    return presetUpdateCopy.snapshotSchemaTooNew(schemaVersion);
  }
  const generatedAt = record['generatedAt'];
  if (generatedAt !== undefined && typeof generatedAt !== 'string') {
    return presetUpdateCopy.snapshotGeneratedAtNotString;
  }
  const sources = record['sources'];
  if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) {
    return presetUpdateCopy.snapshotMissingSources;
  }
  const sourceRecord = sources as Record<string, unknown>;
  if (!Array.isArray(sourceRecord['timetables'])) return presetUpdateCopy.snapshotTimetablesNotArray;
  if (!Array.isArray(sourceRecord['systems'])) return presetUpdateCopy.snapshotSystemsNotArray;
  if (typeof record['hash'] !== 'string' || record['hash'].trim() === '') {
    return presetUpdateCopy.snapshotMissingHash;
  }
  return null;
}

/** 网络类错误转成用户能看懂的一句话。 */
function describeFetchError(cause: unknown): string {
  const message = errorMessage(cause);
  if (/fetch failed|failed to fetch|network|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|offline|load failed/i.test(message)) {
    return presetUpdateCopy.sourceUnreachable(message);
  }
  return message;
}

function requireJsonVersion(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const version = (value as Record<string, unknown>)['version'];
  if (typeof version !== 'string' || version.trim() === '') return null;
  return version.trim();
}

// —— 取源：[raw 直连, api contents] 依次尝试 ——
// raw 直接给 JSON 文本，contents 给 base64；任一来源成功即返回，全失败时抛最后一次失败原因。

interface PresetFetchSource {
  kind: PresetRemoteSource;
  url: string;
  /** 这条地址属于哪个下载源：界面与结果要标明 Gitee / GitHub */
  downloadSource: DownloadSource;
}

interface PresetFetchResult {
  value: unknown;
  source: PresetRemoteSource;
  downloadSource: DownloadSource;
}

/** 一个下载源内部的取源顺序：raw 直连 → contents API（base64）。 */
function sourcesOf(kind: 'version' | 'snapshot', source: DownloadSource, version: string): PresetFetchSource[] {
  if (kind === 'version') {
    return [
      { kind: 'raw', url: presetVersionUrl(source), downloadSource: source },
      { kind: 'api', url: presetContentsUrl(source, 'version.json'), downloadSource: source },
    ];
  }
  const path = `snapshot/presets-${version}.json`;
  return [
    { kind: 'raw', url: presetSnapshotUrl(source, version), downloadSource: source },
    { kind: 'api', url: presetContentsUrl(source, path), downloadSource: source },
  ];
}

/** 取源计划：首选源整条链路 → （允许时）另一个源整条链路。 */
export function presetSourcesFor(
  kind: 'version' | 'snapshot',
  options: PresetFetchOptions = {},
  version = '',
): PresetFetchSource[] {
  const primary = options.source ?? 'github';
  const sources = sourcesOf(kind, primary, version);
  if (options.fallback !== true) return sources;
  return [...sources, ...sourcesOf(kind, OTHER_SOURCE[primary], version)];
}

/** base64 → UTF-8 文本。优先 `atob`（浏览器与 Node 24 都有），没有时退回 Node 的 Buffer。 */
function base64ToText(base64: string): string {
  const compact = base64.replace(/\s+/g, '');
  const decode = (globalThis as { atob?: (input: string) => string }).atob;
  try {
    if (typeof decode === 'function') {
      const binary = decode(compact);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new TextDecoder().decode(bytes);
    }
    const buffer = (
      globalThis as { Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } } }
    ).Buffer;
    if (buffer === undefined) throw new Error(presetUpdateCopy.base64Unsupported);
    return buffer.from(compact, 'base64').toString('utf8');
  } catch (cause: unknown) {
    throw new Error(presetUpdateCopy.base64Invalid(errorMessage(cause)));
  }
}

/** contents 接口的响应体 → 内层 JSON。编码不是 base64 或缺 `content` 都算这条来源失败。 */
function parseContentsPayload(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(presetUpdateCopy.contentsNotObject);
  }
  const record = payload as Record<string, unknown>;
  if (record['encoding'] !== 'base64') {
    throw new Error(presetUpdateCopy.contentsEncoding(String(record['encoding'])));
  }
  const content = record['content'];
  if (typeof content !== 'string') throw new Error(presetUpdateCopy.contentsMissing);
  return JSON.parse(base64ToText(content)) as unknown;
}

/** 依次尝试各来源：HTTP 失败、网络异常、base64/JSON 解析失败都算这条来源失败，继续下一条。 */
async function readPresetJson(
  sources: readonly PresetFetchSource[],
  doFetch: typeof fetch,
): Promise<PresetFetchResult> {
  let lastError: string | null = null;
  for (const source of sources) {
    try {
      const response = await withTimeout(
        doFetch(source.url, {
          headers: { accept: source.kind === 'api' ? GITHUB_API_ACCEPT : 'application/json' },
        }),
        15_000,
        presetUpdateCopy.manifestTimeout,
      );
      if (!response.ok) throw new Error(presetUpdateCopy.httpStatus(response.status));
      const payload: unknown = await withTimeout(
        response.json() as Promise<unknown>,
        15_000,
        presetUpdateCopy.manifestTimeout,
      );
      const value = source.kind === 'api' ? parseContentsPayload(payload) : payload;
      return { value, source: source.kind, downloadSource: source.downloadSource };
    } catch (cause: unknown) {
      lastError = describeFetchError(cause);
    }
  }
  throw new Error(lastError ?? presetUpdateCopy.sourceUnreachableBare);
}

/** 检查有没有更新的预设版本：按下载源 raw → api，允许时再回退另一个源；失败收敛为可读 error、不向界面抛出。 */
export async function checkPresetUpdate(options: {
  cachedVersion: string;
  fetchImpl?: typeof fetch;
  /** 首选下载源；缺省 GitHub（旧调用点行为不变） */
  source?: DownloadSource;
  /** 首选源整条链路失败后是否回退另一个源（自动模式传 true） */
  fallback?: boolean;
}): Promise<PresetUpdateStatus> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return { available: false, version: null, error: presetUpdateCopy.checkOffline };
  }
  const fetchOptions: PresetFetchOptions = {
    ...(options.source === undefined ? {} : { source: options.source }),
    ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
  };
  let result: PresetFetchResult;
  try {
    result = await readPresetJson(presetSourcesFor('version', fetchOptions), doFetch);
  } catch (cause: unknown) {
    // 文案已是可读句子（最后一条来源的原因，网络类已包成「无法连接预设源（…）」），不再二次包装
    return { available: false, version: null, error: errorMessage(cause) };
  }

  const parsed = result.value;
  const latest = requireJsonVersion(parsed);
  if (latest === null) return { available: false, version: null, error: presetUpdateCopy.versionManifestInvalid };
  const schemaVersion = (parsed as Record<string, unknown>)['schemaVersion'];
  if (typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) && schemaVersion > PRESET_SCHEMA_VERSION) {
    return {
      available: false,
      version: latest,
      error: presetUpdateCopy.sourceSchemaTooNew(schemaVersion),
    };
  }
  return {
    available: comparePresetVersions(latest, options.cachedVersion) > 0,
    version: latest,
    error: null,
    source: result.source,
    downloadSource: result.downloadSource,
  };
}

/** 下载并校验指定版本的快照：结构、HTTP 或哈希问题都抛可读错误，调用方回退内置。 */
export async function fetchSnapshot(
  version: string,
  fetchImpl?: typeof fetch,
  options: PresetFetchOptions = {},
): Promise<PresetSnapshot> {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version.trim())) {
    throw new Error(presetUpdateCopy.invalidVersion(version));
  }
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error(presetUpdateCopy.snapshotOffline);

  const trimmed = version.trim();
  let parsed: unknown;
  try {
    const result = await readPresetJson(presetSourcesFor('snapshot', options, trimmed), doFetch);
    parsed = result.value;
  } catch (cause: unknown) {
    throw new Error(presetUpdateCopy.snapshotDownloadFailed(errorMessage(cause)));
  }

  const problem = describeSnapshotProblem(parsed);
  if (problem !== null) throw new Error(presetUpdateCopy.snapshotUnusable(problem));
  const snapshot = parsed as PresetSnapshot;
  if (!verifySnapshot(snapshot)) {
    throw new Error(presetUpdateCopy.snapshotHashMismatch);
  }
  return snapshot;
}

export * from './preset-index.ts';
export * from './preset-cache.ts';
