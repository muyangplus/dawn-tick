import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  addDays,
  createReschedule,
  dayOfWeek as nextDayOfWeek,
  readSettings,
  isValidTimeZone,
  updateSchedule,
  updateSemester,
  weekOfDate,
  weekStart,
  writeSettings,
  type AppSettings,
  type EventRow,
  type ManagedCourse,
  type SearchHit,
  type Storage,
} from '@dawn-tick/core';
import { AppToolbar } from './components/app-toolbar.tsx';
import { AdjustDialog, type AdjustTarget } from './components/adjust-dialog.tsx';
import { AppSidebar, BottomNav, type NavId } from './components/nav.tsx';
import { LessonDetail } from './components/lesson-detail.tsx';
import { SearchDialog } from './components/search-dialog.tsx';
import { Button } from './components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from './components/ui/dialog.tsx';
import { ExternalLinkConfirm } from './components/ui/external-link.tsx';
import { Field, Input } from './components/ui/input.tsx';
import { Sheet } from './components/ui/sheet.tsx';
import { Toaster, toast } from './components/ui/toaster.tsx';
import { Plus } from 'lucide-react';
import { loadAppData, loadCourseDetail, type AppData, type CourseDetail, type LessonCell } from './data.ts';
import { maybeAutoBackup, createSnapshot, pruneSnapshots } from './backup.ts';
import { downloadAndApply, maybeAutoSync, type ApplyMode } from './webdav.ts';
import { openStorage } from './db/platform.ts';
import { CourseForm, type CourseFormPreset } from './screens/course-form.tsx';
import { LessonDetailOpener } from './screens/cards/schedule-cards.tsx';
import { Onboarding } from './screens/onboarding.tsx';
import { ScheduleView } from './screens/schedule-view.tsx';
import { SettingsView } from './screens/settings-view.tsx';
import { TodayView } from './screens/today-view.tsx';
import { TodoForm } from './screens/todo-form.tsx';
import { WeekView } from './screens/week-view.tsx';
import { applyTheme } from './theme.ts';
import { ensureStartupPermissions, type PermissionReport } from './permissions.ts';
import { attachLogStorage, loadLogs, logDebug, logError, logInfo, logWarn } from './log.ts';
import { applyCachedPreset } from './preset-update.ts';
import { useBreakpoint } from './lib/use-media.ts';
import { useReminders } from './useReminders.ts';
import { checkForUpdate, resolveReceiveBeta, type UpdateStatus } from './update.ts';
import { relaunchApplication } from './storage-config.ts';
import { applyDevFeatures } from './dev-features.ts';
import { applyLogSettings, defaultLogLevel } from './log.ts';
import { openExternalUrl } from './system-actions.ts';
import { CHANNEL, CHANNEL_LABEL, appVersion } from './channel.ts';
import { notifyWidgetWindows, writeWidgetSnapshot } from './widget-snapshot.ts';
import './styles.css';

const USER_ID = 'u1';
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

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

interface MoveState {
  cell: LessonCell;
  dayOfWeek: number;
  period: number;
}

/** 拖动吸附后的四种作用范围（互不重叠）。 */
type MoveTarget =
  | { kind: 'week' }
  | { kind: 'always' }
  | { kind: 'weeks'; week: number }
  | { kind: 'date'; date: string };

function weekDateOf(semester: { start_date: string }, week: number, dayOfWeek: number): string {
  return addDays(weekStart(semester.start_date), (week - 1) * 7 + (dayOfWeek - 1));
}

/** 节次范围文案：单节「第 3 节」，连堂「第 3–4 节」。 */
function formatPeriodLabel(start: number, end: number): string {
  return start >= end ? `第 ${start} 节` : `第 ${start}–${end} 节`;
}

/**
 * 日程时间线里的课次不是周视图的格子，这里按当天的课次还原一张课程卡需要的信息，
 * 让课程详情（含「调课」入口）用同一份数据打开。
 */
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

/**
 * 目标位置已有的课：课程允许重叠，这里只用来给出提醒。
 * week 为 null 表示不限周次（每周生效），否则只看确实在该周上的课。
 */
