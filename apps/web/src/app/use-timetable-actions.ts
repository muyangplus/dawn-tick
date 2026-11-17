import { useCallback, useMemo, useState } from 'react';
import { maskToWeeks, type EventRow, type ManagedCourse, type Occurrence, type SearchHit } from '@dawn-tick/core';
import type { AddActionHandlers } from '../components/add-menu.tsx';
import type { AdjustTarget } from '../components/adjust-dialog.tsx';
import type { CourseFormPreset } from '../screens/course-form.tsx';
import type { NavId } from '../components/nav.tsx';
import { loadCourseDetail, weekDateOf, type LessonCell } from '../data.ts';
import { logInfo, logWarn } from '../log.ts';
import { toast } from '../components/ui/toaster.tsx';
import { lessonCellOf, type DetailState } from './lesson-cell.ts';
import type { AppSession } from './use-app-session.ts';

/** 事件表单的种类：待办 / 考试 */
export type EventFormKind = 'todo' | 'exam';

/**
 * 课表与日程的交互动作：课程详情、调课弹窗、搜索命中跳转、四个新增动作与各类表单开关。
 *
 * 只发 intent 与开关视图状态；写库都在各自的表单 / 调课控制器里，这里不写库。
 */
export interface TimetableActions {
  detail: DetailState | null;
  closeDetail: () => void;
  adjust: AdjustTarget | null;
  adjustOpen: boolean;
  setAdjustOpen: (open: boolean) => void;
  quickCreate: CourseFormPreset | null;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  scheduleDate: string | null;
  setScheduleDate: (date: string | null) => void;
  focusEventId: string | null;
  setFocusEventId: (id: string | null) => void;
  courseFormOpen: boolean;
  setCourseFormOpen: (open: boolean) => void;
  editingCourse: ManagedCourse | null;
  todoFormOpen: boolean;
  setTodoFormOpen: (open: boolean) => void;
  editingEvent: EventRow | null;
  eventFormKind: EventFormKind;
  /** 课表空态点「导入课表」时递增：设置页收到后自动打开导入抽屉 */
  settingsImportSignal: number;
  /** 切到设置页并让设置页打开导入抽屉 */
  openImport: () => void;
  /** 周视图空白格拖动松手：带着预填范围打开课程表单 */
  openQuickCreate: (preset: CourseFormPreset) => void;
  addActions: AddActionHandlers;
  openLesson: (cell: LessonCell) => Promise<void>;
  openLessonFromSchedule: (target: AdjustTarget) => Promise<void>;
  openLessonFromDay: (lesson: Occurrence) => void;
  openAdjustForLesson: (cell: LessonCell, date: string) => void;
  openAdjustForDrop: (cell: LessonCell, date: string, period: number) => void;
  /** 打开某条日程的详情编辑 */
  openEvent: (event: EventRow) => void;
  /** 详情里的「编辑课程」：按课程 id 打开课程表单 */
  openCourseById: (id: string) => void;
  /** 搜索命中：日程翻到命中日期并高亮那一行；排课按命中周翻窗后打开课程详情 */
  pickSearchHit: (hit: SearchHit) => Promise<void>;
}

