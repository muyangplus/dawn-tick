import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  createReschedule,
  readSettings,
  updateSchedule,
  updateEvent,
  updateSemester,
  writeSettings,
  type AppSettings,
  type ManagedCourse,
  type SearchHit,
  type Storage,
} from '@dawn-tick/core';
import { AppToolbar } from './components/app-toolbar.tsx';
import { AppSidebar, BottomNav, type NavId } from './components/nav.tsx';
import { LessonDetail } from './components/lesson-detail.tsx';
import { SearchDialog } from './components/search-dialog.tsx';
import { Button } from './components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from './components/ui/dialog.tsx';
import { Sheet } from './components/ui/sheet.tsx';
import { Toaster, toast } from './components/ui/toaster.tsx';
import { Plus } from 'lucide-react';
import { loadAppData, loadCourseDetail, weekDateOf, type AppData, type CourseDetail, type LessonCell } from './data.ts';
import { openStorage } from './db/platform.ts';
import { CourseForm } from './screens/course-form.tsx';
import { ImportFlow } from './screens/import-flow.tsx';
import { Onboarding } from './screens/onboarding.tsx';
import { ScheduleView } from './screens/schedule-view.tsx';
import { SettingsView } from './screens/settings-view.tsx';
import { TodayView } from './screens/today-view.tsx';
import { TodoForm } from './screens/todo-form.tsx';
import { WeekView } from './screens/week-view.tsx';
import { applyTheme } from './theme.ts';
import { attachLogStorage, loadLogs, logDebug, logError, logInfo } from './log.ts';
import { useBreakpoint } from './lib/use-media.ts';
import { useReminders } from './useReminders.ts';
import { writeWidgetSnapshot } from './widget-snapshot.ts';
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
}

interface MoveState {
  cell: LessonCell;
  dayOfWeek: number;
  period: number;
}

export function App() {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<NavId>('timetable');
  const [mode, setMode] = useState<'week' | 'today'>('week');
  const [viewWeek, setViewWeek] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [move, setMove] = useState<MoveState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<ManagedCourse | null>(null);
  const [todoFormOpen, setTodoFormOpen] = useState(false);
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
  useEffect(() => {
    if (data === null || storage === null) return;
    const now = Date.now();
    const stale = data.todos.filter(
      (row) => row.done === 0 && row.due_at !== null && row.due_at !== undefined && row.due_at < now,
    );
    if (stale.length === 0) return;
    void (async () => {
      for (const row of stale) await updateEvent(storage, row.id, { done: 1 });
      refresh();
    })();
  }, [data, storage, refresh]);

  async function openLesson(cell: LessonCell): Promise<void> {
    if (storage === null) return;
    const loaded = await loadCourseDetail(storage, cell.courseId);
    setDetail({ cell, detail: loaded });
  }

  async function applyMove(target: 'week' | 'always'): Promise<void> {
    if (storage === null || data?.semester == null || move === null) return;
    const semester = data.semester;
    const span = move.cell.periodEnd - move.cell.periodStart;
    if (target === 'always') {
      await updateSchedule(storage, move.cell.scheduleId, {
        day_of_week: move.dayOfWeek,
        period_start: move.period,
        period_end: move.period + span,
      });
      toast.success('已改为每周该时间');
    } else {
      await createReschedule(storage, {
        userId: USER_ID,
        semesterId: semester.id,
        refScheduleId: move.cell.scheduleId,
        onDate: weekDateOf(semester, data.viewWeek, move.cell.dayOfWeek),
        action: 'move',
        newDate: weekDateOf(semester, data.viewWeek, move.dayOfWeek),
        newPeriodStart: move.period,
        newPeriodEnd: move.period + span,
        asDayOfWeek: move.dayOfWeek,
      });
      toast.success('已仅调整本周');
    }
    setMove(null);
    refresh();
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
            onMoveLesson={(cell, dayOfWeek, period) => setMove({ cell, dayOfWeek, period })}
            onPrevWeek={() => setViewWeek((week) => shiftWeek(week ?? data.viewWeek, -1))}
            onNextWeek={() => setViewWeek((week) => shiftWeek(week ?? data.viewWeek, 1))}
          />
        ) : (
          <TodayView data={data} />
        ))}
      {view === 'schedule' && (
        <ScheduleView
          data={data}
          storage={storage}
          onChanged={refresh}
          onAddTodo={() => {
            setEventFormKind('todo');
            setTodoFormOpen(true);
          }}
          onAddExam={() => {
            setEventFormKind('exam');
            setTodoFormOpen(true);
          }}
          tomorrowPreview={settings.tomorrowPreview}
          semesterCountdown={settings.semesterCountdown}
          holidayCountdown={settings.holidayCountdown}
        />
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
          onAdd={() => setCourseFormOpen(true)}
          compact={!isDesktop}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-24 tablet:p-4 desktop:pb-4">
          {content}
        </main>
      </div>

      {isDesktop && detail !== null && (
        <aside className="w-96 shrink-0 overflow-y-auto border-l border-line bg-surface p-4" aria-label="课程详情">
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
          />
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
        {detail !== null && (
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
          />
        )}
      </Sheet>

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
          if (!open) setMove(null);
        }}
      >
        <DialogContent
          title="调整课程时间"
          description={
            move === null
              ? ''
              : `把「${move.cell.name}」移到 ${WEEKDAYS[move.dayOfWeek - 1]} 第 ${move.period} 节`
          }
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMove(null)}>
              取消
            </Button>
            <Button variant="secondary" onClick={() => void applyMove('week')}>
              仅本周
            </Button>
            <Button variant="primary" onClick={() => void applyMove('always')}>
              从本周起每周
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
        onOpenChange={setCourseFormOpen}
        storage={storage}
        semesterId={data.semester.id}
        semesterStart={data.semester.start_date}
        totalWeeks={data.semester.total_weeks}
        preset={settings.themePreset}
        slots={data.slots}
        onCreated={refresh}
        course={editingCourse}
      />

      <TodoForm
        open={todoFormOpen}
        onOpenChange={setTodoFormOpen}
        storage={storage}
        userId={USER_ID}
        semesterId={data.semester.id}
        timeZone={data.timeZone}
        kind={eventFormKind}
        courses={data.courses.map((course) => ({ id: course.id, name: course.name }))}
        onCreated={refresh}
      />

      <Toaster mode={resolvedMode} />
    </div>
  );
}

function shiftWeek(week: number, delta: number): number {
  return Math.max(1, week + delta);
}
