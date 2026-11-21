/** 预设缓存：下载结果写 app_meta，下次启动校验后套用，坏缓存回退内置。 */
import {
  type Storage,
  type SystemConfig,
  type TimetablePreset,
  effectivePresetVersion,
  setPresetOverride,
  validateSystems,
  validateTimetables,
} from '@dawn-tick/core';
import { PRESET_CONTENT_META_KEY, PRESET_SNAPSHOT_META_KEY } from './lib/meta-keys.ts';
import { errorMessage } from './lib/errors.ts';
import {
  BUILTIN_PRESET_VERSION,
  type PresetSnapshot,
  type PresetSource,
  comparePresetVersions,
  describeSnapshotProblem,
  verifySnapshot,
} from './preset-update.ts';
import { presetUpdateCopy } from './copy/update-preset.ts';

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

/**
 * 下载到的快照落盘：先校验并写正文，通过后才写清单。
 * 顺序反过来时，非法正文会让清单版本领先于已缓存的正文，启动时整份退回内置——之前能用的缓存也失效了。
 */
export async function storeDownloadedSnapshot(
  storage: Storage,
  snapshot: PresetSnapshot,
): Promise<{ ok: boolean; reason?: string }> {
  const content = await cacheSnapshotContent(storage, snapshot);
  if (!content.ok) return content;
  await writeCachedSnapshot(storage, snapshot);
  return { ok: true };
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
        reason: presetUpdateCopy.cacheMissingContent(source.version),
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
        reason: presetUpdateCopy.cacheInvalidContent(source.version, result.reason ?? null),
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
