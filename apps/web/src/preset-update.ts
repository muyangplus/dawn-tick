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
import { PRESET_CONTENT_META_KEY, PRESET_SNAPSHOT_META_KEY } from './lib/meta-keys.ts';
import { errorMessage } from './lib/errors.ts';

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

/** 预设数据的实际来源：`raw` 为 raw.githubusercontent.com 直连，`api` 为 api.github.com 回退。 */
export type PresetRemoteSource = 'raw' | 'api';

/** GitHub 接口的 accept（raw 直连沿用 application/json）。 */
const GITHUB_API_ACCEPT = 'application/vnd.github+json';

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
  /** 实际取到数据的来源；失败时为 undefined（原有字段的含义与类型不变） */
  source?: PresetRemoteSource;
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
function describeSnapshotProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '预设快照应为对象';
  const record = value as Record<string, unknown>;
  if (typeof record['version'] !== 'string' || record['version'].trim() === '') {
    return '预设快照缺少 version';
  }
  const schemaVersion = record['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    return '预设快照的 schemaVersion 应为整数';
  }
  if (schemaVersion > PRESET_SCHEMA_VERSION) {
    return `预设快照使用了更新的格式（schemaVersion ${schemaVersion}），请升级应用`;
  }
  const generatedAt = record['generatedAt'];
  if (generatedAt !== undefined && typeof generatedAt !== 'string') {
    return '预设快照的 generatedAt 应为字符串';
  }
  const sources = record['sources'];
  if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) {
    return '预设快照缺少 sources';
  }
  const sourceRecord = sources as Record<string, unknown>;
  if (!Array.isArray(sourceRecord['timetables'])) return '预设快照的 sources.timetables 应为数组';
  if (!Array.isArray(sourceRecord['systems'])) return '预设快照的 sources.systems 应为数组';
  if (typeof record['hash'] !== 'string' || record['hash'].trim() === '') {
    return '预设快照缺少 hash';
  }
  return null;
}

/** 网络类错误转成用户能看懂的一句话。 */
function describeFetchError(cause: unknown): string {
  const message = errorMessage(cause);
  if (/fetch failed|failed to fetch|network|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|offline|load failed/i.test(message)) {
    return `无法连接预设源（${message}）`;
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
}

interface PresetFetchResult {
  value: unknown;
  source: PresetRemoteSource;
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
    if (buffer === undefined) throw new Error('当前环境不支持 base64 解码');
    return buffer.from(compact, 'base64').toString('utf8');
  } catch (cause: unknown) {
    throw new Error(`预设源返回的 base64 内容无法解码：${errorMessage(cause)}`);
  }
}

/** contents 接口的响应体 → 内层 JSON。编码不是 base64 或缺 `content` 都算这条来源失败。 */
function parseContentsPayload(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('预设源返回的 contents 响应不是对象');
  }
  const record = payload as Record<string, unknown>;
  if (record['encoding'] !== 'base64') {
    throw new Error(`预设源返回的 contents 编码不受支持：${String(record['encoding'])}`);
  }
  const content = record['content'];
  if (typeof content !== 'string') throw new Error('预设源返回的 contents 缺少 content');
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
      const response = await doFetch(source.url, {
        headers: { accept: source.kind === 'api' ? GITHUB_API_ACCEPT : 'application/json' },
      });
      if (!response.ok) throw new Error(`预设源返回 ${response.status}`);
      const payload: unknown = await response.json();
      const value = source.kind === 'api' ? parseContentsPayload(payload) : payload;
      return { value, source: source.kind };
    } catch (cause: unknown) {
      lastError = describeFetchError(cause);
    }
  }
  throw new Error(lastError ?? '无法连接预设源');
}

