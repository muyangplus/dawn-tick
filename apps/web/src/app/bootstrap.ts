import {
  DEFAULT_SETTINGS,
  isValidTimeZone,
  readSettings,
  writeSettings,
  type AppSettings,
  type Storage,
} from '@dawn-tick/core';
import { openStorage } from '../db/platform.ts';
import { corruptMessage, isCorruptDatabase } from '../db/health.ts';
import { isFallbackStorage, readOnlyStorage } from '../db/fallback.ts';
import { fail, type Failure } from '../lib/fail.ts';
import { TIME_ZONE_ALIGNED_META_KEY } from '../lib/meta-keys.ts';
import {
  attachLogStorage,
  defaultLogLevel,
  describeError,
  loadLogs,
  logError,
  logInfo,
  logWarn,
} from '../log.ts';
import { CHANNEL } from '../channel.ts';
import { applyCachedPreset } from '../preset-update.ts';
import { applyTheme } from '../theme.ts';
import { maybeAutoBackup, takeRecoveryNotice } from '../backup.ts';
import { maybeAutoSync } from '../webdav.ts';

/** 启动失败：区分损坏（走备份恢复）与其它（重试/日志），文案统一由 fail() 生成。 */
export interface BootFailure {
  kind: 'corrupt' | 'other';
  failure: Failure;
}

/** 启动阶段：只用于失败时定位是哪一步没有完成 */
interface BootStage {
  scope: string;
  label: string;
}

/** 每天备份的检查间隔：够短能补上当天的份，又不至于频繁查目录 */
const DAILY_BACKUP_CHECK_MS = 10 * 60 * 1000;

export interface BootstrapHooks {
  /** 存储与设置就绪（主题已应用）：调用方在这里写 App 状态 */
  onReady: (ready: {
    storage: Storage;
    settings: AppSettings;
    /** 原生库打不开，改用浏览器存储：界面一律只读 */
    readOnly: boolean;
    resolvedMode: 'light' | 'dark';
  }) => void;
  /** 载入首屏数据 */
  loadData: (storage: Storage, settings: AppSettings) => Promise<void>;
  /** 启动阶段的提示（例如备份恢复完成） */
  onNotice?: (message: string) => void;
  /** 远端备份比本机新：交给界面弹窗，不静默覆盖 */
  onRemoteNewer?: (info: { name: string; detail: string | null }) => void;
  /** 持久化申请结果 */
  onPersistent?: (granted: boolean) => void;
  /** 组件已卸载：返回 true 时停止后续副作用 */
  isCancelled?: () => boolean;
}

export type BootstrapResult = { ok: true } | { ok: false; error: BootFailure };

/**
 * 一次性启动编排：打开存储 → 挂日志 → 套用预设 → 对齐时区与日志级别 →
 * 主题 → 恢复提示 → 自动备份/同步 → 载入首屏数据 → 申请持久化。
 *
 * 顺序即启动契约：后面每一步都依赖前面已就绪的状态；失败按阶段归一成错误页文案。
 */
