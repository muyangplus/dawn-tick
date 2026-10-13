import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  addDays,
  createReschedule,
  dayOfWeek as nextDayOfWeek,
  readSettings,
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
import { openStorage } from './db/platform.ts';
import { CourseForm, type CourseFormPreset } from './screens/course-form.tsx';
import { LessonDetailOpener } from './screens/cards/schedule-cards.tsx';
import { ImportFlow } from './screens/import-flow.tsx';
import { Onboarding } from './screens/onboarding.tsx';
import { ScheduleView } from './screens/schedule-view.tsx';
import { SettingsView } from './screens/settings-view.tsx';
import { TodayView } from './screens/today-view.tsx';
import { TodoForm } from './screens/todo-form.tsx';
import { WeekView } from './screens/week-view.tsx';
import { applyTheme } from './theme.ts';
import { attachLogStorage, loadLogs, logDebug, logError, logInfo, logWarn } from './log.ts';
import { applyCachedPreset } from './preset-update.ts';
import { useBreakpoint } from './lib/use-media.ts';
import { useReminders } from './useReminders.ts';
import { checkForUpdate, resolveReceiveBeta } from './update.ts';
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
        const loaded = await readSettings(opened);
        if (cancelled) return;
        setStorage(opened);
        setSettings(loaded);
        setResolvedMode(applyTheme(loaded.themePreset, loaded.theme));
        logInfo('storage', '存储就绪', { kind: opened.kind, theme: loaded.themePreset, mode: loaded.theme });
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

  // 启动时按设置检查一次更新，只提示不下载；「自动检查版本更新」关闭时跳过
  const autoChecked = useRef(false);
  useEffect(() => {
    if (autoChecked.current || !settings.autoCheckUpdate) return;
    autoChecked.current = true;
    let cancelled = false;
    void (async () => {
      const status = await checkForUpdate({
        channel: CHANNEL,
        receiveBeta: resolveReceiveBeta(settings.receiveBeta, CHANNEL),
        currentVersion: appVersion(),
      });
      if (cancelled || !status.available) return;
      toast.success(`发现新版本 ${status.latest}（${CHANNEL_LABEL[status.feed]}），可在设置 → 更新与维护里查看`);
    })();
    return () => {
      cancelled = true;
    };
    // 设置就绪后只检查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoCheckUpdate]);

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
      <main className="flex min-h-dvh items-center justify-center bg-page p-4">
        <p className="text-sm text-danger-strong">{error}</p>
      </main>
    );
  }

  if (storage === null || data === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-page">
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
      {view === 'import' && (
        <ImportFlow
          storage={storage}
          semesterId={data.semester.id}
          onManual={() => {
            setView('timetable');
            setCourseFormOpen(true);
          }}
          onDone={refresh}
          onClose={() => setView('timetable')}
        />
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
        />
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
    <div className="flex h-dvh overflow-hidden bg-page text-ink">
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
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-24 tablet:p-4 desktop:pb-4">
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
          className="fixed bottom-20 right-4 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg"
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

      <Toaster mode={resolvedMode} />
      <ExternalLinkConfirm />
    </div>
  );
}

function shiftWeek(week: number, delta: number): number {
  return Math.max(1, week + delta);
}
