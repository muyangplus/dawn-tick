import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, formatDate, weekStart } from '@dawn-tick/core';
import { nextRefreshAt, shouldRefreshOnResume } from '../lib/clock-boundary.ts';
import { readSettings, updateSemester, writeSettings, DEFAULT_SETTINGS, type AppSettings, type Storage } from '@dawn-tick/core';
import { createSnapshot, pruneSnapshots } from '../backup.ts';
import { downloadAndApply, type ApplyMode } from '../webdav.ts';
import { defaultWindowStart, loadAppData, type AppData } from '../data.ts';
import { STORAGE_READ_ONLY_MESSAGE, isFallbackStorage, readOnlyStorage } from '../db/fallback.ts';
import {
  DATABASE_CORRUPT_WRITE_BLOCKED,
  corruptReadOnlyStorage,
  isCorruptLocked,
  subscribeCorrupt,
} from '../db/corrupt-guard.ts';
import { clampDayDate, clampWindowStart, dayRangeOf, defaultDayDate, stepDay, stepWindow } from '../lib/day-nav.ts';
import { fail } from '../lib/fail.ts';
import { logInfo, logWarn } from '../log.ts';
import { notifyWidgetWindows, writeWidgetSnapshot } from '../widget-snapshot.ts';
import { registerPendingRestart } from '../pending-restart.ts';
import { applyTheme } from '../theme.ts';
import { toast } from '../components/ui/toaster.tsx';
import type { RemoteBackupInfo } from '../components/app-dialogs.tsx';
import { runBootstrap, startDailyMaintenance, type BootFailure } from './bootstrap.ts';
import { useReminders } from '../useReminders.ts';

/** 改变课表窗口排法的设置：改完后窗口回到默认起点。 */
const VIEW_SETTING_KEYS: readonly (keyof AppSettings)[] = ['viewDays', 'weekStartsToday', 'hideWeekends'];
const USER_ID = 'u1';

/** 小组件的一周概览要覆盖今天所在的整周；默认窗口（如从今天起）不完整时另取一份整周数据。 */
async function currentWeekData(storage: Storage, settings: AppSettings, loaded: AppData): Promise<AppData> {
  const monday = weekStart(loaded.today);
  const sunday = addDays(monday, 6);
  const covered = loaded.windowDates.includes(monday) && loaded.windowDates.includes(sunday);
  if (covered) return loaded;
  return loadAppData(storage, { ...settings, viewDays: 7 }, { windowStart: monday });
}

export type TimetableMode = 'week' | 'today';

/**
 * 应用会话：存储、设置、首屏数据、启动编排与「看哪一段」的导航状态。
 *
 * 只做数据与状态，不碰任何视图：视图拿这里的 `data / settings / patch / refresh`
 * 与翻页命令；写入口统一走 `guardWrite`（临时回退期间一律拦截）。
 */
export interface AppSession {
  storage: Storage | null;
  settings: AppSettings;
  data: AppData | null;
  /** 启动失败：非空时整页显示错误页 */
  error: BootFailure | null;
  /** 持久化申请结果：null 表示未申请或不支持 */
  persistent: boolean | null;
  /** 临时回退（原生库打不开）：界面一律只读 */
  fallback: boolean;
  /** 运行中数据库损坏：写入已锁死，界面提示只读 */
  corrupt: boolean;
  /** 各屏拿到的存储：回退时是只读包装 */
  uiStorage: Storage | null;
  /** 写入口统一提示：返回 false 表示这次操作被拦下 */
  guardWrite: (action: string) => boolean;
  /** 课表页的日模式 / 周模式 */
  mode: TimetableMode;
  setMode: (mode: TimetableMode) => void;
  /** 查看窗口的起始日期；null 表示跟随设置里的默认起点 */
  windowStart: string | null;
  setWindowStart: (value: string | null) => void;
  /** 日模式查看的日期；null 表示今天 */
  dayDate: string | null;
  setDayDate: (value: string | null) => void;
  /** 主题生效后的明暗：给 Toaster 等需要知道的组件 */
  resolvedMode: 'light' | 'dark';
  reload: (target: Storage | null, current: AppSettings, start?: string | null) => Promise<AppData | undefined>;
  /** 重新载入当前窗口 */
  refresh: () => void;
  patch: (partial: Partial<AppSettings>) => Promise<void>;
  /** 从库外写入设置后（WebDAV 只应用设置与预设）重新读一遍并热加载 */
  reloadSettings: () => Promise<void>;
  /** 错误页「重试」：重新走一遍启动流程 */
  retryBoot: () => void;
  /** 周模式平移一屏（按设置的天数） */
  shiftWindow: (days: number) => void;
  /** 日模式翻一天 */
  stepDayBy: (delta: -1 | 1) => void;
  /** 回到今天：周模式回默认起点，日模式回今天 */
  backToToday: () => void;
  switchSemester: (id: string) => Promise<void>;
  reminders: ReturnType<typeof useReminders>;
  remoteNewer: RemoteBackupInfo | null;
  setRemoteNewer: (info: RemoteBackupInfo | null) => void;
  applyRemote: (mode: ApplyMode) => Promise<void>;
}

