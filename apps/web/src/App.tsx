import { useEffect, useRef, useState } from 'react';
import type { Storage } from '@dawn-tick/core';
import { AddActionsProvider, AddFab } from './components/add-menu.tsx';
import { ScheduleFocusContext } from './components/schedule-focus.ts';
import { AdjustDialog } from './components/adjust-dialog.tsx';
import { AppToolbar } from './components/app-toolbar.tsx';
import { AppSidebar, BottomNav, type NavId } from './components/nav.tsx';
import { LessonDetail } from './components/lesson-detail.tsx';
import { SearchDialog } from './components/search-dialog.tsx';
import { BusyOverlay } from './components/ui/busy-overlay.tsx';
import { PendingRestartBar } from './components/pending-restart-bar.tsx';
import { ExternalLinkConfirm } from './components/ui/external-link.tsx';
import { ConfirmDialogHost } from './components/ui/confirm-dialog.tsx';
import { Sheet, type FormContainer } from './components/ui/sheet.tsx';
import { Toaster } from './components/ui/toaster.tsx';
import { clampDayDate, dayRangeOf, defaultDayDate, stepDay, stepWindow } from './lib/day-nav.ts';
import { useBreakpoint, useMediaQuery } from './lib/use-media.ts';
import { CourseForm } from './screens/course-form.tsx';
import { LessonDetailOpener } from './screens/cards/schedule-cards.tsx';
import { Onboarding } from './screens/onboarding.tsx';
import { ScheduleView } from './screens/schedule-view.tsx';
import { DevicesView } from './screens/devices-view.tsx';
import { SettingsView } from './screens/settings-view.tsx';
import { TodayView } from './screens/today-view.tsx';
import { TodoForm } from './screens/todo-form.tsx';
import { WeekView } from './screens/week-view.tsx';
import { storageStatusLabel } from './storage-config.ts';
import { formatWindowRange } from './app/lesson-cell.ts';
import { NoticeDialog, RemoteNewerDialog, UpdateDialog } from './components/app-dialogs.tsx';
import { ErrorScreen, LoadingScreen, StorageFallbackBanner } from './components/app-screens.tsx';
import { useAppSession } from './app/use-app-session.ts';
import { useAppEffects } from './app/use-app-effects.ts';
import { useTimetableActions } from './app/use-timetable-actions.ts';
import { useRecoveryActions } from './app/use-recovery.ts';
import './styles.css';

// 冒烟测试与外部入口沿用 App.tsx 的导出：加载页的阈值与组件仍是同一份实现
export { LOADING_SLOW_MS, LoadingScreen, ErrorScreen, StorageFallbackBanner } from './components/app-screens.tsx';

const USER_ID = 'u1';

const STORAGE_LABEL: Record<Storage['kind'], string> = {
  indexeddb: '浏览器 IndexedDB',
  sqlite: '原生 SQLite',
  memory: '内存（测试）',
};

/**
 * 应用壳：只做壳——启动、路由、窗口与弹窗挂载。
 *
 * - 数据与导航状态在 `useAppSession`，视图动作在 `useTimetableActions`；
 * - 启动编排在 `app/bootstrap.ts`，只读弹窗在 `components/app-dialogs.tsx`；
 * - 出错时的恢复动作在 `useRecoveryActions`。
 */
