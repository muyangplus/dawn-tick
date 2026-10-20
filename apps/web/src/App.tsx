import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  dayOfWeek as nextDayOfWeek,
  readSettings,
  isValidTimeZone,
  maskToWeeks,
  updateSemester,
  writeSettings,
  type AppSettings,
  type EventRow,
  type ManagedCourse,
  type Occurrence,
  type SearchHit,
  type Storage,
} from '@dawn-tick/core';
import { AddActionsProvider, AddFab, type AddActionHandlers } from './components/add-menu.tsx';
import { ScheduleFocusContext } from './components/schedule-focus.ts';
import { AdjustDialog, type AdjustTarget } from './components/adjust-dialog.tsx';
import { AppToolbar } from './components/app-toolbar.tsx';
import { AppSidebar, BottomNav, type NavId } from './components/nav.tsx';
import { LessonDetail } from './components/lesson-detail.tsx';
import { SearchDialog } from './components/search-dialog.tsx';
import { Button } from './components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from './components/ui/dialog.tsx';
import { BusyOverlay } from './components/ui/busy-overlay.tsx';
import { PendingRestartBar } from './components/pending-restart-bar.tsx';
import { ExternalLinkConfirm } from './components/ui/external-link.tsx';
import { ConfirmDialogHost } from './components/ui/confirm-dialog.tsx';
import { Sheet } from './components/ui/sheet.tsx';
import { Toaster, toast } from './components/ui/toaster.tsx';
import { Database, Loader2, TriangleAlert } from 'lucide-react';
import {
  defaultWindowStart,
  loadAppData,
  loadCourseDetail,
  weekDateOf,
  type AppData,
  type CourseDetail,
  type LessonCell,
} from './data.ts';
import { maybeAutoBackup, createSnapshot, pruneSnapshots, takeRecoveryNotice } from './backup.ts';
import { downloadAndApply, maybeAutoSync, type ApplyMode } from './webdav.ts';
import { openStorage } from './db/platform.ts';
import { corruptMessage, isCorruptDatabase } from './db/health.ts';
import {
  STORAGE_FALLBACK_BADGE,
  STORAGE_FALLBACK_BANNER,
  STORAGE_READ_ONLY_MESSAGE,
  isFallbackStorage,
  readOnlyStorage,
} from './db/fallback.ts';
import { fail, type Failure } from './lib/fail.ts';
import { restoreLatestBackupSnapshot } from './lib/recovery.ts';
import { CourseForm, type CourseFormPreset } from './screens/course-form.tsx';
import { LessonDetailOpener } from './screens/cards/schedule-cards.tsx';
import { Onboarding } from './screens/onboarding.tsx';
import { ScheduleView } from './screens/schedule-view.tsx';
import { DevicesView } from './screens/devices-view.tsx';
import { SettingsView } from './screens/settings-view.tsx';
import { TodayView } from './screens/today-view.tsx';
import { TodoForm } from './screens/todo-form.tsx';
import { WeekView } from './screens/week-view.tsx';
import { applyTheme } from './theme.ts';
import { ensureStartupPermissions } from './permissions.ts';
import { markNotifyAsked } from './notify.ts';
import { attachLogStorage, clearLogs, describeError, loadLogs, logDebug, logError, logInfo, logWarn, logsText } from './log.ts';
import { registerPendingRestart } from './pending-restart.ts';
import { applyCachedPreset } from './preset-update.ts';
import { useBreakpoint, useMediaQuery } from './lib/use-media.ts';
import { clampDayDate, clampWindowStart, dayRangeOf, defaultDayDate, stepDay, stepWindow } from './lib/day-nav.ts';
import { useReminders } from './useReminders.ts';
import { checkForUpdate, resolveReceiveBeta, type UpdateStatus } from './update.ts';
import { openDataDirectory, relaunchApplication, storageStatusLabel } from './storage-config.ts';
import { applyDevFeatures } from './dev-features.ts';
import { applyLogSettings, defaultLogLevel } from './log.ts';
import { openExternalUrl, saveTextFile } from './system-actions.ts';
import { CHANNEL, CHANNEL_LABEL, appVersion } from './channel.ts';
import { notifyWidgetWindows, writeWidgetSnapshot } from './widget-snapshot.ts';
import './styles.css';

const USER_ID = 'u1';
/** 改变课表窗口排法的设置：改完后窗口回到默认起点。 */
const VIEW_SETTING_KEYS: readonly (keyof AppSettings)[] = ['viewDays', 'weekStartsToday', 'hideWeekends'];

const STORAGE_LABEL: Record<Storage['kind'], string> = {
  indexeddb: '浏览器 IndexedDB',
  sqlite: '原生 SQLite',
  memory: '内存（测试）',
};

interface DetailState {
  cell: LessonCell;
  detail: CourseDetail;
  /** 这一课次所在的日期：详情页的「调课」把它作为原日期 */
  date: string;
}

/** 启动失败：区分损坏（走备份恢复）与其它（重试/日志），文案统一由 fail() 生成。 */
interface BootFailure {
  kind: 'corrupt' | 'other';
  failure: Failure;
}

/** 窗口覆盖的日期区间文案，例如 8/19–8/23。 */
function formatWindowRange(data: AppData): string {
  const last = data.windowDates[data.windowDates.length - 1] ?? data.windowStart;
  const monthDay = (date: string): string => {
    const [, month, day] = date.split('-');
    return `${Number(month)}/${Number(day)}`;
  };
  if (data.windowStart === last) return monthDay(data.windowStart);
  const [fromYear, fromMonth] = data.windowStart.split('-');
  const [toYear, toMonth] = last.split('-');
  if (fromYear === toYear && fromMonth === toMonth) return `${monthDay(data.windowStart)}–${Number(last.split('-')[2])}`;
  return `${monthDay(data.windowStart)}–${monthDay(last)}`;
}

/** 按当天课次还原课程卡信息：时间线课次不是周视图格子，详情与周视图共用同一份数据。 */
function lessonCellOf(data: AppData, target: AdjustTarget): LessonCell {
  const occurrence = (data.lessonsByDate.get(target.date) ?? []).find(
    (item) => item.scheduleId === target.scheduleId,
  );
  const periodStart = occurrence?.periodStart ?? target.periodStart;
  const periodEnd = occurrence?.periodEnd ?? target.periodEnd;
  const slotOf = (period: number): string =>
    data.slots.find((slot) => slot.period_no === period)?.start_time ?? '';
  const endSlotOf = (period: number): string =>
    data.slots.find((slot) => slot.period_no === period)?.end_time ?? '';
  return {
    scheduleId: target.scheduleId,
    courseId: target.courseId,
    name: occurrence?.shortName ?? occurrence?.courseName ?? target.courseName,
    teacher: null,
    room: occurrence?.room ?? null,
    color: occurrence?.color ?? 'var(--dt-primary)',
    dayOfWeek: nextDayOfWeek(target.date),
    date: target.date,
    periodStart,
    periodEnd,
    startTime: slotOf(periodStart),
    endTime: endSlotOf(periodEnd),
    inWeek: true,
    holiday: data.holidayLabels.has(target.date),
    cancelled: false,
    movedOut: false,
    movedIn: false,
    lab: false,
  };
}