export function useAppSession(): AppSession {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<BootFailure | null>(null);
  /** 递增触发一次启动重试（错误页「重试」） */
  const [bootTick, setBootTick] = useState(0);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>('light');
  const [mode, setMode] = useState<TimetableMode>('week');
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [dayDate, setDayDate] = useState<string | null>(null);
  /** 远端备份比本机新：启动或每日同步发现，下载前先给本机做快照 */
  const [remoteNewer, setRemoteNewer] = useState<RemoteBackupInfo | null>(null);
  /** 运行中数据库损坏：同一会话只由守卫通知一次，之后界面保持只读 */
  const [corrupt, setCorrupt] = useState(false);

  useEffect(() => {
    if (isCorruptLocked()) setCorrupt(true);
    return subscribeCorrupt(() => setCorrupt(true));
  }, []);

  /** 临时回退（原生库打不开）：主壳常驻警告条，界面一律只读 */
  const fallback = storage !== null && isFallbackStorage(storage);
  const uiStorage = useMemo(() => {
    if (storage === null) return null;
    if (corrupt) return corruptReadOnlyStorage(storage);
    return fallback ? readOnlyStorage(storage) : storage;
  }, [storage, fallback, corrupt]);
  /** 写入口统一提示：返回 false 表示这次操作被拦下 */
  const guardWrite = useCallback(
    (action: string): boolean => {
      if (corrupt) {
        logWarn('storage', '数据库损坏后拦截写操作', { action });
        toast.error(DATABASE_CORRUPT_WRITE_BLOCKED);
        return false;
      }
      if (!fallback) return true;
      logWarn('storage', '临时回退期间拦截写操作', { action });
      toast.error(STORAGE_READ_ONLY_MESSAGE);
      return false;
    },
    [fallback, corrupt],
  );
  // 提醒动作（如「完成」）会写库：回退/损坏时经只读包装拦下，不写进临时库
  const reminders = useReminders(uiStorage, data?.semester?.id ?? null, data?.timeZone ?? settings.timeZone, {
    enabled: settings.classReminderEnabled,
    minutes: settings.classReminderMinutes,
    quietHours: settings.quietHours,
  });

  /** 每次载入的序号：连点翻页、改设置与窗口 effect 交错时，只采用最后一次发起的结果 */
  const reloadSeq = useRef(0);
  /** 上次载入完成的时刻与当天日期：回到前台时据此判断要不要重载 */
  const loadedAt = useRef(0);
  const reload = useCallback(
    async (
      target: Storage | null,
      current: AppSettings,
      start?: string | null,
      reuseSnapshot = false,
    ): Promise<AppData | undefined> => {
      if (target === null) return undefined;
      const seq = ++reloadSeq.current;
      const explicit = start !== undefined && start !== null && start !== '';
      const next = await loadAppData(target, current, explicit ? { windowStart: start, reuseSnapshot } : { reuseSnapshot });
      if (seq !== reloadSeq.current) return undefined;
      loadedAt.current = Date.now();
      setData(next);
      // 只记显式起点：null 表示跟随设置里的默认起点，设置一变窗口才会跟着动。
      // 记夹过学期的实际起点（next.windowStart），避免状态与已加载窗口不一致时「翻不动」。
      if (explicit) setWindowStart(next.windowStart);
      logInfo('data', '加载课表', {
        week: next.week,
        viewWeek: next.viewWeek,
        windowStart: next.windowStart,
        windowDays: next.windowDates.length,
        spansWeeks: next.windowSpansWeeks,
        lessons: [...next.grid.values()].reduce((total, list) => total + list.length, 0),
        today: next.todayLessons.length,
        todos: next.todos.length,
        exams: next.exams.length,
      });
      // 翻页只换查看窗口，数据没变：不重写小组件快照、不惊动悬浮窗；临时回退库只读，不写快照
      if (!explicit && !isFallbackStorage(target)) {
        await writeWidgetSnapshot(target, await currentWeekData(target, current, next), current);
        await notifyWidgetWindows();
      }
      return next;
    },
    [],
  );

  // 启动：一次性的副作用顺序由 bootstrap 负责，这里只把结果落到状态
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await runBootstrap({
        onReady: ({ storage: opened, settings: loaded, resolvedMode: mode }) => {
          if (cancelled) return;
          setStorage(opened);
          setSettings(loaded);
          setResolvedMode(mode);
        },
        // 首屏数据：失败由 bootstrap 归一成错误页文案
        loadData: async (opened, loaded) => {
          await reload(opened, loaded);
        },
        onNotice: (message) => toast.info(message),
        onRemoteNewer: (info) => {
          if (!cancelled) setRemoteNewer(info);
        },
        onPersistent: (granted) => {
          if (!cancelled) setPersistent(granted);
        },
        isCancelled: () => cancelled,
      });
      if (!cancelled && !result.ok) setError(result.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, bootTick]);

  // 每天一次自动备份与自动同步：应用一直开着时也要能补上当天那次
  useEffect(() => {
    if (storage === null || isFallbackStorage(storage)) return;
    const maintenance = startDailyMaintenance({
      storage,
      settings,
      onRemoteNewer: (info) => setRemoteNewer(info),
    });
    return maintenance.stop;
  }, [storage, settings]);

  // 查看窗口变化后重载：windowStart=null 表示「用默认起点」，要拿默认起点跟已加载的窗口起点比
  useEffect(() => {
    if (storage === null || data === null || data.semester === null) return;
    const wanted = clampWindowStart(windowStart ?? defaultWindowStart(data.today, settings), dayRangeOf(data.semester));
    if (wanted === data.windowStart) return;
    // 只是翻页：库没写过就复用上次读出的学期数据
    void reload(storage, settings, wanted, true);
  }, [windowStart, data, storage, settings, reload]);

  // 跨过课程起止或午夜时刷新「今天 / 正在上 / 下一节」与小组件；回到前台（含 Capacitor resume）时补一次
  useEffect(() => {
    if (storage === null || data === null) return undefined;
    const refreshNow = (): void => {
      void reload(storage, settings, windowStart);
    };
    const wait = Math.max(1000, nextRefreshAt(data, Date.now()) - Date.now());
    // setTimeout 上限约 24.8 天；课表场景最长到午夜，不会触顶
    const timer = setTimeout(refreshNow, wait);
    const onResume = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const today = formatDate(Date.now(), data.timeZone);
      if (shouldRefreshOnResume(loadedAt.current, data.today, Date.now(), today)) refreshNow();
    };
    globalThis.document?.addEventListener('visibilitychange', onResume);
    globalThis.document?.addEventListener('resume', onResume);
    return () => {
      clearTimeout(timer);
      globalThis.document?.removeEventListener('visibilitychange', onResume);
      globalThis.document?.removeEventListener('resume', onResume);
    };
  }, [storage, data, settings, windowStart, reload]);

  // 主题：预设 + 明暗落到根节点；跟随系统时监听系统变化
  useEffect(() => {
    setResolvedMode(applyTheme(settings.themePreset, settings.theme));
    if (settings.theme !== 'system' || typeof globalThis.matchMedia !== 'function') return;
    const media = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const listener = (): void => setResolvedMode(applyTheme(settings.themePreset, settings.theme));
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [settings.theme, settings.themePreset]);

  const patch = useCallback(
    async (partial: Partial<AppSettings>) => {
      if (storage === null) return;
      if (!guardWrite('修改设置')) return;
      const next = await writeSettings(storage, partial);
      setSettings(next);
      // 视图相关设置变了就回到默认起点（今天或本周周一），否则保持用户当前翻到的位置
      const viewChanged = VIEW_SETTING_KEYS.some((key) => partial[key] !== undefined);
      if (viewChanged) setWindowStart(null);
      await reload(storage, next, viewChanged ? null : windowStart);
    },
    [storage, reload, windowStart, guardWrite],
  );

  const refresh = useCallback(() => {
    void reload(storage, settings, windowStart);
  }, [reload, storage, settings, windowStart]);

  const reloadSettings = useCallback(async (): Promise<void> => {
    if (storage === null) return;
    const next = await readSettings(storage);
    setSettings(next);
    setResolvedMode(applyTheme(next.themePreset, next.theme));
    await reload(storage, next, windowStart);
  }, [reload, storage, windowStart]);

  /** 远端备份比本机新时的提示：下载前先给本机做快照，避免静默覆盖。 */
  const applyRemote = useCallback(
    async (applyMode: ApplyMode): Promise<void> => {
      if (storage === null) return;
      if (!guardWrite('应用远端备份')) return;
      const safe = await createSnapshot(storage);
      await pruneSnapshots(storage, settings.backupKeep);
      const result = await downloadAndApply(storage, settings, applyMode, remoteNewer?.name);
      if (!result.ok) {
        toast.error(fail('下载失败', result.error ?? '未知原因', '请检查同步设置后重试。').text);
        logWarn('webdav', '下载同步包失败', { error: result.error });
        return;
      }
      setRemoteNewer(null);
      if (applyMode === 'settings') {
        await reloadSettings();
        toast.success(`已应用远端设置与预设${safe === null ? '' : '（已先备份本机）'}`);
        return;
      }
      await reloadSettings();
      // 整库恢复要重启才完全生效：只登记，统一由主壳的待重启条提示
      registerPendingRestart('remote-restore');
      toast.success(`已恢复整库（写入 ${result.outcome?.full?.imported ?? 0} 条）`);
    },
    [storage, settings, remoteNewer, guardWrite, reloadSettings],
  );

  /** 错误页「重试」：重新走一遍启动流程，不用接受用户手动重启。 */
  const retryBoot = useCallback(() => {
    logInfo('storage', '用户点击载入失败页的重试');
    setError(null);
    setBootTick((value) => value + 1);
  }, []);

  /** 上一屏 / 下一屏：按设置的天数平移窗口起点，停在学期首/末周（Q6）；翻不动就不动。 */
  const shiftWindow = useCallback(
    (days: number) => {
      if (data === null || data.semester === null) return;
      const start = windowStart ?? data.windowStart;
      if (start === '') return;
      const next = stepWindow(start, days > 0 ? 1 : -1, {
        days: Math.abs(days),
        range: dayRangeOf(data.semester),
        hideWeekends: settings.hideWeekends,
      });
      if (next !== null) setWindowStart(next);
    },
    [data, windowStart, settings.hideWeekends],
  );

  /** 日模式翻一天：跳过周末、停在学期边界。 */
  const stepDayBy = useCallback(
    (delta: -1 | 1) => {
      if (data === null || data.semester === null) return;
      const range = dayRangeOf(data.semester);
      const current = clampDayDate(dayDate ?? defaultDayDate(data.today, settings.hideWeekends), range);
      const next = stepDay(current, delta, { hideWeekends: settings.hideWeekends, range });
      if (next !== null) setDayDate(next);
    },
    [data, dayDate, settings.hideWeekends],
  );

  /** 回到今天：周模式回默认起点，日模式回今天。 */
  const backToToday = useCallback(() => {
    setWindowStart(null);
    setDayDate(null);
  }, []);

  const switchSemester = useCallback(
    async (id: string): Promise<void> => {
      if (storage === null || data === null) return;
      if (!guardWrite('切换学期')) return;
      for (const semester of data.semesters) {
        if (semester.id !== id && semester.is_active === 1) {
          await updateSemester(storage, semester.id, { is_active: 0 });
        }
      }
      await updateSemester(storage, id, { is_active: 1 });
      setWindowStart(null);
      setDayDate(null);
      // 显式按默认起点重载：refresh 捕获的是旧学期的窗口起点
      await reload(storage, settings, null);
    },
    [storage, data, guardWrite, reload, settings],
  );

  return {
    storage,
    settings,
    data,
    error,
    persistent,
    fallback,
    corrupt,
    uiStorage,
    guardWrite,
    mode,
    setMode,
    windowStart,
    setWindowStart,
    dayDate,
    setDayDate,
    resolvedMode,
    reload,
    refresh,
    patch,
    reloadSettings,
    retryBoot,
    shiftWindow,
    stepDayBy,
    backToToday,
    switchSemester,
    reminders,
    remoteNewer,
    setRemoteNewer,
    applyRemote,
  };
}