/** 检查有没有更新的预设版本：取源 raw 直连 → api contents，都失败时收敛为可读 error、不向界面抛出。 */
export async function checkPresetUpdate(options: {
  cachedVersion: string;
  fetchImpl?: typeof fetch;
}): Promise<PresetUpdateStatus> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return { available: false, version: null, error: '当前环境无法联网检查预设更新' };
  }
  let result: PresetFetchResult;
  try {
    result = await readPresetJson(
      [
        { kind: 'raw', url: PRESET_VERSION_URL },
        { kind: 'api', url: PRESET_VERSION_API_URL },
      ],
      doFetch,
    );
  } catch (cause: unknown) {
    // 文案已是可读句子（最后一条来源的原因，网络类已包成「无法连接预设源（…）」），不再二次包装
    return { available: false, version: null, error: errorMessage(cause) };
  }

  const parsed = result.value;
  const latest = requireJsonVersion(parsed);
  if (latest === null) return { available: false, version: null, error: '预设版本清单格式不正确' };
  const schemaVersion = (parsed as Record<string, unknown>)['schemaVersion'];
  if (typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) && schemaVersion > PRESET_SCHEMA_VERSION) {
    return {
      available: false,
      version: latest,
      error: `预设源使用了更新的格式（schemaVersion ${schemaVersion}），请升级应用`,
    };
  }
  return {
    available: comparePresetVersions(latest, options.cachedVersion) > 0,
    version: latest,
    error: null,
    source: result.source,
  };
}

/** 下载并校验指定版本的快照：结构、HTTP 或哈希问题都抛可读错误，调用方回退内置。 */
export async function fetchSnapshot(version: string, fetchImpl?: typeof fetch): Promise<PresetSnapshot> {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version.trim())) {
    throw new Error(`预设版本号不合法：${version}`);
  }
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('当前环境无法联网下载预设快照');

  const trimmed = version.trim();
  let parsed: unknown;
  try {
    const result = await readPresetJson(
      [
        { kind: 'raw', url: PRESET_SNAPSHOT_URL(trimmed) },
        { kind: 'api', url: PRESET_SNAPSHOT_API_URL(trimmed) },
      ],
      doFetch,
    );
    parsed = result.value;
  } catch (cause: unknown) {
    throw new Error(`预设快照下载失败：${errorMessage(cause)}`);
  }

  const problem = describeSnapshotProblem(parsed);
  if (problem !== null) throw new Error(`预设快照不可用：${problem}`);
  const snapshot = parsed as PresetSnapshot;
  if (!verifySnapshot(snapshot)) {
    throw new Error('预设快照哈希校验未通过');
  }
  return snapshot;
}

// —— 预设索引（快照内嵌的 index 字段）——
// 索引随快照过哈希，无独立请求（旧 PRESET_INDEX_URL 会 404）。

/** 索引里的一条学校。 */
export interface PresetIndexSchool {
  id: string;
  name: string;
  /** 绑定的教务系统 id；通用作息为 null */
  system: string | null;
  /** 作息来源真实文件的相对路径：恒为 presets/schools/<校目录>/school.json（timetable.json 已不存在）。 */
  timetablePath: string;
  /** 学校覆盖配置的相对路径：有配置时同样指向 presets/schools/<校目录>/school.json，没有则为 null。 */
  configPath: string | null;
  /** 索引条目还会带 `region` / `aliases` / `generic` / `default` / `type` 等字段，本模块原样保留 */
  [key: string]: unknown;
}

/** 索引里的一条教务系统引用。 */
export interface PresetIndexSystem {
  id: string;
  /** 页面识别特征，四项都可能为空数组。 */
  /** 快照 sources.systems[].path 是 legacy 编译产物文本的哈希，读文件要按索引的 metaPath / loginPath / parserPath。 */
  detect: {
    markers: string[];
    timetableTableIds: string[];
    timetableTableClasses: string[];
    gridCellIdPatterns: string[];
  };
  /** 登录入口路径（相对站点根，以 `/` 开头） */
  entryPath: string;
  hint: string;
  /** 索引条目还会带 `aliases` / `version` / `hasParser` / `parserPath` / `metaPath` / `loginPath` 等字段 */
  [key: string]: unknown;
}

/** 快照内嵌索引的结构（原 `presets/index.json` 的顶层结构）；本模块只取需要的字段。 */
export interface PresetIndex {
  _generated: true;
  version: string;
  schemaVersion: number;
  schools: PresetIndexSchool[];
  systems: PresetIndexSystem[];
}

