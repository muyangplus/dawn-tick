/**
 * 预设版本与更新：从独立预设仓库读数据，缓存到本地，失败一律回退内置预设。
 *
 * 数据流：
 *   1. `checkPresetUpdate` 只拉 `version.json`，按 SemVer 与本地版本比较，回答「有没有更新」；
 *   2. `fetchSnapshot` 拉 `snapshot/presets-<version>.json`，**规范化后做 sha256 校验**，
 *      校验不过直接抛可读错误（内容不可信，绝不使用）；
 *   3. `writeCachedSnapshot` 把校验通过的快照写进 `app_meta`，下次启动由
 *      `resolvePresetSource` / `applyCachedPreset` 读取——「下载」与「生效」是分开的两步：
 *      正在使用的预设不会被静默替换，下载成功只提示「下次启动生效」。
 *   4. `writeCachedPresetContent` 把快照清单里的正文单独存一份（`presets_content_v1`），
 *      启动时由 `applyCachedPreset` 过校验收进 core 的覆盖层——**启动套用、运行时不热替换**。
 *
 * 安全边界：本模块**只消费数据**，不执行预设仓库里的任何 JS 适配器。
 *
 * 哈希口径与预设仓库 `scripts/snapshot.mjs` 完全一致：
 * 对「去掉 hash 字段后的对象」做键序规范化的 JSON 序列化，再取 sha256。
 */

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

/**
 * 哈希口径与预设仓库 `scripts/snapshot.mjs` 一致，实现只有一份：core 的
 * `packages/core/src/config/preset-hash.ts`。
 * 这里**只做转出**（`export { ... } from` 会保留同名导出，外部调用方不受影响），
 * 免得「浏览器一份纯 TS、Node 一份」两边漂移。
 */
export { canonicalPresetJson, sha256HexSync } from '@dawn-tick/core';

/** 预设仓库的版本清单地址（只写常量，运行时不主动联网，除非用户点「检查预设更新」）。 */
export const PRESET_VERSION_URL =
  'https://raw.githubusercontent.com/muyangplus/dawn-tick-presets/main/version.json';

/** 指定版本的快照地址。 */
export const PRESET_SNAPSHOT_URL = (version: string): string =>
  `https://raw.githubusercontent.com/muyangplus/dawn-tick-presets/main/snapshot/presets-${version}.json`;

/** 内置预设的版本号：来自 core 的 `preset-version.json`（当前 = 预设仓库 1.0.0）。 */
export const BUILTIN_PRESET_VERSION: string = CORE_BUILTIN_PRESET_VERSION;

/** 本版应用能消费的快照数据格式版本；高于它的快照一律拒收。 */
export const PRESET_SCHEMA_VERSION = 1;

/** 快照在 `app_meta` 里的缓存键。 */
export const PRESET_SNAPSHOT_META_KEY = 'presets_snapshot_v1';

export interface PresetSnapshot {
  version: string;
  schemaVersion: number;
  generatedAt?: string;
  /**
   * 预设文件清单（id / path / sha256）。
   * `adapters`（{ 文件名: sha256 }）也在快照里、也参与哈希，但本模块**只保存不执行**，
   * 第三方 JS 适配器的沙箱是另一个议题。
   */
  sources: { timetables: unknown[]; systems: unknown[]; adapters?: Record<string, string> };
  /** `sha256:<hex>`，对去掉本字段后的规范化 JSON 计算 */
  hash: string;
}

/** 检查更新的结果。`version` 为远端最新版本号；失败时为 null。 */
export interface PresetUpdateStatus {
  available: boolean;
  version: string | null;
  error: string | null;
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

/**
 * 对字符串做 sha256，返回小写 hex。
 *
 * 浏览器与 Node 24 都有 `crypto.subtle`，优先走它（原生实现、快）；
 * 环境确实没有 WebCrypto 时退回同口径的同步实现（core 的 `sha256HexSync`），
 * 而不是让功能不可用。
 */
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

/**
 * 校验快照内容哈希：去掉 `hash` 字段后规范化序列化，再取 sha256 与 `snapshot.hash` 比对。
 * 未通过即视为不可用（调用方必须回退内置预设）。
 */
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
  const message = cause instanceof Error ? cause.message : String(cause);
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

/**
 * 检查有没有更新的预设版本。
 * 任何异常（离线、404、JSON 非法、格式不认识）都收敛为可读的 `error`，不向界面抛出。
 * 成功时 `version` 为远端最新版本号（不一定比本地新），失败时为 null。
 */
export async function checkPresetUpdate(options: {
  cachedVersion: string;
  fetchImpl?: typeof fetch;
}): Promise<PresetUpdateStatus> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return { available: false, version: null, error: '当前环境无法联网检查预设更新' };
  }
  try {
    const response = await doFetch(PRESET_VERSION_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) return { available: false, version: null, error: `预设源返回 ${response.status}` };
    const parsed: unknown = await response.json();
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
    };
  } catch (cause: unknown) {
    return { available: false, version: null, error: describeFetchError(cause) };
  }
}

/**
 * 下载并校验指定版本的快照。
 * 结构不对、HTTP 失败或哈希不符都会抛出可读错误——调用方负责回退内置预设。
 */
