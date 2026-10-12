/**
 * 预设版本与更新：从独立预设仓库读数据，缓存到本地，失败一律回退内置预设。
 *
 * 数据流：
 *   1. `checkPresetUpdate` 只拉 `version.json`，按 SemVer 与本地版本比较，回答「有没有更新」；
 *   2. `fetchSnapshot` 拉 `snapshot/presets-<version>.json`，**规范化后做 sha256 校验**，
 *      校验不过直接抛可读错误（内容不可信，绝不使用）；
 *   3. `writeCachedSnapshot` 把校验通过的快照写进 `app_meta`，下次启动由
 *      `resolvePresetSource` 读取——「下载」与「生效」是分开的两步：
 *      正在使用的预设不会被静默替换，下载成功只提示「下次启动生效」。
 *
 * 安全边界：本模块**只消费数据**，不执行预设仓库里的任何 JS 适配器。
 *
 * 哈希口径与预设仓库 `scripts/snapshot.mjs` 完全一致：
 * 对「去掉 hash 字段后的对象」做键序规范化的 JSON 序列化，再取 sha256。
 */

import { BUILTIN_PRESET_VERSION as CORE_BUILTIN_PRESET_VERSION, type Storage } from '@dawn-tick/core';
import { compareVersions } from './update.ts';

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

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Uint32Array 取值：本仓库开了 noUncheckedIndexedAccess，索引一定在范围内。 */
function at(values: Uint32Array, index: number): number {
  return values[index] ?? 0;
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * 纯 TS 的 SHA-256（同步）。
 *
 * 为什么需要它：`crypto.subtle.digest` 只有异步 API，而 `verifySnapshot` 按约定
 * 必须同步返回布尔值，因此这里留一份等价实现；异步路径优先走 WebCrypto。
 * 两者结果一致由单元测试对拍（`sha256Hex` 与 `verifySnapshot` 必须同判）。
 */
export function sha256HexSync(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = at(words, index - 15);
      const y = at(words, index - 2);
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      words[index] = (at(words, index - 16) + s0 + at(words, index - 7) + s1) >>> 0;
    }

    let a = at(state, 0);
    let b = at(state, 1);
    let c = at(state, 2);
    let d = at(state, 3);
    let e = at(state, 4);
    let f = at(state, 5);
    let g = at(state, 6);
    let h = at(state, 7);

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + at(SHA256_K, index) + at(words, index)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (at(state, 0) + a) >>> 0;
    state[1] = (at(state, 1) + b) >>> 0;
    state[2] = (at(state, 2) + c) >>> 0;
    state[3] = (at(state, 3) + d) >>> 0;
    state[4] = (at(state, 4) + e) >>> 0;
    state[5] = (at(state, 5) + f) >>> 0;
    state[6] = (at(state, 6) + g) >>> 0;
    state[7] = (at(state, 7) + h) >>> 0;
  }

  // 状态字按大端写成 hex：不能直接读 state.buffer 的字节，那样会带上平台字节序
  let hex = '';
  for (let index = 0; index < 8; index += 1) {
    hex += at(state, index).toString(16).padStart(8, '0');
  }
  return hex;
}

/**
 * 对字符串做 sha256，返回小写 hex。
 *
 * 浏览器与 Node 24 都有 `crypto.subtle`，优先走它（原生实现、快）；
 * 环境确实没有 WebCrypto 时退回同口径的纯 TS 实现，而不是让功能不可用。
 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined && typeof subtle.digest === 'function') {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return bytesToHex(new Uint8Array(digest));
  }
  return sha256HexSync(text);
}

/** 规范化 JSON：对象键排序、数组保序、无多余空白（与预设仓库 snapshot.mjs 同口径）。 */
export function canonicalPresetJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalPresetJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalPresetJson(record[key])}`).join(',')}}`;
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