export function App() {
  const session = useAppSession();
  const { storage, settings, data } = session;
  const [view, setView] = useState<NavId>('timetable');
  const actions = useTimetableActions({ session, onNavigate: setView });
  const effects = useAppEffects({ storage, screenStorage: session.uiStorage, settings, data });
  const recovery = useRecoveryActions({ fallback: session.fallback });
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === 'desktop';
  /** 高频短表单的容器：与底部导航同口径，非桌面（手机/平板）用底部 Sheet，桌面仍是居中 Dialog */
  const formContainer: FormContainer = isDesktop ? 'dialog' : 'sheet';
  /** ≥1440 才把课程详情并排成第三栏；1024–1439 用右侧覆盖层，避免把课表列宽压到不可读 */
  const wideEnoughForSidePanel = useMediaQuery('(min-width: 1440px)');
  /** 课表页的日模式：←/→ 翻一天，顶部换日期翻页 */
  const dayMode = view === 'timetable' && session.mode === 'today';
  /** 上一屏是不是日程页：用于离开日程时把查看日期收回今天 */
  const leftSchedule = useRef(false);

  useEffect(() => {
    // 切页时收起课程详情：桌面侧栏不跨页常驻
    actions.closeDetail();
    // 离开日程页回到今天：再进日程默认看今天（搜索命中是从别的页直接带着日期进来，不受影响）
    if (leftSchedule.current && view !== 'schedule') {
      actions.setScheduleDate(null);
      actions.setFocusEventId(null);
    }
    leftSchedule.current = view === 'schedule';
    // 只在切页时动：动作对象每次渲染都会重建，不能进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (event.key === 'Escape' && actions.detail !== null) actions.closeDetail();
        return;
      }
      if (event.key === 'Escape' && actions.detail !== null) {
        actions.closeDetail();
        return;
      }
      // 日模式 ←/→ 翻一天；周模式平移一屏（设置里的天数）。T 回到今天
      if (event.key === 'ArrowLeft') {
        if (dayMode) session.stepDayBy(-1);
        else session.shiftWindow(-settings.viewDays);
      } else if (event.key === 'ArrowRight') {
        if (dayMode) session.stepDayBy(1);
        else session.shiftWindow(settings.viewDays);
      } else if (event.key === 't' || event.key === 'T') session.backToToday();
      else if (event.key === '/') {
        event.preventDefault();
        actions.setSearchOpen(true);
      }
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [
    settings.viewDays,
    dayMode,
    // 这些命令都是 useCallback 化的稳定引用：翻页能力变了才重装监听
    session.stepDayBy,
    session.shiftWindow,
    session.backToToday,
    actions.detail,
    actions.closeDetail,
    actions.setSearchOpen,
  ]);

  if (session.error !== null) {
    return (
      <ErrorScreen
        kind={session.error.kind}
        failure={session.error.failure}
        onRetry={session.retryBoot}
        onRestore={() => void recovery.restoreFromBackup()}
        onOpenBackupDir={() => void recovery.openBackupDirectory()}
        onOpenLogs={() => void recovery.exportDiagnosticLogs()}
      />
    );
  }

  if (storage === null || data === null) {
    return <LoadingScreen />;
  }

  /** 存储就绪后各屏共用：回退时是只读包装，写操作会统一被拒绝 */
  const screenStorage = session.uiStorage ?? storage;

  if (data.semester === null) {
    const fallbackBanner = session.fallback ? (
      <StorageFallbackBanner
        onRetry={() => void recovery.retryStorage()}
        onOpenLogs={() => void recovery.exportDiagnosticLogs()}
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
              await session.reload(storage, settings, null);
              setView('timetable');
            })();
          }}
        />
        <Toaster mode={session.resolvedMode} />
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
  const viewDay = clampDayDate(session.dayDate ?? defaultDayDate(data.today, settings.hideWeekends), dayRange);
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
        (session.mode === 'week' ? (
          <WeekView
            data={data}
            showOtherWeeks={settings.showOtherWeeks}
            compact={!isDesktop}
            onImport={actions.openImport}
            onSelectLesson={(cell) => void actions.openLesson(cell)}
            onMoveLesson={(cell, date, period) => actions.openAdjustForDrop(cell, date, period)}
            onQuickCreate={actions.openQuickCreate}
            onPrevWindow={() => session.shiftWindow(-settings.viewDays)}
            onNextWindow={() => session.shiftWindow(settings.viewDays)}
          />
        ) : (
          <TodayView
            data={data}
            date={viewDay}
            isToday={viewDay === data.today}
            onOpenWeek={() => session.setMode('week')}
            onSelectLesson={actions.openLessonFromDay}
          />
        ))}
      {view === 'schedule' && (
        <AddActionsProvider actions={actions.addActions}>
          <LessonDetailOpener.Provider value={(target) => void actions.openLessonFromSchedule(target)}>
            <ScheduleFocusContext.Provider value={actions.focusEventId}>
              <ScheduleView
                data={data}
                storage={screenStorage}
                onChanged={session.refresh}
                viewDate={actions.scheduleDate ?? data.today}
                onViewDateChange={(date) => {
                  actions.setScheduleDate(date);
                  actions.setFocusEventId(null);
                }}
                onAddTodo={actions.addActions.todo}
                onAddExam={actions.addActions.exam}
                onOpenEvent={actions.openEvent}
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
          reminders={session.reminders}
          onPatch={session.patch}
          onChanged={session.refresh}
          importSignal={actions.settingsImportSignal}
        />
      )}
      {view === 'devices' && (
        <DevicesView
          storage={screenStorage}
          settings={settings}
          persistent={session.persistent}
          storageKind={storageStatusLabel(STORAGE_LABEL[storage.kind], session.fallback)}
          onPatch={session.patch}
          onChanged={session.refresh}
          onSettingsReplaced={session.reloadSettings}
        />
      )}
    </div>
  );

  // 桌面侧栏与移动端 Sheet 共用同一份课程详情内容
  const detail = actions.detail;
  const detailPanel =
    detail === null ? null : (
      <LessonDetail
        storage={screenStorage}
        userId={USER_ID}
        cell={detail.cell}
        detail={detail.detail}
        onChanged={session.refresh}
        onClose={actions.closeDetail}
        onEditCourse={actions.openCourseById}
        onAdjust={(cell) => actions.openAdjustForLesson(cell, detail.date)}
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
        {session.fallback && (
          <StorageFallbackBanner
            onRetry={() => void recovery.retryStorage()}
            onOpenLogs={() => void recovery.exportDiagnosticLogs()}
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
              onSelectSemester={(id) => void session.switchSemester(id)}
              mode={session.mode}
              onModeChange={session.setMode}
              week={{
                viewWeek: data.viewWeek,
                currentWeek: data.week,
                canPrev: canPrevWeek,
                canNext: canNextWeek,
                onPrev: () => session.shiftWindow(-settings.viewDays),
                onNext: () => session.shiftWindow(settings.viewDays),
              }}
              day={{
                date: viewDay,
                canPrev: canPrevDay,
                canNext: canNextDay,
                onPrev: () => session.stepDayBy(-1),
                onNext: () => session.stepDayBy(1),
              }}
              onToday={session.backToToday}
              onSearch={() => actions.setSearchOpen(true)}
              addActions={actions.addActions}
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
            if (event.target === event.currentTarget) actions.closeDetail();
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

      {!isDesktop && <AddFab actions={actions.addActions} />}

      <Sheet
        open={detail !== null && !(isDesktop && wideEnoughForSidePanel)}
        onOpenChange={(open) => {
          if (!open) actions.closeDetail();
        }}
        side={isDesktop || breakpoint === 'tablet' ? 'right' : 'bottom'}
        title="课程详情"
      >
        {detailPanel}
      </Sheet>

      {/* 全仓唯一的调课弹窗：课程详情与拖拽落点都打开它（日程页自己的入口在 ScheduleView 内） */}
      <AdjustDialog
        open={actions.adjustOpen}
        onOpenChange={actions.setAdjustOpen}
        storage={screenStorage}
        data={data}
        target={actions.adjust}
        onChanged={session.refresh}
        container={formContainer}
      />

      <SearchDialog
        open={actions.searchOpen}
        onOpenChange={actions.setSearchOpen}
        storage={screenStorage}
        semesterId={data.semester.id}
        onPick={(hit) => void actions.pickSearchHit(hit)}
      />

      <CourseForm
        open={actions.courseFormOpen}
        onOpenChange={actions.setCourseFormOpen}
        storage={screenStorage}
        semesterId={data.semester.id}
        semesterStart={data.semester.start_date}
        totalWeeks={data.semester.total_weeks}
        preset={settings.themePreset}
        slots={data.slots}
        onCreated={session.refresh}
        course={actions.editingCourse}
        presetDraft={actions.quickCreate}
        container={formContainer}
      />

      <TodoForm
        open={actions.todoFormOpen}
        onOpenChange={actions.setTodoFormOpen}
        storage={screenStorage}
        userId={USER_ID}
        semesterId={data.semester.id}
        timeZone={data.timeZone}
        kind={actions.eventFormKind}
        courses={data.courses.map((course) => ({ id: course.id, name: course.name }))}
        slots={data.slots}
        editing={actions.editingEvent}
        onCreated={session.refresh}
        container={formContainer}
      />

      {/* 三个只读弹窗：渠道提示、发现新版本、远端有较新的备份 */}
      <NoticeDialog notice={effects.notice} onDismiss={effects.dismissNotice} />
      <UpdateDialog info={effects.updateInfo} onClose={effects.closeUpdate} />
      <RemoteNewerDialog
        info={session.remoteNewer}
        onClose={() => session.setRemoteNewer(null)}
        onApply={(mode) => void session.applyRemote(mode)}
      />

      <Toaster mode={session.resolvedMode} />
      <ExternalLinkConfirm />
      <ConfirmDialogHost />
      <BusyOverlay />
    </div>
  );
}