export async function fetchSnapshot(version: string, fetchImpl?: typeof fetch): Promise<PresetSnapshot> {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version.trim())) {
    throw new Error(`预设版本号不合法：${version}`);
  }
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('当前环境无法联网下载预设快照');

  let parsed: unknown;
  try {
    const response = await doFetch(PRESET_SNAPSHOT_URL(version.trim()), {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`预设源返回 ${response.status}`);
    parsed = await response.json();
  } catch (cause: unknown) {
    throw new Error(`预设快照下载失败：${describeFetchError(cause)}`);
  }

  const problem = describeSnapshotProblem(parsed);
  if (problem !== null) throw new Error(`预设快照不可用：${problem}`);
  const snapshot = parsed as PresetSnapshot;
  if (!verifySnapshot(snapshot)) {
    throw new Error('预设快照哈希校验未通过（内容与 hash 不一致），已拒绝使用');
  }
  return snapshot;
}

/**
 * 读取缓存的快照（`app_meta` / `presets_snapshot_v1`）。
 * 缺失、JSON 损坏、结构不对或哈希不符一律返回 null（即回退内置预设），不抛错。
 */
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

/**
 * 下载成功后的**同一步**：把快照里带的正文校验一遍再落盘（`presets_content_v1`）。
 *
 * 正文不合法时**不写**（也不清掉可能存在的旧正文），只返回原因——
 * 于是下次启动仍会退回内置，而不会用半截数据去覆盖正在用的预设。
 */
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
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * 当前应当使用的预设来源：缓存比内置新且哈希可信时用缓存，否则回退内置。
 * 「下次启动生效」的语义就落在这一步——正在运行的界面不会被静默换掉。
 */
export async function resolvePresetSource(storage: Storage): Promise<PresetSource> {
  const cached = await readCachedSnapshot(storage);
  if (cached === null) return { version: BUILTIN_PRESET_VERSION, kind: 'builtin', snapshot: null };
  if (comparePresetVersions(cached.version, BUILTIN_PRESET_VERSION) <= 0) {
    return { version: BUILTIN_PRESET_VERSION, kind: 'builtin', snapshot: null };
  }
  return { version: cached.version, kind: 'cached', snapshot: cached };
}

// —— 缓存正文：启动时真正「套用」的那一份数据 ——
//
// 快照（`presets_snapshot_v1`）是**清单**：每条只记 `{ id, path, sha256 }`，
// 它回答「预设仓库有哪些文件、内容哈希是多少」，本身不含作息表/教务系统的正文。
// 因此「启动时套用缓存」还差一份正文，它单独存在 `presets_content_v1`：
//   1. 版本必须与快照一致，且必须比内置新——否则一律不用（不允许降级、不允许串版本）；
//   2. 正文必须过 core 的 `validateTimetables` / `validateSystems`——不合格就整体忽略；
//   3. 任何读取/解析失败都收敛成 null，绝不抛到调用方（坏缓存只能退回内置）。

/** 缓存正文在 `app_meta` 里的键。 */
export const PRESET_CONTENT_META_KEY = 'presets_content_v1';

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

/**
 * 写入缓存正文。只负责落盘，校验在写入前（`fetchSnapshot` 之后）与读回时各做一次。
 * 校验不通过的内容不该走到这里；万一是坏数据，读回侧也会拦住它。
 */
export async function writeCachedPresetContent(storage: Storage, content: CachedPresetContent): Promise<void> {
  await storage.writeMeta(PRESET_CONTENT_META_KEY, JSON.stringify(content));
}

/**
 * 读取缓存的预设正文（`app_meta` / `presets_content_v1`）。
 *
 * `expectedVersion` 不为空时要求两者一致——否则视为不可用：
 * 清单说 1.1.0、正文却是别的版本，说明缓存被写坏或来自另一个版本，宁可用内置。
 * 返回 null 表示「没有可用的缓存正文」，调用方必须回退内置。
 */
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

/**
 * **启动套用**：把「本地缓存且版本高于内置」的预设注进 core 的覆盖层。
 *
 * 判定顺序（任何一步不成立都回退内置，且本函数永不抛错）：
 *   1. `resolvePresetSource` 认可缓存（版本 > 内置、快照结构与哈希可信）→ 否则内置；
 *   2. 缓存正文版本与快照一致、且通过 core 的校验 → 否则内置；
 *   3. 满足①②才 `setPresetOverride()`，此后 `findTimetable` / `readSystemsConfig`
 *      等读取函数返回的就是缓存预设。
 *
 * **运行时绝不热替换**：本函数只应在启动时调用一次。设置页下载成功后只写缓存、
 * 提示「下次启动生效」，不会调用它去改正在使用的预设。
 */
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
        reason: `缓存 ${source.version} 缺少可用正文（或正文与快照版本不一致），继续使用内置预设`,
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
    // 兜底：缓存是外部数据，任何意外都只让它退回内置，绝不影响启动
    setPresetOverride(null);
    const message = cause instanceof Error ? cause.message : String(cause);
    return { version: BUILTIN_PRESET_VERSION, kind: 'builtin', applied: false, reason: message };
  }
}