export function useTimetableActions(input: {
  session: AppSession;
  /** 切页：搜索命中与「导入课表」会换页 */
  onNavigate: (view: NavId) => void;
}): TimetableActions {
  const { session, onNavigate } = input;
  const { storage, data, settings, guardWrite, reload, setMode } = session;

  const [detail, setDetail] = useState<DetailState | null>(null);
  const [adjustOpen, setAdjustOpenState] = useState(false);
  const [adjust, setAdjust] = useState<AdjustTarget | null>(null);
  const [quickCreate, setQuickCreate] = useState<CourseFormPreset | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  /** 日程页查看的日期：由 App 持有，搜索命中某条日程时可以直接定位到那一天 */
  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  /** 搜索命中的日程条目 id：日程时间线滚动到该行并高亮 */
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
  const [courseFormOpen, setCourseFormOpenState] = useState(false);
  const [editingCourse, setEditingCourse] = useState<ManagedCourse | null>(null);
  const [todoFormOpen, setTodoFormOpenState] = useState(false);
  /** 非空表示正在编辑这一条日程：单击时间线里的日程即可进入 */
  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);
  const [eventFormKind, setEventFormKind] = useState<EventFormKind>('todo');
  const [settingsImportSignal, setSettingsImportSignal] = useState(0);

  const closeDetail = useCallback(() => setDetail(null), []);

  /** 调课弹窗开关：关掉时清掉预设目标 */
  const setAdjustOpen = useCallback((open: boolean) => {
    setAdjustOpenState(open);
    if (!open) setAdjust(null);
  }, []);

  /** 课程表单开关：关掉时清掉拖动入口带来的预设 */
  const setCourseFormOpen = useCallback((open: boolean) => {
    setCourseFormOpenState(open);
    if (!open) setQuickCreate(null);
  }, []);

  /** 日程表单开关：关掉时清掉正在编辑的条目 */
  const setTodoFormOpen = useCallback((open: boolean) => {
    setTodoFormOpenState(open);
    if (!open) setEditingEvent(null);
  }, []);

  const openImport = useCallback(() => {
    onNavigate('settings');
    setSettingsImportSignal((value) => value + 1);
  }, [onNavigate]);

  /** 拖动入口的加课：预填节次与周次后打开课程表单 */
  const openQuickCreate = useCallback(
    (preset: CourseFormPreset): void => {
      if (!guardWrite('新建课程')) return;
      setEditingCourse(null);
      setQuickCreate(preset);
      setCourseFormOpenState(true);
    },
    [guardWrite],
  );

  /** 课次所在日期：网格里的格子自带日期，直接用它。 */
  const lessonDateOf = useCallback(
    (cell: LessonCell): string => (cell.date === '' ? data?.today ?? '' : cell.date),
    [data],
  );

  const openLesson = useCallback(
    async (cell: LessonCell): Promise<void> => {
      if (storage === null) return;
      // 实验格没有课程行：直接进这条实验的详情编辑，而不是去找不存在的课程
      if (cell.eventId !== undefined) {
        const lab = data?.labs.find((row) => row.id === cell.eventId);
        if (lab !== undefined) {
          logInfo('timetable', '打开实验详情', { id: lab.id, title: lab.title });
          setEditingEvent(lab);
          setTodoFormOpenState(true);
          return;
        }
        logWarn('timetable', '实验条目不存在', { id: cell.eventId });
      }
      const loaded = await loadCourseDetail(storage, cell.courseId);
      setDetail({ cell, detail: loaded, date: lessonDateOf(cell) });
    },
    [storage, data, lessonDateOf],
  );

  /** 日程时间线里点课程：按当天课次还原课程卡，再打开同一份课程详情。 */
  const openLessonFromSchedule = useCallback(
    async (target: AdjustTarget): Promise<void> => {
      if (storage === null || data === null) return;
      const loaded = await loadCourseDetail(storage, target.courseId);
      setDetail({ cell: lessonCellOf(data, target), detail: loaded, date: target.date });
    },
    [storage, data],
  );

  /** 日视图里点课程行：课次不是网格格，按当天课次还原课程卡后走同一个 openLesson。 */
  const openLessonFromDay = useCallback(
    (lesson: Occurrence): void => {
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
    },
    [data, openLesson],
  );

  /** 详情页的「调课」：以当前这一课次为预设目标，打开调课弹窗。 */
  const openAdjustForLesson = useCallback(
    (cell: LessonCell, date: string): void => {
      if (!guardWrite('调课')) return;
      setAdjust({
        scheduleId: cell.scheduleId,
        courseId: cell.courseId,
        courseName: data?.courses.find((course) => course.id === cell.courseId)?.name ?? cell.name,
        date,
        periodStart: cell.periodStart,
        periodEnd: cell.periodEnd,
      });
      setAdjustOpenState(true);
    },
    [guardWrite, data],
  );

  /** 拖拽入口：落点是某天某个节次，预填进同一个调课弹窗，不再另开一个「调整课程时间」。 */
  const openAdjustForDrop = useCallback(
    (cell: LessonCell, date: string, period: number): void => {
      setAdjust({
        scheduleId: cell.scheduleId,
        courseId: cell.courseId,
        courseName: data?.courses.find((course) => course.id === cell.courseId)?.name ?? cell.name,
        date: cell.date,
        periodStart: cell.periodStart,
        periodEnd: cell.periodEnd,
        drop: { date, periodStart: period },
      });
      setAdjustOpenState(true);
    },
    [data],
  );

  const openEvent = useCallback(
    (event: EventRow): void => {
      if (!guardWrite('编辑日程')) return;
      setEditingEvent(event);
      setTodoFormOpenState(true);
    },
    [guardWrite],
  );

  const openCourseById = useCallback(
    (id: string): void => {
      if (!guardWrite('编辑课程')) return;
      const managed = data?.courses.find((item) => item.id === id) ?? null;
      if (managed === null) {
        toast.error('找不到这门课');
        return;
      }
      setEditingCourse(managed);
      setCourseFormOpenState(true);
    },
    [guardWrite, data],
  );

  /** 四个新增动作的唯一实现：工具栏下拉、移动 FAB 与日程页「添加」菜单都调到同一份。 */
  const addActions = useMemo<AddActionHandlers>(
    () => ({
      course: () => {
        if (!guardWrite('新建课程')) return;
        setEditingCourse(null);
        setQuickCreate(null);
        setCourseFormOpenState(true);
      },
      todo: () => {
        if (!guardWrite('添加待办')) return;
        setEditingEvent(null);
        setEventFormKind('todo');
        setTodoFormOpenState(true);
      },
      exam: () => {
        if (!guardWrite('添加考试')) return;
        setEditingEvent(null);
        setEventFormKind('exam');
        setTodoFormOpenState(true);
      },
      import: openImport,
    }),
    [guardWrite, openImport],
  );

  /** 打开某条排课在指定日期的详情：优先用网格里的那一格，落不到网格时按当天课次还原课程卡。 */
  const openHitLesson = useCallback(
    async (source: NonNullable<AppSession['data']>, scheduleId: string, date: string): Promise<void> => {
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
    },
    [storage, openLesson],
  );

  const pickSearchHit = useCallback(
    async (hit: SearchHit): Promise<void> => {
      if (storage === null || data === null) return;
      if (hit.kind === 'event') {
        setFocusEventId(hit.id);
        // 未排期的条目没有日期：保持当前日期，不做无意义的跳转
        if (hit.date !== undefined) setScheduleDate(hit.date);
        onNavigate('schedule');
        return;
      }
      const semester = data.semester;
      if (hit.kind !== 'schedule' || semester === null || hit.dayOfWeek === undefined) {
        onNavigate('timetable');
        return;
      }
      // 命中周：本周在排课范围内就停在本周，否则落到这条排课的第一个周次
      const weeks = hit.weeksMask === undefined ? [] : maskToWeeks(hit.weeksMask, semester.total_weeks);
      const week = weeks.includes(data.week) ? data.week : (weeks[0] ?? data.viewWeek);
      const date = weekDateOf(semester, week, hit.dayOfWeek);
      const start = weekDateOf(semester, week, 1);
      setMode('week');
      onNavigate('timetable');
      if (start !== data.windowStart) {
        const next = await reload(storage, settings, start);
        if (next === undefined) return;
        setFocusEventId(null);
        await openHitLesson(next, hit.id, date);
        return;
      }
      setFocusEventId(null);
      await openHitLesson(data, hit.id, date);
    },
    [storage, data, settings, reload, setMode, onNavigate, openHitLesson],
  );

  return {
    detail,
    closeDetail,
    adjust,
    adjustOpen,
    setAdjustOpen,
    quickCreate,
    searchOpen,
    setSearchOpen,
    scheduleDate,
    setScheduleDate,
    focusEventId,
    setFocusEventId,
    courseFormOpen,
    setCourseFormOpen,
    editingCourse,
    todoFormOpen,
    setTodoFormOpen,
    editingEvent,
    eventFormKind,
    settingsImportSignal,
    openImport,
    openQuickCreate,
    addActions,
    openLesson,
    openLessonFromSchedule,
    openLessonFromDay,
    openAdjustForLesson,
    openAdjustForDrop,
    openEvent,
    openCourseById,
    pickSearchHit,
  };
}