export async function runBootstrap(hooks: BootstrapHooks): Promise<BootstrapResult> {
  let stage: BootStage = { scope: 'storage', label: '存储初始化' };
  try {
    const opened = await openStorage();
    /** 临时回退：原生库打不开，改用浏览器存储；按 Q5 只读，启动阶段也不写任何数据 */
    const readOnly = isFallbackStorage(opened);
    stage = { scope: 'data', label: '数据载入' };
    // 回退期间连日志也不写临时库：只留在内存与原生日志里
    attachLogStorage(readOnly ? readOnlyStorage(opened) : opened);
    await loadLogs();
    // 预设只在启动时套用一次：缓存版本高于内置且正文合法才切换，运行时不替换。
    if (readOnly) {
      logWarn('storage', '临时回退期间跳过启动预设写入', { kind: opened.kind });
    } else {
      try {
        const preset = await applyCachedPreset(opened);
        logInfo('preset', '启动套用预设', {
          version: preset.version,
          source: preset.applied ? 'cached' : 'builtin',
          applied: preset.applied,
          ...(preset.reason === undefined ? {} : { reason: preset.reason }),
        });
      } catch (cause: unknown) {
        const message = describeError(cause);
        logWarn('preset', '启动套用预设失败，继续使用内置预设', { message });
      }
    }
    // 首次启动按系统时区对齐一次；之后完全以用户选择为准（默认上海）
    const aligned = await opened.readMeta(TIME_ZONE_ALIGNED_META_KEY);
    let loaded = await readSettings(opened);
    if (!readOnly && (aligned === undefined || aligned === null || aligned === '')) {
      const systemZone =
        typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : '';
      if (systemZone.length > 0 && isValidTimeZone(systemZone) && systemZone !== loaded.timeZone) {
        loaded = await writeSettings(opened, { timeZone: systemZone });
        logInfo('settings', '首次启动按系统时区对齐', { from: DEFAULT_SETTINGS.timeZone, to: systemZone });
      }
      await opened.writeMeta(TIME_ZONE_ALIGNED_META_KEY, '1');
    }
    // 日志级别默认随渠道定：dev 最详细，其余 info（只写一次，之后跟随用户选择）
    const storedLogLevel = await opened.readMeta('log_level');
    if (!readOnly && (storedLogLevel === undefined || storedLogLevel === null || storedLogLevel === '')) {
      loaded = await writeSettings(opened, { logLevel: defaultLogLevel(CHANNEL) });
      logInfo('settings', '初始化日志级别', { level: loaded.logLevel, channel: CHANNEL });
    }
    if (hooks.isCancelled?.() === true) return { ok: true };
    const resolvedMode = applyTheme(loaded.themePreset, loaded.theme);
    hooks.onReady({ storage: opened, settings: loaded, readOnly, resolvedMode });
    logInfo('storage', '存储就绪', {
      kind: opened.kind,
      fallback: readOnly,
      theme: loaded.themePreset,
      mode: loaded.theme,
    });
    const recovered = await takeRecoveryNotice();
    if (recovered !== null) hooks.onNotice?.(recovered);
    if (readOnly) {
      logWarn('storage', '临时回退期间跳过自动备份与自动同步', { kind: opened.kind });
    } else {
      const snapshot = await maybeAutoBackup(opened, loaded, { startup: true });
      if (snapshot !== null) {
        logInfo('backup', '启动自动备份', { name: snapshot.id, kind: snapshot.kind, bytes: snapshot.bytes });
      }
      const sync = await maybeAutoSync(opened, loaded, { startup: true });
      if (sync.action === 'remote-newer') {
        hooks.onRemoteNewer?.({ name: sync.name, detail: sync.detail });
      } else if (sync.action === 'uploaded') {
        logInfo('webdav', '启动自动同步已上传', { name: sync.name });
      } else if (sync.action === 'error') {
        logWarn('webdav', '启动自动同步失败', { detail: sync.detail });
      }
    }
    await hooks.loadData(opened, loaded);
    const manager = globalThis.navigator?.storage;
    if (manager !== undefined && typeof manager.persist === 'function') {
      const granted = await manager.persist();
      hooks.onPersistent?.(granted);
      logInfo('storage', '持久化申请', { granted });
    }
    return { ok: true };
  } catch (cause: unknown) {
    const message = describeError(cause);
    if (isCorruptDatabase(cause)) {
      logError('storage', '数据库损坏，未载入数据', { message });
      return {
        ok: false,
        error: {
          kind: 'corrupt',
          failure: fail('载入失败', corruptMessage(), '请从最近的备份恢复，或打开备份目录手动处理。'),
        },
      };
    }
    logError(stage.scope, `${stage.label}失败`, { message });
    return {
      ok: false,
      error: {
        kind: 'other',
        failure: fail(
          '载入失败',
          `${stage.label}没有完成`,
          '请重启应用；仍失败请在「设置 → 同步与数据」导入备份，并附日志反馈。',
        ),
      },
    };
  }
}

export interface DailyMaintenance {
  /** 停止定时检查（组件卸载时调用） */
  stop: () => void;
}

/**
 * 每天一次自动备份与自动同步：应用一直开着时也要能补上当天那次。
 * 临时回退（只读）期间不启动。
 */
export function startDailyMaintenance(input: {
  storage: Storage;
  settings: AppSettings;
  onRemoteNewer: (info: { name: string; detail: string | null }) => void;
}): DailyMaintenance {
  const timer = globalThis.setInterval(() => {
    void maybeAutoBackup(input.storage, input.settings, { startup: false }).then((snapshot) => {
      if (snapshot !== null) {
        logInfo('backup', '每日自动备份', { name: snapshot.id, kind: snapshot.kind, bytes: snapshot.bytes });
      }
    });
    void maybeAutoSync(input.storage, input.settings, { startup: false }).then((outcome) => {
      if (outcome.action === 'remote-newer') {
        input.onRemoteNewer({ name: outcome.name, detail: outcome.detail });
      } else if (outcome.action === 'uploaded') {
        logInfo('webdav', '每日自动同步已上传', { name: outcome.name });
      } else if (outcome.action === 'error') {
        logWarn('webdav', '每日自动同步失败', { detail: outcome.detail });
      }
    });
  }, DAILY_BACKUP_CHECK_MS);
  return {
    stop: () => globalThis.clearInterval(timer),
  };
}