/** 加载页的「仍在载入…」阈值：冷启动超过 3 秒才追加，避免正常启动闪一下。 */
export const LOADING_SLOW_MS = 3000;

/** 冷启动加载页：图标 + 进度文案；3 秒后追加「仍在载入…」。 */
export function LoadingScreen({ slowAfterMs = LOADING_SLOW_MS }: { slowAfterMs?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setSlow(true), slowAfterMs);
    return () => globalThis.clearTimeout(timer);
  }, [slowAfterMs]);
  return (
    <main
      className="flex h-full flex-col items-center justify-center gap-3 bg-page p-4"
      role="status"
      aria-live="polite"
      data-role="loading-screen"
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-muted text-primary-strong">
        <Loader2 className="dt-spinner size-6" aria-hidden />
      </div>
      <p className="text-sm text-ink">正在载入…</p>
      {slow && (
        <p className="text-xs text-muted" data-role="loading-slow">
          仍在载入…
        </p>
      )}
    </main>
  );
}

export interface ErrorScreenProps {
  kind: 'corrupt' | 'other';
  failure: Failure;
  onRetry: () => void;
  onRestore: () => void;
  onOpenBackupDir: () => void;
  onOpenLogs: () => void;
}

/** 页面级错误：图标 + 标题 + 说明 + 最多两个修复按钮（损坏走备份，其它走重试/日志）。 */
export function ErrorScreen({
  kind,
  failure,
  onRetry,
  onRestore,
  onOpenBackupDir,
  onOpenLogs,
}: ErrorScreenProps) {
  const corrupt = kind === 'corrupt';
  const Icon = corrupt ? Database : TriangleAlert;
  return (
    <main
      className="flex h-full items-start justify-center overflow-y-auto overscroll-contain bg-page p-4"
      data-role="error-screen"
    >
      <div className="my-auto flex w-full max-w-md flex-col items-center gap-3 text-center" role="alert">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-danger/10 text-danger-strong">
          <Icon className="size-6" aria-hidden />
        </div>
        <h1 className="text-base font-semibold text-ink">{failure.title}</h1>
        <p className="text-sm text-muted">{failure.body}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {corrupt ? (
            <>
              <Button variant="primary" onClick={onRestore}>
                从备份文件恢复
              </Button>
              <Button variant="secondary" onClick={onOpenBackupDir}>
                打开备份目录
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" onClick={onRetry}>
                重试
              </Button>
              <Button variant="secondary" onClick={onOpenLogs}>
                打开日志
              </Button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export interface StorageFallbackBannerProps {
  onRetry: () => void;
  onOpenLogs: () => void;
}

/** 主壳顶部的临时回退警告条：常驻、首屏可见，并说明回退期间只读。 */
export function StorageFallbackBanner({ onRetry, onOpenLogs }: StorageFallbackBannerProps) {
  return (
    <div
      role="alert"
      data-role="storage-fallback-banner"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-strong"
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{STORAGE_FALLBACK_BANNER}</span>
      <span className="rounded-full bg-warning/10 px-2 py-0.5 font-medium">{STORAGE_FALLBACK_BADGE}</span>
      <span className="text-[11px]">{STORAGE_READ_ONLY_MESSAGE}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        重试
      </Button>
      <Button size="sm" variant="ghost" onClick={onOpenLogs}>
        打开日志
      </Button>
    </div>
  );
}
/** 首次启动系统时区对齐的标记：只做一次，之后跟随用户选择。 */
const TIME_ZONE_ALIGNED_KEY = 'time_zone_aligned';
/** 渠道提示的已读标记：存 id 数组，新增提示对老用户同样会弹一次。 */
const SEEN_NOTICES_KEY = 'seen_notices';
const NOTICE_DEV = 'dev-frequent-updates';
const NOTICE_BETA = 'beta-unstable';
const RELEASES_URL = 'https://github.com/muyangplus/dawn-tick/releases';
/** 每天备份的检查间隔：够短能补上当天的份，又不至于频繁查目录 */
const DAILY_BACKUP_CHECK_MS = 10 * 60 * 1000;

async function readSeenNotices(storage: Storage): Promise<string[]> {
  try {
    const raw = await storage.readMeta(SEEN_NOTICES_KEY);
    if (raw === null || raw === undefined || raw === '') return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function markNoticeSeen(storage: Storage, id: string): Promise<void> {
  try {
    const seen = await readSeenNotices(storage);
    if (seen.includes(id)) return;
    await storage.writeMeta(SEEN_NOTICES_KEY, JSON.stringify([...seen, id]));
  } catch (cause: unknown) {
    // 提示已读只是本地记录：临时回退（只读）或写失败都不该打断用户
    logWarn('notice', '记录提示已读失败', { message: describeError(cause) });
  }
}

export function App() {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<NavId>('timetable');
  /** 课表空态点「导入课表」时递增：设置页收到后自动打开导入抽屉 */
  const [settingsImportSignal, setSettingsImportSignal] = useState(0);
  const [mode, setMode] = useState<'week' | 'today'>('week');
  /** 查看窗口的起始日期；null 表示从今天开始（默认）。窗口里的周次由 data.viewWeek 给出 */
  const [windowStart, setWindowStart] = useState<string | null>(null);
  /** 日模式查看的日期；null 表示今天（开「不显示周末」时顺延到下一个工作日） */
  const [dayDate, setDayDate] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjust, setAdjust] = useState<AdjustTarget | null>(null);
  const [quickCreate, setQuickCreate] = useState<CourseFormPreset | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  /** 日程页查看的日期：由 App 持有，搜索命中某条日程时可以直接定位到那一天 */
  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  /** 搜索命中的日程条目 id：日程时间线滚动到该行并高亮 */
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<ManagedCourse | null>(null);
  const [todoFormOpen, setTodoFormOpen] = useState(false);
  /** 非空表示正在编辑这一条日程：单击时间线里的日程即可进入 */
  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);
  const [eventFormKind, setEventFormKind] = useState<'todo' | 'exam'>('todo');
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>('light');
  const [error, setError] = useState<BootFailure | null>(null);
  /** 递增触发一次启动重试（错误页「重试」） */
  const [bootTick, setBootTick] = useState(0);
  /** 待展示的渠道提示（开发版频繁更新 / 测试版不稳定），按 id 记录已提示过 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 启动权限只申请一次，设置变化不再重复弹系统弹窗 */
  const startupPermissionsDone = useRef(false);
  /** 上一屏是不是日程页：用于离开日程时把查看日期收回今天 */
  const leftSchedule = useRef(false);
  /** 发现新版本时的更新信息弹窗 */
  const [updateInfo, setUpdateInfo] = useState<UpdateStatus | null>(null);
  /** 递增触发一次额外的自动检查（切到测试版后） */
  const [checkTick, setCheckTick] = useState(0);
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === 'desktop';
  /** ≥1440 才把课程详情并排成第三栏；1024–1439 用右侧覆盖层，避免把课表列宽压到不可读 */
  const wideEnoughForSidePanel = useMediaQuery('(min-width: 1440px)');
  /** 课表页的日模式：←/→ 翻一天，顶部换日期翻页 */
  const dayMode = view === 'timetable' && mode === 'today';
  /** 临时回退（原生库打不开）：主壳常驻警告条，界面一律只读 */
  const fallback = storage !== null && isFallbackStorage(storage);
  /** 各屏拿到的存储：回退时包成只读，统一拦截所有写入口 */
  const uiStorage = useMemo(
    () => (storage === null ? null : fallback ? readOnlyStorage(storage) : storage),
    [storage, fallback],
  );
  /** 写入口统一提示：返回 false 表示这次操作被拦下 */
  const guardWrite = useCallback(
    (action: string): boolean => {
      if (!fallback) return true;
      logWarn('storage', '临时回退期间拦截写操作', { action });
      toast.error(STORAGE_READ_ONLY_MESSAGE);
      return false;
    },
    [fallback],
  );
  const reminders = useReminders(storage, data?.semester?.id ?? null, data?.timeZone ?? settings.timeZone, {
    enabled: settings.classReminderEnabled,
    minutes: settings.classReminderMinutes,
  });

  const reload = useCallback(
    async (target: Storage | null, current: AppSettings, start?: string | null): Promise<AppData | undefined> => {
      if (target === null) return undefined;
      const explicit = start !== undefined && start !== null && start !== '';
      const next = await loadAppData(target, current, explicit ? { windowStart: start } : {});
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
      await writeWidgetSnapshot(target, next, current);
      await notifyWidgetWindows();
      return next;
    },
    [],
  );

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let stage = { scope: 'storage', label: '存储初始化' };
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
        const aligned = await opened.readMeta(TIME_ZONE_ALIGNED_KEY);
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
          await opened.writeMeta(TIME_ZONE_ALIGNED_KEY, '1');
        }
        // 日志级别默认随渠道定：dev 最详细，其余 info（只写一次，之后跟随用户选择）
        const storedLogLevel = await opened.readMeta('log_level');
        if (!readOnly && (storedLogLevel === undefined || storedLogLevel === null || storedLogLevel === '')) {
          loaded = await writeSettings(opened, { logLevel: defaultLogLevel(CHANNEL) });
          logInfo('settings', '初始化日志级别', { level: loaded.logLevel, channel: CHANNEL });
        }
        if (cancelled) return;
        setStorage(opened);
        setSettings(loaded);
        setResolvedMode(applyTheme(loaded.themePreset, loaded.theme));
        logInfo('storage', '存储就绪', {
          kind: opened.kind,
          fallback: readOnly,
          theme: loaded.themePreset,
          mode: loaded.theme,
        });
        const recovered = await takeRecoveryNotice();
        if (recovered !== null) toast.info(recovered);
        if (readOnly) {
          logWarn('storage', '临时回退期间跳过自动备份与自动同步', { kind: opened.kind });
        } else {
          const snapshot = await maybeAutoBackup(opened, loaded, { startup: true });
          if (snapshot !== null) {
            logInfo('backup', '启动自动备份', { name: snapshot.id, kind: snapshot.kind, bytes: snapshot.bytes });
          }
          const sync = await maybeAutoSync(opened, loaded, { startup: true });
          if (sync.action === 'remote-newer') {
            setRemoteNewer({ name: sync.name, detail: sync.detail });
          } else if (sync.action === 'uploaded') {
            logInfo('webdav', '启动自动同步已上传', { name: sync.name });
          } else if (sync.action === 'error') {
            logWarn('webdav', '启动自动同步失败', { detail: sync.detail });
          }
        }
        await reload(opened, loaded);
        const manager = globalThis.navigator?.storage;
        if (manager !== undefined && typeof manager.persist === 'function') {
          const granted = await manager.persist();
          if (!cancelled) setPersistent(granted);
          logInfo('storage', '持久化申请', { granted });
        }
      } catch (cause: unknown) {
        const message = describeError(cause);
        if (isCorruptDatabase(cause)) {
          logError('storage', '数据库损坏，未载入数据', { message });
          if (!cancelled) {
            setError({
              kind: 'corrupt',
              failure: fail(
                '载入失败',
                corruptMessage(),
                '请从最近的备份恢复，或打开备份目录手动处理。',
              ),
            });
          }
          return;
        }
        logError(stage.scope, `${stage.label}失败`, { message });
        if (!cancelled) {
          setError({
            kind: 'other',
            failure: fail(
              '载入失败',
              `${stage.label}没有完成`,
              '请重启应用；仍失败请在「设置 → 同步与数据」导入备份，并附日志反馈。',
            ),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, bootTick]);

  // 每天一次自动备份与自动同步：应用一直开着时也要能补上当天那次
  useEffect(() => {
    if (storage === null || isFallbackStorage(storage)) return;
    const timer = globalThis.setInterval(() => {
      void maybeAutoBackup(storage, settings, { startup: false }).then((snapshot) => {
        if (snapshot !== null) {
          logInfo('backup', '每日自动备份', { name: snapshot.id, kind: snapshot.kind, bytes: snapshot.bytes });
        }
      });
      void maybeAutoSync(storage, settings, { startup: false }).then((outcome) => {
        if (outcome.action === 'remote-newer') {
          setRemoteNewer({ name: outcome.name, detail: outcome.detail });
        } else if (outcome.action === 'uploaded') {
          logInfo('webdav', '每日自动同步已上传', { name: outcome.name });
        } else if (outcome.action === 'error') {
          logWarn('webdav', '每日自动同步失败', { detail: outcome.detail });
        }
      });
    }, DAILY_BACKUP_CHECK_MS);
    return () => globalThis.clearInterval(timer);
  }, [storage, settings]);

  // 日志级别与开关同步到原生：写文件的门槛按设置走（dev 默认 trace）
  useEffect(() => {
    applyLogSettings({ level: settings.logLevel, fileEnabled: settings.logEnabled });
  }, [settings.logLevel, settings.logEnabled]);

  // 开发者特性开关：影响 debug 日志、右键菜单与控制台；更新渠道不变
  useEffect(() => {
    applyDevFeatures(settings.devFeatures);
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_dev_console', { enabled: settings.devFeatures });
      } catch {
        // 非桌面端没有控制台
      }
    })();
  }, [settings.devFeatures, settings.logLevel, settings.logEnabled]);

  // 启动时主动索取必要权限：安卓的通知与精确闹钟（课前提醒要靠它们才准点）
  useEffect(() => {
    if (storage === null || startupPermissionsDone.current) return;
    startupPermissionsDone.current = true;
    void ensureStartupPermissions({ remindersEnabled: settings.classReminderEnabled }).then(async (report) => {
      // 只有真的发起过系统申请才记「问过」：否则桌面端会把「未申请」误判成「已拒绝」
      if (report.notifications !== 'skipped' && !isFallbackStorage(storage)) await markNotifyAsked(storage);
    });
    // 存储就绪后只跑一次：权限弹窗不该随设置变化重复弹
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);

  // 动效设置落到根节点：CSS 按 data-motion 统一停用
  useEffect(() => {
    document.documentElement.dataset.motion = settings.motion;
  }, [settings.motion]);

  // 渠道提示：不是初次使用也要弹——只要这条提示没展示过
  useEffect(() => {
    const storageReady = storage;
    if (storageReady === null) return;
    const noticeId = CHANNEL === 'dev' ? NOTICE_DEV : CHANNEL === 'beta' ? NOTICE_BETA : null;
    if (noticeId === null) return;
    void (async () => {
      const seen = await readSeenNotices(storageReady);
      if (!seen.includes(noticeId)) setNotice(noticeId);
    })();
  }, [storage]);

  useEffect(() => {
    setResolvedMode(applyTheme(settings.themePreset, settings.theme));
    if (settings.theme !== 'system' || typeof globalThis.matchMedia !== 'function') return;
    const media = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const listener = (): void => setResolvedMode(applyTheme(settings.themePreset, settings.theme));
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [settings.theme, settings.themePreset]);

  useEffect(() => {
    // 切页时收起课程详情：桌面侧栏不跨页常驻
    setDetail(null);
    // 离开日程页回到今天：再进日程默认看今天（搜索命中是从别的页直接带着日期进来，不受影响）
    if (leftSchedule.current && view !== 'schedule') {
      setScheduleDate(null);
      setFocusEventId(null);
    }
    leftSchedule.current = view === 'schedule';
  }, [view]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable === true)
      ) {
        return;
      }
      // 弹窗打开时背景不动：只保留 Esc（弹窗自己也能关），/ 不叠第二层搜索、←/→ 与 T 不翻背景
      if (typeof document !== 'undefined' && document.querySelector('[role="dialog"]') !== null) {
        if (event.key === 'Escape' && detail !== null) setDetail(null);
        return;
      }
      if (event.key === 'Escape' && detail !== null) {
        setDetail(null);
        return;
      }
      // 日模式 ←/→ 翻一天；周模式平移一屏（设置里的天数）。T 回到今天
      if (event.key === 'ArrowLeft') {
        if (dayMode) stepDayBy(-1);
        else shiftWindow(-settings.viewDays);
      } else if (event.key === 'ArrowRight') {
        if (dayMode) stepDayBy(1);
        else shiftWindow(settings.viewDays);
      } else if (event.key === 't' || event.key === 'T') backToToday();
      else if (event.key === '/') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [settings.viewDays, shiftWindow, stepDayBy, backToToday, dayMode, detail]);

  useEffect(() => {
    if (storage === null || data === null || data.semester === null) return;
    // windowStart=null 表示「用默认起点」：要拿默认起点跟已加载的窗口起点比，否则「回到今天」不会重载
    // 默认起点也夹进学期：今天落在学期外时停在边界（Q6），不再出现「学期外」窗口
    const wanted = clampWindowStart(
      windowStart ?? defaultWindowStart(data.today, settings),
      dayRangeOf(data.semester),
    );
    if (wanted === data.windowStart) return;
    void reload(storage, settings, wanted);
  }, [windowStart, data, storage, settings, reload]);

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

  /** 从库外写入设置后（WebDAV 只应用设置与预设）重新读一遍并热加载。 */
  const reloadSettings = useCallback(async (): Promise<void> => {
    if (storage === null) return;
    const next = await readSettings(storage);
    setSettings(next);
    setResolvedMode(applyTheme(next.themePreset, next.theme));
    await reload(storage, next, windowStart);
  }, [reload, storage, windowStart]);

  const [remoteNewer, setRemoteNewer] = useState<{ name: string; detail: string | null } | null>(null);

  /** 远端备份比本机新时的提示：下载前先给本机做快照，避免静默覆盖。 */
  async function applyRemote(mode: ApplyMode): Promise<void> {
    if (storage === null) return;
    if (!guardWrite('应用远端备份')) return;
    const safe = await createSnapshot(storage);
    await pruneSnapshots(storage, settings.backupKeep);
    const result = await downloadAndApply(storage, settings, mode, remoteNewer?.name);
    if (!result.ok) {
      toast.error(fail('下载失败', result.error ?? '未知原因', '请检查同步设置后重试。').text);
      logWarn('webdav', '下载同步包失败', { error: result.error });
      return;
    }
    setRemoteNewer(null);
    if (mode === 'settings') {
      await reloadSettings();
      toast.success(`已应用远端设置与预设${safe === null ? '' : '（已先备份本机）'}`);
      return;
    }
    await reloadSettings();
    // 整库恢复要重启才完全生效：只登记，统一由主壳的待重启条提示
    registerPendingRestart('remote-restore');
    toast.success(`已恢复整库（写入 ${result.outcome?.full?.imported ?? 0} 条）`);
  }

  /** 错误页「重试」：重新走一遍启动流程，不用接受用户手动重启。 */
  const retryBoot = useCallback(() => {
    logInfo('storage', '用户点击载入失败页的重试');
    setError(null);
    setBootTick((value) => value + 1);
  }, []);

  /** 回退警告条「重试」：原生侧重启会重新打开数据库；浏览器侧退回整页刷新。 */
  async function retryStorage(): Promise<void> {
    logInfo('storage', '用户请求重试打开原生存储', { fallback });
    if (await relaunchApplication()) return;
    try {
      globalThis.location.reload();
    } catch (cause: unknown) {
      logWarn('storage', '自动重启失败', { message: describeError(cause) });
      toast.error(fail('重试失败', '当前环境不能自动重启', '请手动关闭并重新打开应用。').text);
    }
  }

  /** 「打开日志」：走现有导出入口（桌面端另存、其余端下载），日志本身只进文件。 */
  async function exportDiagnosticLogs(): Promise<void> {
    try {
      const entries = logsText();
      const name = `DawnTick-log-${new Date().toISOString().slice(0, 10)}.txt`;
      const saved = await saveTextFile(name, entries === '' ? '暂无日志' : entries, {
        extension: 'txt',
        filterName: '日志文件',
      });
      if (saved.cancelled) return;
      if (!saved.ok) {
        toast.error(
          fail('打开日志失败', saved.error ?? '日志没能写出', '请稍后重试；仍失败请在「设备与同步」里打开日志目录。').text,
        );
        return;
      }
      logInfo('log', '已导出诊断日志', { path: saved.path, bytes: entries.length });
      toast.success(saved.path === null ? '已下载日志' : '已导出日志');
      // 回退期间不写临时存储：导出已经完成，清空留到原生库恢复后
      if (!fallback) await clearLogs();
    } catch (cause: unknown) {
      logError('log', '打开日志失败', { message: describeError(cause) });
      toast.error(fail('打开日志失败', '日志暂时读不出来', '请稍后重试；仍失败请在「设备与同步」里查看。').text);
    }
  }

  /** 损坏页「从备份文件恢复」：用最近一份通过自检的快照排队恢复，随后重启生效。 */
  async function restoreFromBackup(): Promise<void> {
    const outcome = await restoreLatestBackupSnapshot();
    if (!outcome.ok) {
      toast.error(
        fail('恢复失败', outcome.error ?? '没有读到可用备份', '请打开备份目录手动处理，或重启应用后再试。').text,
      );
      return;
    }
    toast.success(`已排队恢复 ${outcome.name ?? '最近的快照'}，正在重启…`);
    if (!(await relaunchApplication())) {
      toast.info('请手动关闭并重新打开应用，恢复才会生效');
    }
  }

  /** 损坏页「打开备份目录」：备份在数据目录的 backups 子目录里。 */
  async function openBackupDirectory(): Promise<void> {
    const dir = await openDataDirectory();
    if (dir === null) {
      toast.error(
        fail('打开备份目录失败', '当前平台不支持打开数据目录', '请在「设备与同步」里导出或导入备份。').text,
      );
      return;
    }
    logInfo('storage', '打开数据目录', { dir });
    toast.info(`已打开数据目录；备份在其中 backups 子目录：${dir}`);
  }

  // 窗口改尺寸后记录一次视口与滚动区高度：滑不动时日志里能看出是哪一层算错
  useEffect(() => {
    if (typeof globalThis.addEventListener !== 'function') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const report = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        const main = document.querySelector('[data-role="app-main"]');
        const shell = document.querySelector('[data-role="app-shell"]');
        const nav = document.querySelector('[data-role="bottom-nav"]');
        const navHeight = nav === null ? null : Math.round(nav.getBoundingClientRect().height);
        const mainPadBottom =
          main === null ? null : Math.round(Number.parseFloat(getComputedStyle(main).paddingBottom) || 0);
        logDebug('layout', '视口变化', {
          viewport: `${globalThis.innerWidth}x${globalThis.innerHeight}`,
          shell: shell === null ? null : Math.round(shell.getBoundingClientRect().height),
          main: main === null ? null : Math.round(main.getBoundingClientRect().height),
          mainScroll: main === null ? null : `${main.scrollTop}/${main.scrollHeight}`,
          navHeight,
          mainPadBottom,
          cards: document.querySelectorAll('[data-role="course-card"]').length,
          gridPadTop: document.querySelector('[data-role="grid-pad-top"]') === null ? 0 : 1,
          gridPadBottom: document.querySelector('[data-role="grid-pad-bottom"]') === null ? 0 : 1,
        });
        // 自检：底部留白必须不小于底部栏，否则最后一屏会被挡住
        if (navHeight !== null && mainPadBottom !== null && mainPadBottom < navHeight) {
          logWarn('layout', '主区底部留白小于底部栏高度', { navHeight, mainPadBottom });
        }
        // 自检：引导页内容超出时必须可滚动
        const onboard = document.querySelector('[data-role="onboarding-scroll"]');
        if (onboard !== null) {
          const overflowY = getComputedStyle(onboard).overflowY;
          const box = {
            clientHeight: Math.round(onboard.clientHeight),
            scrollHeight: Math.round(onboard.scrollHeight),
            overflowY,
          };
          logDebug('layout', '引导页滚动容器', box);
          if (box.scrollHeight > box.clientHeight && overflowY !== 'auto' && overflowY !== 'scroll') {
            logWarn('layout', '引导页内容超出却不可滚动', box);
          }
        }
      }, 200);
    };
    globalThis.addEventListener('resize', report);
    report();
    // 启动时日志级别还没同步到原生，第一次上报可能被门槛挡掉：布局稳定后再报一次
    const late = setTimeout(report, 2500);
    return () => {
      globalThis.removeEventListener('resize', report);
      clearTimeout(late);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // 启动时按设置检查一次更新，只提示不下载；「自动检查版本更新」关闭时跳过
  const autoChecked = useRef(false);
  useEffect(() => {
    if (!settings.autoCheckUpdate) return;
    if (autoChecked.current && checkTick === 0) return;
    autoChecked.current = true;
    let cancelled = false;
    void (async () => {
      const status = await checkForUpdate({
        channel: CHANNEL,
        receiveBeta: resolveReceiveBeta(settings.receiveBeta, CHANNEL),
        currentVersion: appVersion(),
      });
      if (cancelled || !status.available) return;
      // 检查到新版本：弹窗显示版本、渠道与发布说明
      setUpdateInfo(status);
    })();
    return () => {
      cancelled = true;
    };
    // 设置就绪后只检查一次；切到测试版会递增 checkTick 再查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoCheckUpdate, checkTick]);

  // 过了截止时间的日程默认标记为完成（只在确有需要时写一次，避免循环）
  useEffect(() => {
    if (data === null || storage === null) return;
    logDebug('data', '数据已加载', {
      storage: storage.kind,
      semester: data.semester?.name ?? null,
      week: data.week,
      viewWeek: data.viewWeek,
      slots: data.slots.length,
      courses: data.courses.length,
      cells: [...data.grid.values()].reduce((total, list) => total + list.length, 0),
      todayLessons: data.todayLessons.length,
      todos: data.todos.length,
      exams: data.exams.length,
      adjustments: data.reschedules.length,
      holidays: data.holidayLabels.size,
    });
  }, [data, storage]);

  // 过期条目由日程时间线在展示层判定「已完成」（自动进「已完成」分组），这里不回写 events.done。

  /** 课次所在日期：网格里的格子自带日期，直接用它。 */
  function lessonDateOf(cell: LessonCell): string {
    return cell.date === '' ? data?.today ?? '' : cell.date;
  }

  async function openLesson(cell: LessonCell): Promise<void> {
    if (storage === null) return;
    // 实验格没有课程行：直接进这条实验的详情编辑，而不是去找不存在的课程
    if (cell.eventId !== undefined) {
      const lab = data?.labs.find((row) => row.id === cell.eventId);
      if (lab !== undefined) {
        logInfo('timetable', '打开实验详情', { id: lab.id, title: lab.title });
        setEditingEvent(lab);
        setTodoFormOpen(true);
        return;
      }
      logWarn('timetable', '实验条目不存在', { id: cell.eventId });
    }
    const loaded = await loadCourseDetail(storage, cell.courseId);
    setDetail({ cell, detail: loaded, date: lessonDateOf(cell) });
  }

  /** 日程时间线里点课程：按当天课次还原课程卡，再打开同一份课程详情。 */
  async function openLessonFromSchedule(target: AdjustTarget): Promise<void> {
    if (storage === null || data === null) return;
    const loaded = await loadCourseDetail(storage, target.courseId);
    setDetail({ cell: lessonCellOf(data, target), detail: loaded, date: target.date });
  }

  /** 日视图里点课程行：课次不是网格格，按当天课次还原课程卡后走同一个 openLesson。 */
  function openLessonFromDay(lesson: Occurrence): void {
    if (data === null) return;
    void openLesson(
      lessonCellOf(data, {
        scheduleId: lesson.scheduleId,
        courseId: lesson.courseId,
        courseName: lesson.courseName,
        date: lesson.date,
        periodStart: lesson.periodStart,
        periodEnd: lesson.periodEnd,
      }),
    );
  }

  /** 详情页的「调课」：以当前这一课次为预设目标，打开调课弹窗。 */
  function openAdjustForLesson(cell: LessonCell, date: string): void {
    if (!guardWrite('调课')) return;
    setAdjust({
      scheduleId: cell.scheduleId,
      courseId: cell.courseId,
      courseName: data?.courses.find((course) => course.id === cell.courseId)?.name ?? cell.name,
      date,
      periodStart: cell.periodStart,
      periodEnd: cell.periodEnd,
    });
    setAdjustOpen(true);
  }

  /** 拖拽入口：落点是某天某个节次，预填进同一个调课弹窗，不再另开一个「调整课程时间」。 */
  function openAdjustForDrop(cell: LessonCell, date: string, period: number): void {
    setAdjust({
      scheduleId: cell.scheduleId,
      courseId: cell.courseId,
      courseName: data?.courses.find((course) => course.id === cell.courseId)?.name ?? cell.name,
      date: cell.date,
      periodStart: cell.periodStart,
      periodEnd: cell.periodEnd,
      drop: { date, periodStart: period },
    });
    setAdjustOpen(true);
  }

  async function switchSemester(id: string): Promise<void> {
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
    refresh();
  }

  /** 四个新增动作的唯一实现：工具栏下拉、移动 FAB 与日程页「添加」菜单都调到同一份。 */
  const addActions = useMemo<AddActionHandlers>(
    () => ({
      course: () => {
        if (!guardWrite('新建课程')) return;
        setEditingCourse(null);
        setQuickCreate(null);
        setCourseFormOpen(true);
      },
      todo: () => {
        if (!guardWrite('添加待办')) return;
        setEditingEvent(null);
        setEventFormKind('todo');
        setTodoFormOpen(true);
      },
      exam: () => {
        if (!guardWrite('添加考试')) return;
        setEditingEvent(null);
        setEventFormKind('exam');
        setTodoFormOpen(true);
      },
      import: () => {
        setView('settings');
        setSettingsImportSignal((value) => value + 1);
      },
    }),
    [guardWrite],
  );

  /** 搜索命中：日程翻到命中日期并高亮那一行；排课按命中周翻窗后打开课程详情。 */
  async function pickSearchHit(hit: SearchHit): Promise<void> {
    if (storage === null || data === null) return;
    if (hit.kind === 'event') {
      setFocusEventId(hit.id);
      // 未排期的条目没有日期：保持当前日期，不做无意义的跳转
      if (hit.date !== undefined) setScheduleDate(hit.date);
      setView('schedule');
      return;
    }
    const semester = data.semester;
    if (hit.kind !== 'schedule' || semester === null || hit.dayOfWeek === undefined) {
      setView('timetable');
      return;
    }
    // 命中周：本周在排课范围内就停在本周，否则落到这条排课的第一个周次
    const weeks = hit.weeksMask === undefined ? [] : maskToWeeks(hit.weeksMask, semester.total_weeks);
    const week = weeks.includes(data.week) ? data.week : (weeks[0] ?? data.viewWeek);
    const date = weekDateOf(semester, week, hit.dayOfWeek);
    const start = weekDateOf(semester, week, 1);
    setMode('week');
    setView('timetable');
    if (start !== data.windowStart) {
      const next = await reload(storage, settings, start);
      if (next === undefined) return;
      setFocusEventId(null);
      await openHitLesson(next, hit.id, date);
      return;
    }
    setFocusEventId(null);
    await openHitLesson(data, hit.id, date);
  }

  /** 打开某条排课在指定日期的详情：优先用网格里的那一格，落不到网格时按当天课次还原课程卡。 */
  async function openHitLesson(source: AppData, scheduleId: string, date: string): Promise<void> {
    if (storage === null) return;
    const cell = [...source.grid.values()]
      .flat()
      .find((item) => item.scheduleId === scheduleId && item.date === date);
    if (cell !== undefined) {
      await openLesson(cell);
      return;
    }
    const occurrence = (source.lessonsByDate.get(date) ?? []).find((item) => item.scheduleId === scheduleId);
    if (occurrence === undefined) return;
    const target: AdjustTarget = {
      scheduleId: occurrence.scheduleId,
      courseId: occurrence.courseId,
      courseName: occurrence.courseName,
      date,
      periodStart: occurrence.periodStart,
      periodEnd: occurrence.periodEnd,
    };
    const loaded = await loadCourseDetail(storage, occurrence.courseId);
    setDetail({ cell: lessonCellOf(source, target), detail: loaded, date });
  }

  if (error !== null) {
    return (
      <ErrorScreen
        kind={error.kind}
        failure={error.failure}
        onRetry={retryBoot}
        onRestore={() => void restoreFromBackup()}
        onOpenBackupDir={() => void openBackupDirectory()}
        onOpenLogs={() => void exportDiagnosticLogs()}
      />
    );
  }

  if (storage === null || data === null) {
    return <LoadingScreen />;
  }

  /** 存储就绪后各屏共用：回退时是只读包装，写操作会统一被拒绝 */
  const screenStorage = uiStorage ?? storage;

  if (data.semester === null) {
    const fallbackBanner = fallback ? (
      <StorageFallbackBanner
        onRetry={() => void retryStorage()}
        onOpenLogs={() => void exportDiagnosticLogs()}
      />
    ) : null;
    return (
      <>
        {fallbackBanner !== null && <div className="fixed inset-x-0 top-0 z-40">{fallbackBanner}</div>}
        <Onboarding
          storage={screenStorage}
          userId={USER_ID}
          timeZone={settings.timeZone}
          onDone={() => {
            void (async () => {
              await reload(storage, settings, null);
              setView('timetable');
            })();
          }}
        />
        <Toaster mode={resolvedMode} />
        {/* 外部链接确认弹窗在引导页也要挂上，否则「请求适配 / 提交学校信息」点了没反应 */}
        <ExternalLinkConfirm />
        <ConfirmDialogHost />
        <BusyOverlay />
      </>
    );
  }

  const semester = data.semester;
  /** 日模式显示的日期：默认今天（开「不显示周末」时顺延到下一个工作日），夹在学期内 */
  const dayRange = dayRangeOf(semester);
  const viewDay = clampDayDate(dayDate ?? defaultDayDate(data.today, settings.hideWeekends), dayRange);
  const canPrevDay = stepDay(viewDay, -1, { hideWeekends: settings.hideWeekends, range: dayRange }) !== null;
  const canNextDay = stepDay(viewDay, 1, { hideWeekends: settings.hideWeekends, range: dayRange }) !== null;
  // 周模式与日模式同一份边界口径：第 1 周与最后一周的 ‹ › 置灰（Q6：停在学期边界）
  const weekStepOptions = { days: settings.viewDays, range: dayRange, hideWeekends: settings.hideWeekends };
  const canPrevWeek = stepWindow(data.windowStart, -1, weekStepOptions) !== null;
  const canNextWeek = stepWindow(data.windowStart, 1, weekStepOptions) !== null;

  // 视图进入过渡：key 随 view 变化，切页时容器重建，动画才会重新触发；
  // `data-motion=off` 由 styles.css 的停用规则压到 1ms。
  const content = (
    <div key={view} className="dt-view-enter" data-role="view-root">
      {view === 'timetable' &&
        (mode === 'week' ? (
          <WeekView
            data={data}
            showOtherWeeks={settings.showOtherWeeks}
            compact={!isDesktop}
            onImport={() => {
              setView('settings');
              setSettingsImportSignal((value) => value + 1);
            }}
            onSelectLesson={(cell) => void openLesson(cell)}
            onMoveLesson={(cell, date, period) => openAdjustForDrop(cell, date, period)}
            onQuickCreate={(preset) => {
              if (!guardWrite('新建课程')) return;
              setEditingCourse(null);
              setQuickCreate(preset);
              setCourseFormOpen(true);
            }}
            onPrevWindow={() => shiftWindow(-settings.viewDays)}
            onNextWindow={() => shiftWindow(settings.viewDays)}
          />
        ) : (
          <TodayView
            data={data}
            date={viewDay}
            isToday={viewDay === data.today}
            onOpenWeek={() => setMode('week')}
            onSelectLesson={openLessonFromDay}
          />
        ))}
      {view === 'schedule' && (
        <AddActionsProvider actions={addActions}>
          <LessonDetailOpener.Provider value={(target) => void openLessonFromSchedule(target)}>
            <ScheduleFocusContext.Provider value={focusEventId}>
              <ScheduleView
                data={data}
                storage={screenStorage}
                onChanged={refresh}
                viewDate={scheduleDate ?? data.today}
                onViewDateChange={(date) => {
                  setScheduleDate(date);
                  setFocusEventId(null);
                }}
                onAddTodo={addActions.todo}
                onAddExam={addActions.exam}
                onOpenEvent={(event) => {
                  if (!guardWrite('编辑日程')) return;
                  setEditingEvent(event);
                  setTodoFormOpen(true);
                }}
                tomorrowPreview={settings.tomorrowPreview}
                semesterCountdown={settings.semesterCountdown}
                holidayCountdown={settings.holidayCountdown}
              />
            </ScheduleFocusContext.Provider>
          </LessonDetailOpener.Provider>
        </AddActionsProvider>
      )}
      {view === 'settings' && (
        <SettingsView
          storage={screenStorage}
          userId={USER_ID}
          settings={settings}
          semesters={[data.semester, ...data.semesters.filter((item) => item.id !== data.semester?.id)]}
          activeSemesterId={data.semester.id}
          activeStartDate={data.semester.start_date}
          totalWeeks={data.semester.total_weeks}
          slots={data.slots}
          reminders={reminders}
          onPatch={patch}
          onChanged={refresh}
          importSignal={settingsImportSignal}
        />
      )}
      {view === 'devices' && (
        <DevicesView
          storage={screenStorage}
          settings={settings}
          persistent={persistent}
          storageKind={storageStatusLabel(STORAGE_LABEL[storage.kind], fallback)}
          onPatch={patch}
          onChanged={refresh}
          onSettingsReplaced={reloadSettings}
        />
      )}
    </div>
  );

  // 桌面侧栏与移动端 Sheet 共用同一份课程详情内容
  const detailPanel =
    detail === null ? null : (
      <LessonDetail
        storage={screenStorage}
        userId={USER_ID}
        cell={detail.cell}
        detail={detail.detail}
        onChanged={refresh}
        onClose={() => setDetail(null)}
        onEditCourse={(id) => {
          if (!guardWrite('编辑课程')) return;
          const managed = data.courses.find((item) => item.id === id) ?? null;
          if (managed === null) {
            toast.error('找不到这门课');
            return;
          }
          setEditingCourse(managed);
          setCourseFormOpen(true);
        }}
        onAdjust={(cell) => openAdjustForLesson(cell, detail.date)}
      />
    );

  return (
    // 外壳钉在视口上，主区自己滚动；不依赖 dvh 重新计算高度。
    <div className="fixed inset-0 flex overflow-hidden bg-page text-ink" data-role="app-shell">
      {isDesktop && (
        <AppSidebar
          current={view}
          onSelect={setView}
          appName="晓刻 DawnTick"
          subtitle={`${data.semester.name} · 第 ${data.week} 周`}
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {fallback && (
          <StorageFallbackBanner
            onRetry={() => void retryStorage()}
            onOpenLogs={() => void exportDiagnosticLogs()}
          />
        )}
        {/* 周次标签给的是窗口起点所在周；上面挂窗口覆盖的日期区间，供自检与读屏 */}
        {view === 'timetable' && (
          <div
            data-role="window-nav"
            data-window-start={data.windowStart}
            data-window-days={data.windowDates.length}
            data-window-range={formatWindowRange(data)}
            data-window-week={data.viewWeek}
            data-window-spans-weeks={data.windowSpansWeeks ? 'true' : 'false'}
            aria-label={`查看窗口 ${formatWindowRange(data)} · 第 ${data.viewWeek} 周`}
          >
            <AppToolbar
              semester={data.semester}
              semesters={[data.semester, ...data.semesters.filter((item) => item.id !== data.semester?.id)]}
              onSelectSemester={(id) => void switchSemester(id)}
              mode={mode}
              onModeChange={setMode}
              week={{
                viewWeek: data.viewWeek,
                currentWeek: data.week,
                canPrev: canPrevWeek,
                canNext: canNextWeek,
                onPrev: () => shiftWindow(-settings.viewDays),
                onNext: () => shiftWindow(settings.viewDays),
              }}
              day={{
                date: viewDay,
                canPrev: canPrevDay,
                canNext: canNextDay,
                onPrev: () => stepDayBy(-1),
                onNext: () => stepDayBy(1),
              }}
              onToday={backToToday}
              onSearch={() => setSearchOpen(true)}
              addActions={addActions}
              compact={!isDesktop}
            />
          </div>
        )}
        {/* 待重启状态只在设置页显示在页内顶部，其余页面统一挂在主壳；两处不重复 */}
        {view !== 'settings' && (
          <div className="empty:hidden px-3 pt-3 desktop:px-4">
            <PendingRestartBar compact />
          </div>
        )}
        <main
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[calc(var(--dt-bottom-nav)+env(safe-area-inset-bottom)+var(--dt-bottom-fab)+var(--spacing-2))] tablet:p-4 tablet:pb-[calc(var(--dt-bottom-nav)+env(safe-area-inset-bottom)+var(--dt-bottom-fab)+var(--spacing-2))] desktop:pb-4"
          data-role="app-main"
          onClick={(event) => {
            // 点主区空白处收起课程详情；卡片、按钮等子元素点击不受影响
            if (event.target === event.currentTarget) setDetail(null);
          }}
        >
          {content}
        </main>
      </div>

      {isDesktop && wideEnoughForSidePanel && detail !== null && (
        <aside className="w-96 shrink-0 overflow-y-auto border-l border-line bg-surface p-4" aria-label="课程详情">
          {detailPanel}
        </aside>
      )}

      {!isDesktop && <BottomNav current={view} onSelect={setView} />}

      {!isDesktop && <AddFab actions={addActions} />}

      <Sheet
        open={detail !== null && !(isDesktop && wideEnoughForSidePanel)}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        side={isDesktop || breakpoint === 'tablet' ? 'right' : 'bottom'}
        title="课程详情"
      >
        {detailPanel}
      </Sheet>

      {/* 全仓唯一的调课弹窗：课程详情与拖拽落点都打开它（日程页自己的入口在 ScheduleView 内） */}
      <AdjustDialog
        open={adjustOpen}
        onOpenChange={(open) => {
          setAdjustOpen(open);
          if (!open) setAdjust(null);
        }}
        storage={screenStorage}
        data={data}
        target={adjust}
        onChanged={refresh}
      />

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        storage={screenStorage}
        semesterId={data.semester.id}
        onPick={(hit) => void pickSearchHit(hit)}
      />

      <CourseForm
        open={courseFormOpen}
        onOpenChange={(open) => {
          setCourseFormOpen(open);
          if (!open) setQuickCreate(null);
        }}
        storage={screenStorage}
        semesterId={data.semester.id}
        semesterStart={data.semester.start_date}
        totalWeeks={data.semester.total_weeks}
        preset={settings.themePreset}
        slots={data.slots}
        onCreated={refresh}
        course={editingCourse}
        presetDraft={quickCreate}
      />

      <TodoForm
        open={todoFormOpen}
        onOpenChange={(open) => {
          setTodoFormOpen(open);
          if (!open) setEditingEvent(null);
        }}
        storage={screenStorage}
        userId={USER_ID}
        semesterId={data.semester.id}
        timeZone={data.timeZone}
        kind={eventFormKind}
        courses={data.courses.map((course) => ({ id: course.id, name: course.name }))}
        slots={data.slots}
        editing={editingEvent}
        onCreated={refresh}
      />

      {/* 渠道提示：开发版可能频繁更新、测试版可能不稳定；每条只弹一次，新增提示对老用户也会弹 */}
      <Dialog
        open={notice !== null}
        onOpenChange={(open) => {
          if (open || notice === null) return;
          void markNoticeSeen(screenStorage, notice);
          const wasBetaNotice = notice === NOTICE_BETA;
          setNotice(null);
          // 切到测试版后自动检查一次更新
          if (wasBetaNotice && settings.autoCheckUpdate) {
            autoChecked.current = false;
            setCheckTick((tick) => tick + 1);
          }
        }}
      >
        <DialogContent
          title={notice === NOTICE_BETA ? '测试版提示' : '开发版提示'}
          description={
            notice === NOTICE_BETA
              ? '测试版可能不稳定，反馈请附日志'
              : '开发版滚动更新'
          }
        >
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                if (notice === null) return;
                void markNoticeSeen(screenStorage, notice);
                setNotice(null);
                openExternalUrl(RELEASES_URL);
              }}
            >
              查看发布页
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (notice === null) return;
                void markNoticeSeen(screenStorage, notice);
                setNotice(null);
              }}
            >
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 发现新版本：显示版本、渠道与发布说明 */}
      <Dialog
        open={updateInfo !== null}
        onOpenChange={(open) => {
          if (!open) setUpdateInfo(null);
        }}
      >
        <DialogContent
          title={`发现新版本 ${updateInfo?.latest ?? ''}`}
          description={`当前 ${appVersion()} · 渠道 ${CHANNEL_LABEL[updateInfo?.manifest?.channel ?? updateInfo?.feed ?? CHANNEL]}`}
        >
          {updateInfo?.manifest?.notes !== undefined && updateInfo.manifest.notes.trim().length > 0 && (
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-muted p-2 text-xs text-ink">
              {updateInfo.manifest.notes}
            </pre>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUpdateInfo(null)}>
              稍后
            </Button>
            <Button variant="primary" onClick={() => openExternalUrl(RELEASES_URL)}>
              去发布页下载
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 远端备份更新：提示下载，下载前先给本机做快照 */}
      <Dialog
        open={remoteNewer !== null}
        onOpenChange={(open) => {
          if (!open) setRemoteNewer(null);
        }}
      >
        <DialogContent
          title="远端有较新的备份"
          description={`${remoteNewer?.name ?? ''}${remoteNewer?.detail == null ? '' : ` · ${remoteNewer.detail}`}；恢复全部将覆盖本机数据（下载前会先备份本机），不可撤销`}
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoteNewer(null)}>
              稍后
            </Button>
            <Button
              variant="secondary"
              aria-label="下载并只应用设置与预设"
              onClick={() => void applyRemote('settings')}
            >
              只应用设置与预设
            </Button>
            <Button variant="danger" aria-label="下载并恢复整库" onClick={() => void applyRemote('all')}>
              恢复全部
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster mode={resolvedMode} />
      <ExternalLinkConfirm />
      <ConfirmDialogHost />
      <BusyOverlay />
    </div>
  );
}