/** 索引里 `detect` 的四个固定子键（与 core 的 `SystemDetectConfig` 同形）。 */
const PRESET_INDEX_DETECT_KEYS = [
  'markers',
  'timetableTableIds',
  'timetableTableClasses',
  'gridCellIdPatterns',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 非空字符串（去首尾空白后）才算数；其余一律 null。 */
function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** 路径安全检查：非空、POSIX 分隔符、相对路径、不含 .. 段、不带盘符——索引里的路径会被拿去读文件。 */
function describePresetPathProblem(value: unknown, where: string): string | null {
  const text = nonEmptyText(value);
  if (text === null) return `${where} 应为非空字符串`;
  if (text.startsWith('/') || text.includes('\\')) return `${where} 应为 POSIX 风格的相对路径：${text}`;
  if (/^[A-Za-z]:/.test(text)) return `${where} 不应带盘符：${text}`;
  if (text.split('/').includes('..')) return `${where} 不应包含 .. 段：${text}`;
  return null;
}

/** 字符串数组校验；元素必须是非空字符串。 */
function describeTextArrayProblem(value: unknown, where: string): string | null {
  if (!Array.isArray(value)) return `${where} 应为字符串数组`;
  for (const [index, item] of value.entries()) {
    if (nonEmptyText(item) === null) return `${where}[${index}] 应为非空字符串`;
  }
  return null;
}

/** 存在的可选字段要类型正确；缺失（undefined）不追究——索引会随结构演进加字段。 */
function describeOptionalProblem(entry: Record<string, unknown>, key: string, where: string): string | null {
  if (entry[key] === undefined) return null;
  const value = entry[key];
  if (key === 'aliases') return describeTextArrayProblem(value, `${where} 的 aliases`);
  if (key === 'generic' || key === 'default' || key === 'hasParser') {
    return typeof value === 'boolean' ? null : `${where} 的 ${key} 应为布尔值`;
  }
  if (key === 'region' || key === 'type' || key === 'version') {
    return nonEmptyText(value) === null ? `${where} 的 ${key} 应为非空字符串` : null;
  }
  // metaPath / loginPath / parserPath：可选，但一旦出现就必须是安全的相对路径
  return describePresetPathProblem(value, `${where} 的 ${key}`);
}

/** 校验内嵌索引，返回问题描述、合法时 null，不抛异常。 */
/** _generated 必须恒为 true；无绑定系统或无覆盖配置时 system / configPath 要显式写 null。 */
export function describePresetIndexProblem(value: unknown): string | null {
  if (!isRecord(value)) return '预设索引应为对象';
  if (value['_generated'] !== true) {
    return '预设索引缺少 _generated: true（它不是生成物，已拒绝）';
  }
  if (nonEmptyText(value['version']) === null) return '预设索引缺少 version';
  const schemaVersion = value['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    return '预设索引的 schemaVersion 应为整数';
  }
  if (schemaVersion > PRESET_SCHEMA_VERSION) {
    return `预设索引使用了更新的格式（schemaVersion ${schemaVersion}），请升级应用`;
  }
  if (!Array.isArray(value['schools'])) return '预设索引的 schools 应为数组';
  if (!Array.isArray(value['systems'])) return '预设索引的 systems 应为数组';

  const schoolIds = new Set<string>();
  for (const [index, raw] of value['schools'].entries()) {
    const where = `预设索引的学校 #${index + 1}`;
    if (!isRecord(raw)) return `${where} 应为对象`;
    const id = nonEmptyText(raw['id']);
    if (id === null) return `${where} 缺少 id`;
    if (schoolIds.has(id)) return `${where} 的 id 重复：${id}`;
    schoolIds.add(id);

    if (nonEmptyText(raw['name']) === null) return `预设索引的学校「${id}」缺少 name`;
    if (!('system' in raw)) {
      return `预设索引的学校「${id}」缺少 system`;
    }
    if (raw['system'] !== null && nonEmptyText(raw['system']) === null) {
      return `预设索引的学校「${id}」的 system 应为非空字符串或 null`;
    }
    if (!('configPath' in raw)) {
      return `预设索引的学校「${id}」缺少 configPath`;
    }
    if (raw['configPath'] !== null) {
      const problem = describePresetPathProblem(raw['configPath'], `预设索引的学校「${id}」的 configPath`);
      if (problem !== null) return problem;
    }
    const timetableProblem = describePresetPathProblem(
      raw['timetablePath'],
      `预设索引的学校「${id}」的 timetablePath`,
    );
    if (timetableProblem !== null) return timetableProblem;
    for (const key of ['aliases', 'generic', 'default', 'region', 'type']) {
      const problem = describeOptionalProblem(raw, key, `预设索引的学校「${id}」`);
      if (problem !== null) return problem;
    }
  }

  const systemIds = new Set<string>();
  for (const [index, raw] of value['systems'].entries()) {
    const where = `预设索引的系统 #${index + 1}`;
    if (!isRecord(raw)) return `${where} 应为对象`;
    const id = nonEmptyText(raw['id']);
    if (id === null) return `${where} 缺少 id`;
    if (systemIds.has(id)) return `${where} 的 id 重复：${id}`;
    systemIds.add(id);

    if (nonEmptyText(raw['name']) === null) return `预设索引的系统「${id}」缺少 name`;
    const detect = raw['detect'];
    if (!isRecord(detect)) return `预设索引的系统「${id}」缺少 detect`;
    for (const key of PRESET_INDEX_DETECT_KEYS) {
      const problem = describeTextArrayProblem(detect[key], `预设索引的系统「${id}」的 detect.${key}`);
      if (problem !== null) return problem;
    }
    const entryPath = nonEmptyText(raw['entryPath']);
    if (entryPath === null) return `预设索引的系统「${id}」缺少 entryPath`;
    if (!entryPath.startsWith('/')) {
      return `预设索引的系统「${id}」的 entryPath 应以 / 开头：${entryPath}`;
    }
    if (nonEmptyText(raw['hint']) === null) return `预设索引的系统「${id}」缺少 hint`;
    for (const key of ['aliases', 'hasParser', 'version', 'metaPath', 'loginPath', 'parserPath']) {
      const problem = describeOptionalProblem(raw, key, `预设索引的系统「${id}」`);
      if (problem !== null) return problem;
    }
  }

  return null;
}

/** 解析并校验索引内容（快照内嵌的 `index`）；不合法时抛出可读错误。 */
export function parsePresetIndex(value: unknown): PresetIndex {
  const problem = describePresetIndexProblem(value);
  if (problem !== null) throw new Error(`预设索引不可用：${problem}`);
  return value as PresetIndex;
}

/** 从已下载的快照里取出索引，纯函数、不看网络。 */
/** index 随快照过哈希，无独立请求（旧 PRESET_INDEX_URL 会 404）；缺 index 抛可读错误。 */
export function presetIndexFromSnapshot(snapshot: PresetSnapshot): PresetIndex {
  const index = (snapshot as { index?: unknown }).index;
  if (index === undefined || index === null) {
    throw new Error(
      '预设快照不可用：缺少内嵌索引 index',
    );
  }
  return parsePresetIndex(index);
}

/** 读取缓存的快照（app_meta / presets_snapshot_v1）：缺失、JSON 损坏、结构不对或哈希不符一律返回 null、不抛错。 */
export async function readCachedSnapshot(storage: Storage): Promise<PresetSnapshot | null> {
  let raw: string | undefined;
  try {
    raw = await storage.readMeta(PRESET_SNAPSHOT_META_KEY);
  } catch {
    return null;
  }
  if (raw === undefined || raw.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (describeSnapshotProblem(parsed) !== null) return null;
  const snapshot = parsed as PresetSnapshot;
  return verifySnapshot(snapshot) ? snapshot : null;
}

/** 写入缓存。校验在下载与读回两侧做，这里只负责落盘。 */
export async function writeCachedSnapshot(storage: Storage, snapshot: PresetSnapshot): Promise<void> {
  await storage.writeMeta(PRESET_SNAPSHOT_META_KEY, JSON.stringify(snapshot));
}

/** 下载成功同一步：校验快照带的正文并落盘。 */
/** 正文不合法时不写、不清旧正文，只返回原因。 */
export async function cacheSnapshotContent(
  storage: Storage,
  snapshot: PresetSnapshot,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const timetables = validateTimetables(snapshot.sources?.timetables);
    const systems = validateSystems(snapshot.sources?.systems);
    await writeCachedPresetContent(storage, { version: snapshot.version, timetables, systems });
    return { ok: true };
  } catch (cause: unknown) {
    return { ok: false, reason: errorMessage(cause) };
  }
}

/** 当前应使用的预设来源：缓存比内置新且哈希可信时用缓存，否则内置。 */
export async function resolvePresetSource(storage: Storage): Promise<PresetSource> {
  const cached = await readCachedSnapshot(storage);
  if (cached === null) return { version: BUILTIN_PRESET_VERSION, kind: 'builtin', snapshot: null };
  if (comparePresetVersions(cached.version, BUILTIN_PRESET_VERSION) <= 0) {
    return { version: BUILTIN_PRESET_VERSION, kind: 'builtin', snapshot: null };
  }
  return { version: cached.version, kind: 'cached', snapshot: cached };
}

// —— 缓存正文：启动时套用的那一份数据 ——
// 快照只记清单，正文单独存 presets_content_v1：版本须与快照一致且高于内置。

/** 缓存正文在 `app_meta` 里的键；保留旧导出给整包与冒烟用。 */
export { PRESET_CONTENT_META_KEY };

/** 缓存正文的落盘结构；`version` 与快照版本一一对应。 */
export interface CachedPresetContent {
  version: string;
  timetables: TimetablePreset[];
  systems: SystemConfig[];
}

/** 解析并校验一段正文；缺失或不合法返回 null（调用方据此回退内置）。 */
function parseContentOrNull<T>(parse: (input: unknown) => T, input: unknown): T | null {
  if (input === undefined) return null;
  try {
    return parse(input);
  } catch {
    return null;
  }
}

/** 写入缓存正文，只负责落盘；校验在写入前与读回时各做一次。 */
export async function writeCachedPresetContent(storage: Storage, content: CachedPresetContent): Promise<void> {
  await storage.writeMeta(PRESET_CONTENT_META_KEY, JSON.stringify(content));
}

/** 读取缓存的预设正文（app_meta / presets_content_v1）；expectedVersion 不为空时两者必须版本一致，否则返回 null。 */
export async function resolveCachedPresetContent(
  storage: Storage,
  expectedVersion?: string,
): Promise<CachedPresetContent | null> {
  let raw: string | undefined;
  try {
    raw = await storage.readMeta(PRESET_CONTENT_META_KEY);
  } catch {
    return null;
  }
  if (raw === undefined || raw.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const version = typeof record['version'] === 'string' ? record['version'].trim() : '';
  if (version === '') return null;
  if (expectedVersion !== undefined && version !== expectedVersion) return null;

  const timetables = parseContentOrNull(validateTimetables, record['timetables']);
  const systems = parseContentOrNull(validateSystems, record['systems']);
  if (timetables === null || systems === null) return null;
  return { version, timetables, systems };
}

/** 启动套用的结果：`applied` 为真表示本次进程内已切到缓存预设。 */
export interface AppliedPreset {
  version: string;
  kind: 'builtin' | 'cached';
  applied: boolean;
  /** 没套用时的可读原因（只进日志） */
  reason?: string;
}

/** 启动套用：缓存高于内置的预设注入 core 覆盖层。 */
/** 只在启动时调用一次，任一步不成立即回退内置。 */
export async function applyCachedPreset(storage: Storage): Promise<AppliedPreset> {
  try {
    const source = await resolvePresetSource(storage);
    if (source.kind !== 'cached' || source.snapshot === null) {
      // 没有缓存、缓存不比内置新、或快照不可信：清掉可能存在的旧覆盖，保持内置
      setPresetOverride(null);
      return { version: BUILTIN_PRESET_VERSION, kind: 'builtin', applied: false };
    }

    const content = await resolveCachedPresetContent(storage, source.version);
    if (content === null) {
      setPresetOverride(null);
      return {
        version: BUILTIN_PRESET_VERSION,
        kind: 'builtin',
        applied: false,
        reason: `缓存 ${source.version} 缺少可用正文，改用内置预设`,
      };
    }

    const result = setPresetOverride({
      timetables: content.timetables,
      systems: content.systems,
      version: source.version,
    });
    if (!result.applied) {
      setPresetOverride(null);
      return {
        version: BUILTIN_PRESET_VERSION,
        kind: 'builtin',
        applied: false,
        reason: `缓存 ${source.version} 的正文未通过校验（${result.reason ?? '未知原因'}），继续使用内置预设`,
      };
    }
    return { version: effectivePresetVersion(), kind: 'cached', applied: true };
  } catch (cause: unknown) {
    // 兜底：缓存是外部数据，异常时退回内置，不影响启动
    setPresetOverride(null);
    const message = errorMessage(cause);
    return { version: BUILTIN_PRESET_VERSION, kind: 'builtin', applied: false, reason: message };
  }
}