function overlapAt(
  courses: readonly ManagedCourse[],
  target: {
    dayOfWeek: number;
    period: number;
    span: number;
    week: number | null;
    excludeCourseId: string;
  },
): { name: string; start: number; end: number } | null {
  const start = target.period;
  const end = target.period + target.span;
  for (const course of courses) {
    if (course.id === target.excludeCourseId) continue;
    for (const schedule of course.schedules) {
      if (schedule.dayOfWeek !== target.dayOfWeek) continue;
      if (schedule.periodEnd < start || schedule.periodStart > end) continue;
      if (target.week !== null && !schedule.weeks.includes(target.week)) continue;
      return { name: course.name, start: schedule.periodStart, end: schedule.periodEnd };
    }
  }
  return null;
}

async function withToast(action: () => Promise<void>, ok: string, fail: string): Promise<boolean> {
  try {
    await action();
    toast.success(ok);
    return true;
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    toast.error(`${fail}：${message}`);
    return false;
  }
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
  const seen = await readSeenNotices(storage);
  if (seen.includes(id)) return;
  await storage.writeMeta(SEEN_NOTICES_KEY, JSON.stringify([...seen, id]));
}

export function App() {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<NavId>('timetable');
  const [mode, setMode] = useState<'week' | 'today'>('week');
  const [viewWeek, setViewWeek] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjust, setAdjust] = useState<AdjustTarget | null>(null);
  const [move, setMove] = useState<MoveState | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveWeek, setMoveWeek] = useState(1);
  const [moveDate, setMoveDate] = useState('');
  const [quickCreate, setQuickCreate] = useState<CourseFormPreset | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<ManagedCourse | null>(null);
  const [todoFormOpen, setTodoFormOpen] = useState(false);
  /** 非空表示正在编辑这一条日程：单击时间线里的日程即可进入 */
  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);
  const [eventFormKind, setEventFormKind] = useState<'todo' | 'exam'>('todo');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>('light');
  const [error, setError] = useState<string | null>(null);
  /** 待展示的渠道提示（开发版频繁更新 / 测试版不稳定），按 id 记录已提示过 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 启动权限检查结果：安卓侧展示在设置页「提醒设置」里 */
  const [permissionReport, setPermissionReport] = useState<PermissionReport | null>(null);
  /** 启动权限只申请一次，设置变化不再重复弹系统弹窗 */
  const startupPermissionsDone = useRef(false);
  /** 发现新版本时的更新信息弹窗 */
  const [updateInfo, setUpdateInfo] = useState<UpdateStatus | null>(null);
  /** 递增触发一次额外的自动检查（切到测试版后） */
  const [checkTick, setCheckTick] = useState(0);
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === 'desktop';
  const reminders = useReminders(storage, data?.semester?.id ?? null, data?.timeZone ?? settings.timeZone, {
    enabled: settings.classReminderEnabled,
    minutes: settings.classReminderMinutes,
  });

  const reload = useCallback(
    async (target: Storage | null, current: AppSettings, week?: number | null) => {
      if (target === null) return;
      const next = await loadAppData(target, current, week === undefined || week === null ? {} : { viewWeek: week });
      setData(next);
      setViewWeek(next.viewWeek);
      logInfo('data', '加载课表', {
        week: next.week,
        viewWeek: next.viewWeek,
        lessons: [...next.grid.values()].reduce((total, list) => total + list.length, 0),
        today: next.todayLessons.length,
        todos: next.todos.length,
        exams: next.exams.length,
      });
      await writeWidgetSnapshot(target, next, current);
      await notifyWidgetWindows();
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const opened = await openStorage();
        attachLogStorage(opened);
        await loadLogs();
        // 预设只在启动时套用一次：缓存版本高于内置且正文合法才切换，否则使用内置。
        // 运行时不替换；设置页下载成功后只提示「下次启动生效」。
        // 预设是外部数据，异常缓存退回内置，不阻断启动。
        try {
          const preset = await applyCachedPreset(opened);
          logInfo('preset', '启动套用预设', {
            version: preset.version,
            source: preset.applied ? 'cached' : 'builtin',
            applied: preset.applied,
            ...(preset.reason === undefined ? {} : { reason: preset.reason }),
          });
        } catch (cause: unknown) {
          const message = cause instanceof Error ? cause.message : String(cause);
          logWarn('preset', '启动套用预设失败，继续使用内置预设', { message });
        }
        // 首次启动按系统时区对齐一次；之后完全以用户选择为准（默认上海）
        const aligned = await opened.readMeta(TIME_ZONE_ALIGNED_KEY);
        let loaded = await readSettings(opened);
        if (aligned === undefined || aligned === null || aligned === '') {
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
        if (storedLogLevel === undefined || storedLogLevel === null || storedLogLevel === '') {
          loaded = await writeSettings(opened, { logLevel: defaultLogLevel(CHANNEL) });
          logInfo('settings', '初始化日志级别', { level: loaded.logLevel, channel: CHANNEL });
        }
        if (cancelled) return;
        setStorage(opened);
        setSettings(loaded);
        setResolvedMode(applyTheme(loaded.themePreset, loaded.theme));
        logInfo('storage', '存储就绪', { kind: opened.kind, theme: loaded.themePreset, mode: loaded.theme });
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
        await reload(opened, loaded);
        const manager = globalThis.navigator?.storage;
        if (manager !== undefined && typeof manager.persist === 'function') {
          const granted = await manager.persist();
          if (!cancelled) setPersistent(granted);
          logInfo('storage', '持久化申请', { granted });
        }
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);
        logError('storage', '存储初始化失败', { message });
        if (!cancelled) setError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // 每天一次自动备份与自动同步：应用一直开着时也要能补上当天那次
  useEffect(() => {
    if (storage === null) return;
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
    if (startupPermissionsDone.current) return;
    startupPermissionsDone.current = true;
    void ensureStartupPermissions({ remindersEnabled: settings.classReminderEnabled }).then((report) => {
      setPermissionReport(report);
    });
    // 只在首次挂载时跑一次：权限弹窗不该随设置变化重复弹
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'ArrowLeft') setViewWeek((week) => shiftWeek(week ?? 1, -1));
      else if (event.key === 'ArrowRight') setViewWeek((week) => shiftWeek(week ?? 1, 1));
      else if (event.key === 't' || event.key === 'T') setViewWeek(data?.week ?? 1);
      else if (event.key === '/') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [data?.week]);

  useEffect(() => {
    if (storage === null || viewWeek === null || data === null) return;
    if (viewWeek === data.viewWeek) return;
    void reload(storage, settings, viewWeek);
  }, [viewWeek, data, storage, settings, reload]);

  const patch = useCallback(
    async (partial: Partial<AppSettings>) => {
      if (storage === null) return;
      const next = await writeSettings(storage, partial);
      setSettings(next);
      await reload(storage, next, viewWeek);
    },
    [storage, reload, viewWeek],
  );

  const refresh = useCallback(() => {
    void reload(storage, settings, viewWeek);
  }, [reload, storage, settings, viewWeek]);

  /** 从库外写入设置后（WebDAV 只应用设置与预设）重新读一遍并热加载。 */
  const reloadSettings = useCallback(async (): Promise<void> => {
    if (storage === null) return;
    const next = await readSettings(storage);
    setSettings(next);
    setResolvedMode(applyTheme(next.themePreset, next.theme));
    await reload(storage, next, viewWeek);
  }, [reload, storage, viewWeek]);

  const [remoteNewer, setRemoteNewer] = useState<{ name: string; detail: string | null } | null>(null);
  const [remoteRestartNeeded, setRemoteRestartNeeded] = useState(false);

  /** 远端备份比本机新时的提示：下载前先给本机做快照，避免静默覆盖。 */
  async function applyRemote(mode: ApplyMode): Promise<void> {
    if (storage === null) return;
    const safe = await createSnapshot(storage);
    await pruneSnapshots(storage, settings.backupKeep);
    const result = await downloadAndApply(storage, settings, mode, remoteNewer?.name);
    if (!result.ok) {
      toast.error(`下载失败：${result.error ?? '未知原因'}`);
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
    setRemoteRestartNeeded(true);
    toast.success(`已恢复整库（写入 ${result.outcome?.full?.imported ?? 0} 条），重启后完全生效`);
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

  // 过了截止/结束时间的条目由日程时间线在展示层判定为「已完成」（会自动进「已完成」分组），
  // 这里不再回写 events.done，避免打开应用就改数据。

  /** 课次所在日期：周视图卡片按查看周与该课星期几算出来。 */
  function lessonDateOf(cell: LessonCell): string {
    if (data?.semester != null) return weekDateOf(data.semester, data.viewWeek, cell.dayOfWeek);
    return data?.today ?? '';
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

  /** 详情页的「调课」：以当前这一课次为预设目标，打开课程调整弹窗。 */
  function openAdjustForLesson(cell: LessonCell, date: string): void {
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

  function openMove(cell: LessonCell, dayOfWeek: number, period: number): void {
    if (data === null) return;
    setMove({ cell, dayOfWeek, period });
    // 预填默认值：目标周序号默认当前查看周，指定日期默认拖动落到的日期
    setMoveWeek(data.viewWeek);
    setMoveDate(weekDateOf(data.semester ?? { start_date: data.weekStartDate }, data.viewWeek, dayOfWeek));
  }

  /** 四种作用范围共用的目标校验：夹住节次跨度、算出目标日期、识别空操作。 */
  function resolveMove(
    target: MoveTarget,
  ):
    | { ok: true; date: string; dayOfWeek: number; period: number; span: number }
    | { ok: false; message: string } {
    if (move === null || data?.semester == null) return { ok: false, message: '课程信息已失效' };
    const semester = data.semester;
    const span = move.cell.periodEnd - move.cell.periodStart;
    if (data.slots.length <= span) {
      return { ok: false, message: '本学期的节次数装不下这门连堂课' };
    }
    const period = Math.min(Math.max(1, move.period), data.slots.length - span);
    let date: string;
    let dayOfWeek: number;
    if (target.kind === 'weeks') {
      const wanted = Math.round(target.week);
      if (!Number.isFinite(wanted) || wanted < 1 || wanted > semester.total_weeks) {
        return { ok: false, message: `目标周要在 1–${semester.total_weeks} 周之间` };
      }
      // 跨周调课：目标周的同一个星期几
      date = weekDateOf(semester, wanted, move.cell.dayOfWeek);
      dayOfWeek = move.cell.dayOfWeek;
    } else if (target.kind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(target.date)) return { ok: false, message: '请先选择目标日期' };
      const first = weekStart(semester.start_date);
      const last = addDays(first, semester.total_weeks * 7 - 1);
      if (target.date < first || target.date > last) {
        return { ok: false, message: `目标日期要在学期内（${first} 至 ${last}）` };
      }
      date = target.date;
      dayOfWeek = nextDayOfWeek(target.date);
    } else if (target.kind === 'week') {
      // 本周生效：日期仍是本周该天，只改星期/节次
      date = weekDateOf(semester, data.viewWeek, move.dayOfWeek);
      dayOfWeek = move.dayOfWeek;
    } else {
      // 每周生效：改课表本身，星期取拖动落点所在列
      date = weekDateOf(semester, data.viewWeek, move.dayOfWeek);
      dayOfWeek = move.dayOfWeek;
    }
    if (date === weekDateOf(semester, data.viewWeek, move.cell.dayOfWeek) && period === move.cell.periodStart) {
      return { ok: false, message: '目标位置和现在一样，没有需要调整的' };
    }
    return { ok: true, date, dayOfWeek, period, span };
  }

  async function applyMove(target: MoveTarget): Promise<void> {
    if (storage === null || data?.semester == null || move === null || moveBusy) return;
    const semester = data.semester;
    const resolved = resolveMove(target);
    if (!resolved.ok) {
      toast.error(resolved.message);
      return;
    }
    const { date, dayOfWeek, period, span } = resolved;
    const onDate = weekDateOf(semester, data.viewWeek, move.cell.dayOfWeek);
    const scheduleId = move.cell.scheduleId;
    const where = `${WEEKDAYS[dayOfWeek - 1] ?? ''} ${formatPeriodLabel(period, period + span)}`;
    // 三个「这一次」的作用范围都走 createReschedule，只是 onDate/newDate 不同
    const reschedule = (): Promise<void> =>
      createReschedule(storage, {
        userId: USER_ID,
        semesterId: semester.id,
        refScheduleId: scheduleId,
        onDate,
        action: 'move',
        newDate: date,
        newPeriodStart: period,
        newPeriodEnd: period + span,
        asDayOfWeek: dayOfWeek,
      }).then(() => undefined);
    setMoveBusy(true);
    try {
      if (target.kind === 'always') {
        const done = await withToast(
          () =>
            updateSchedule(storage, scheduleId, {
              day_of_week: dayOfWeek,
              period_start: period,
              period_end: period + span,
            }).then(() => undefined),
          `已改为每周 ${where}`,
          '改为每周失败',
        );
        if (!done) return;
      } else if (target.kind === 'date') {
        const done = await withToast(
          reschedule,
          `已把这一次课调到 ${date} ${formatPeriodLabel(period, period + span)}`,
          '按日期调课失败',
        );
        if (!done) return;
      } else {
        const weeks = target.kind === 'weeks' ? Math.round(target.week) : data.viewWeek;
        const label =
          target.kind === 'week'
            ? `本周的这节课已改到 ${where}`
            : `已把第 ${data.viewWeek} 周的这节课改到第 ${weeks} 周 ${formatPeriodLabel(period, period + span)}`;
        const done = await withToast(reschedule, label, '仅调整这一次失败');
        if (!done) return;
      }
      // 重叠只提醒不阻止：上面已经保存成功
      const overlapWeek =
        target.kind === 'weeks'
          ? Math.round(target.week)
          : target.kind === 'date'
            ? weekOfDate(date, semester.start_date)
            : target.kind === 'always'
              ? null
              : data.viewWeek;
      const overlap = overlapAt(data.courses, {
        dayOfWeek,
        period,
        span,
        week: overlapWeek,
        excludeCourseId: move.cell.courseId,
      });
      if (overlap !== null) {
        toast.info(`调整后与「${overlap.name}」${formatPeriodLabel(overlap.start, overlap.end)}重叠，已同时保留`);
      }
      setMove(null);
      refresh();
    } finally {
      setMoveBusy(false);
    }
  }

  async function switchSemester(id: string): Promise<void> {
    if (storage === null || data === null) return;
    for (const semester of data.semesters) {
      if (semester.id !== id && semester.is_active === 1) {
        await updateSemester(storage, semester.id, { is_active: 0 });
      }
    }
    await updateSemester(storage, id, { is_active: 1 });
    setViewWeek(null);
    refresh();
  }

  function pickSearchHit(hit: SearchHit): void {
    if (hit.kind === 'event') {
      setView('schedule');
      return;
    }
    if (hit.dayOfWeek !== undefined && hit.periodStart !== undefined && hit.courseId !== undefined) {
      const lessons = [...(data?.grid.values() ?? [])].flat();
      const cell = lessons.find(
        (lesson) => lesson.courseId === hit.courseId && lesson.periodStart === hit.periodStart,
      );
      if (cell !== undefined) {
        void openLesson(cell);
        return;
      }
    }
    setView('timetable');
  }

  if (error !== null) {
    return (
      <main className="flex h-full items-start justify-center overflow-y-auto overscroll-contain bg-page p-4">
        <p className="my-auto text-sm text-danger-strong">{error}</p>
      </main>
    );
  }

  if (storage === null || data === null) {
    return (
      <main className="flex h-full items-center justify-center bg-page">
        <p className="text-sm text-muted">载入中</p>
      </main>
    );
  }

  if (data.semester === null) {
    return (
      <>
        <Onboarding
          storage={storage}
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
      </>
    );
  }

  const content = (
    <>
      {view === 'timetable' &&
        (mode === 'week' ? (
          <WeekView
            data={data}
            viewDays={settings.viewDays}
            showOtherWeeks={settings.showOtherWeeks}
            onSelectLesson={(cell) => void openLesson(cell)}
            onMoveLesson={(cell, dayOfWeek, period) => openMove(cell, dayOfWeek, period)}
            onQuickCreate={(preset) => {
              setEditingCourse(null);
              setQuickCreate(preset);
              setCourseFormOpen(true);
            }}
            onPrevWeek={() => setViewWeek((week) => shiftWeek(week ?? data.viewWeek, -1))}
            onNextWeek={() => setViewWeek((week) => shiftWeek(week ?? data.viewWeek, 1))}
          />
        ) : (
          <TodayView data={data} />
        ))}
      {view === 'schedule' && (
        <LessonDetailOpener.Provider value={(target) => void openLessonFromSchedule(target)}>
          <ScheduleView
            data={data}
            storage={storage}
            onChanged={refresh}
            onAddTodo={() => {
              setEditingEvent(null);
              setEventFormKind('todo');
              setTodoFormOpen(true);
            }}
            onAddExam={() => {
              setEditingEvent(null);
              setEventFormKind('exam');
              setTodoFormOpen(true);
            }}
            onOpenEvent={(event) => {
              setEditingEvent(event);
              setTodoFormOpen(true);
            }}
            tomorrowPreview={settings.tomorrowPreview}
            semesterCountdown={settings.semesterCountdown}
            holidayCountdown={settings.holidayCountdown}
          />
        </LessonDetailOpener.Provider>
      )}
      {view === 'settings' && (
        <SettingsView
          storage={storage}
          userId={USER_ID}
          settings={settings}
          semesters={[data.semester, ...data.semesters.filter((item) => item.id !== data.semester?.id)]}
          activeSemesterId={data.semester.id}
          activeStartDate={data.semester.start_date}
          totalWeeks={data.semester.total_weeks}
          slots={data.slots}
          persistent={persistent}
          reminders={reminders}
          storageKind={STORAGE_LABEL[storage.kind]}
          onPatch={patch}
          onChanged={refresh}
          onSettingsReplaced={reloadSettings}
        />
      )}
      {view === 'mine' && (
        <section className="flex flex-col items-center justify-center gap-2 py-16" aria-label="我的">
          <span className="text-base font-semibold text-ink">我的</span>
          <span className="text-sm text-muted">建设中</span>
        </section>
      )}
    </>
  );

  // 桌面侧栏与移动端 Sheet 共用同一份课程详情内容
  const detailPanel =
    detail === null ? null : (
      <LessonDetail
        storage={storage}
        userId={USER_ID}
        cell={detail.cell}
        detail={detail.detail}
        onChanged={refresh}
        onClose={() => setDetail(null)}
        onEditCourse={(id) => {
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
    // 外壳钉在视口上：窗口改尺寸后高度立即跟随，不依赖 dvh 的重新计算，
    // 主区自己滚动，避免「内容比窗口高却滑不到底」。
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
        <AppToolbar
          semester={data.semester}
          semesters={[data.semester, ...data.semesters.filter((item) => item.id !== data.semester?.id)]}
          onSelectSemester={(id) => void switchSemester(id)}
          viewWeek={data.viewWeek}
          currentWeek={data.week}
          onPrevWeek={() => setViewWeek((week) => shiftWeek(week ?? data.viewWeek, -1))}
          onNextWeek={() => setViewWeek((week) => shiftWeek(week ?? data.viewWeek, 1))}
          onToday={() => setViewWeek(data.week)}
          mode={mode}
          onModeChange={setMode}
          onSearch={() => setSearchOpen(true)}
          onAdd={() => {
          setEditingCourse(null);
          setQuickCreate(null);
          setCourseFormOpen(true);
        }}
          compact={!isDesktop}
        />
        <main
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[calc(var(--dt-bottom-nav)+env(safe-area-inset-bottom)+var(--dt-bottom-fab)+var(--spacing-2))] tablet:p-4 tablet:pb-[calc(var(--dt-bottom-nav)+env(safe-area-inset-bottom)+var(--dt-bottom-fab)+var(--spacing-2))] desktop:pb-4"
          data-role="app-main"
        >
          {content}
        </main>
      </div>

      {isDesktop && detail !== null && (
        <aside className="w-96 shrink-0 overflow-y-auto border-l border-line bg-surface p-4" aria-label="课程详情">
          {detailPanel}
        </aside>
      )}

      {!isDesktop && <BottomNav current={view} onSelect={setView} />}

      {!isDesktop && (
        <button
          type="button"
          aria-label="快速添加"
          onClick={() => setAddMenuOpen(true)}
          className="fixed bottom-[calc(var(--dt-bottom-nav)+env(safe-area-inset-bottom)+var(--spacing-2))] right-4 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg"
        >
          <Plus className="size-6" aria-hidden />
        </button>
      )}

      <Sheet
        open={!isDesktop && detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        side={breakpoint === 'tablet' ? 'right' : 'bottom'}
        title="课程详情"
      >
        {detailPanel}
      </Sheet>

      {/* 课程详情里的「调课」入口打开的调整弹窗（日程页自己的入口在 ScheduleView 内） */}
      <AdjustDialog
        open={adjustOpen}
        onOpenChange={(open) => {
          setAdjustOpen(open);
          if (!open) setAdjust(null);
        }}
        storage={storage}
        data={data}
        target={adjust}
        onChanged={refresh}
      />

      <Dialog open={addMenuOpen} onOpenChange={setAddMenuOpen}>
        <DialogContent title="快速添加">
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setAddMenuOpen(false);
                setCourseFormOpen(true);
              }}
            >
              添加课程
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAddMenuOpen(false);
                setTodoFormOpen(true);
              }}
            >
              添加待办
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={move !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMove(null);
            setMoveBusy(false);
          }
        }}
      >
        <DialogContent
          title="调整课程时间"
          description={
            move === null
              ? ''
              : `把「${move.cell.name}」(${formatPeriodLabel(move.cell.periodStart, move.cell.periodEnd)}) 移到 ${
                  WEEKDAYS[move.dayOfWeek - 1] ?? ''
                } ${formatPeriodLabel(move.period, move.period + (move.cell.periodEnd - move.cell.periodStart))}，请选择生效范围`
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2">
              <span className="text-xs text-muted">只改这一周的这一次课</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={moveBusy}
                onClick={() => void applyMove({ kind: 'week' })}
              >
                本周生效
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2">
              <span className="text-xs text-muted">改课表本身，之后每周都在这个时间</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={moveBusy}
                onClick={() => void applyMove({ kind: 'always' })}
              >
                每周生效
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2">
              <Field label="指定周的同一天" hint={`目标周序号 1–${data.semester.total_weeks}`}>
                <Input
                  type="number"
                  min={1}
                  max={data.semester.total_weeks}
                  aria-label="目标周序号"
                  className="w-24"
                  value={moveWeek}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    setMoveWeek(Number.isFinite(parsed) ? parsed : 1);
                  }}
                />
              </Field>
              <Button
                variant="secondary"
                size="sm"
                disabled={moveBusy}
                onClick={() => void applyMove({ kind: 'weeks', week: moveWeek })}
              >
                调到该周
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2">
              <Field label="指定日期" hint="只调这一天，可跨星期">
                <Input
                  type="date"
                  aria-label="目标日期"
                  className="w-40"
                  value={moveDate}
                  onChange={(event) => setMoveDate(event.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                size="sm"
                disabled={moveBusy}
                onClick={() => void applyMove({ kind: 'date', date: moveDate })}
              >
                调到该日期
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setMove(null);
                setMoveBusy(false);
              }}
            >
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        storage={storage}
        semesterId={data.semester.id}
        onPick={pickSearchHit}
      />

      <CourseForm
        open={courseFormOpen}
        onOpenChange={(open) => {
          setCourseFormOpen(open);
          if (!open) setQuickCreate(null);
        }}
        storage={storage}
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
        storage={storage}
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
          if (open || storage === null || notice === null) return;
          void markNoticeSeen(storage, notice);
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
              ? '测试版可能不稳定，功能与数据格式都可能调整；遇到问题请附日志反馈。'
              : '开发版随 dev 分支滚动更新，可能频繁变化；日常使用建议切换到测试版或正式版。'
          }
        >
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                if (storage === null || notice === null) return;
                void markNoticeSeen(storage, notice);
                setNotice(null);
                openExternalUrl(RELEASES_URL);
              }}
            >
              查看发布页
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (storage === null || notice === null) return;
                void markNoticeSeen(storage, notice);
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
          description={`${remoteNewer?.name ?? ''}${remoteNewer?.detail == null ? '' : ` · ${remoteNewer.detail}`}；下载前会先给本机做一份快照`}
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

      <Dialog open={remoteRestartNeeded} onOpenChange={() => setRemoteRestartNeeded(false)}>
        <DialogContent title="已恢复整库" description="重启后完全生效">
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoteRestartNeeded(false)}>
              稍后
            </Button>
            <Button variant="primary" aria-label="立即重启" onClick={() => void relaunchApplication()}>
              立即重启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster mode={resolvedMode} />
      <ExternalLinkConfirm />
    </div>
  );
}

function shiftWeek(week: number, delta: number): number {
  return Math.max(1, week + delta);
}
