import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  createCourse,
  createEvent,
  createReschedule,
  createSchedule,
  dayOfWeek,
  rangesOverlap,
  updateSchedule,
  weekOfDate,
  weekStart,
  WEEKDAY_LABELS,
  weeksIntersect,
  type ManagedCourse,
  type Storage,
} from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { weekDateOf } from '../data.ts';
import { fail } from '../lib/fail.ts';
import { formatPeriodRange } from '../lib/format.ts';
import { logError, logInfo } from '../log.ts';
import { Button } from './ui/button.tsx';
import { DialogFooter } from './ui/dialog.tsx';
import { FormSurface, type FormContainer } from './ui/sheet.tsx';
import { Field, Input } from './ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/controls.tsx';
import { toast } from './ui/toaster.tsx';

const USER_ID = 'u1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 调课弹窗的四个主操作。 */
export type AdjustMode = 'move' | 'cancel' | 'swap' | 'extra';

/** 改期的四种生效范围。 */
type AdjustScope = 'this' | 'weekly' | 'week' | 'date';

const MODE_ITEMS = [
  { id: 'move', label: '改期' },
  { id: 'cancel', label: '停课' },
  { id: 'swap', label: '调休' },
  { id: 'extra', label: '临时加课' },
] as const;

const SCOPE_ITEMS = [
  { id: 'this', label: '这一次', hint: '只改原日期所在周的这一次课' },
  { id: 'weekly', label: '每周', hint: '直接改课表本身，之后每周都在新时间' },
  { id: 'week', label: '指定周', hint: '把这节课调到一个指定周次' },
  { id: 'date', label: '指定日期', hint: '把这节课调到某一天，可跨周、可换星期' },
] as const;

export interface AdjustTarget {
  scheduleId: string;
  courseId: string;
  courseName: string;
  /** 原日期，YYYY-MM-DD */
  date: string;
  periodStart: number;
  periodEnd: number;
  /** 拖动入口的落点：目标日期与目标起始节，打开时预填进「改期」 */
  drop?: { date: string; periodStart: number } | undefined;
  /** 入口预选的主操作，缺省为「改期」 */
  mode?: AdjustMode | undefined;
}

export interface AdjustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
  data: AppData;
  /** 从某节课点进来时的预设目标 */
  target: AdjustTarget | null;
  onChanged: () => void;
  /** 容器形态由挂载处按断点决定：移动端底部 Sheet，桌面端居中 Dialog */
  container?: FormContainer;
}

/** 目标位置已有的课：课程允许重叠，只用来提醒；week 为 null 表示不限周次（每周生效）。 */
function overlapAt(
  courses: readonly ManagedCourse[],
  target: {
    dayOfWeek: number;
    periodStart: number;
    periodEnd: number;
    week: number | null;
    excludeCourseId: string;
  },
): { name: string; start: number; end: number } | null {
  for (const course of courses) {
    if (course.id === target.excludeCourseId) continue;
    for (const schedule of course.schedules) {
      if (schedule.dayOfWeek !== target.dayOfWeek) continue;
      if (!rangesOverlap(schedule.periodStart, schedule.periodEnd, target.periodStart, target.periodEnd)) continue;
      if (target.week !== null && !weeksIntersect(schedule.weeks, [target.week])) continue;
      return { name: course.name, start: schedule.periodStart, end: schedule.periodEnd };
    }
  }
  return null;
}

async function withToast(
  action: () => Promise<void>,
  ok: string,
  what: string,
  next = '请重试；仍失败请重新打开调课弹窗。',
): Promise<boolean> {
  try {
    await action();
    toast.success(ok);
    return true;
  } catch (cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    logError('adjust', what, { message: reason });
    toast.error(fail(what, reason, next).text);
    return false;
  }
}

/**
 * 全仓唯一的调课弹窗：改期 / 停课 / 调休 / 临时加课四选一。
 * 课程详情、日程卡与拖拽三个入口都打开它，只传预填参数（`target`）。
 */
export function AdjustDialog({
  open,
  onOpenChange,
  storage,
  data,
  target,
  onChanged,
  container = 'dialog',
}: AdjustDialogProps) {
  const [mode, setMode] = useState<AdjustMode>('move');
  const [scope, setScope] = useState<AdjustScope>('this');
  const [busy, setBusy] = useState(false);
  const semester = data.semester;

  // 改期 / 停课共用
  const [courseId, setCourseId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [sourceDate, setSourceDate] = useState(data.today);

  // 改期
  const [newDate, setNewDate] = useState(data.today);
  const [targetWeek, setTargetWeek] = useState('1');
  const [newStart, setNewStart] = useState('1');
  const [newEnd, setNewEnd] = useState('2');
  const [newRoom, setNewRoom] = useState('');

  // 调休：把原日期课表整体搬到目标上课日
  const [restFrom, setRestFrom] = useState(data.today);
  const [restTo, setRestTo] = useState(data.today);

  // 临时加课
  const [extraCourse, setExtraCourse] = useState('');
  const [extraName, setExtraName] = useState('');
  const [extraDate, setExtraDate] = useState(data.today);
  const [extraStart, setExtraStart] = useState('1');
  const [extraEnd, setExtraEnd] = useState('2');

  const course = useMemo(() => data.courses.find((item) => item.id === courseId), [data.courses, courseId]);
  const schedules = course?.schedules ?? [];
  const schedule = useMemo(() => schedules.find((item) => item.id === scheduleId), [schedules, scheduleId]);

  // 每次打开都按入口给的目标重置：三个入口只传预填参数，弹窗内部不记忆上一次
  useEffect(() => {
    if (!open) return;
    if (target !== null) {
      const drop = target.drop;
      setMode(target.mode ?? 'move');
      setCourseId(target.courseId);
      setScheduleId(target.scheduleId);
      setSourceDate(target.date);
      setNewDate(drop?.date ?? target.date);
      setNewStart(String(drop?.periodStart ?? target.periodStart));
      setNewEnd(
        String(drop === undefined ? target.periodEnd : drop.periodStart + (target.periodEnd - target.periodStart)),
      );
      setNewRoom('');
      setTargetWeek(
        String(semester === null ? 1 : weekOfDate(drop?.date ?? target.date, semester.start_date)),
      );
      // 落点在原日期同一周就按「这一次」，跨周默认「指定日期」
      const sameWeek =
        drop === undefined ||
        semester === null ||
        weekOfDate(drop.date, semester.start_date) === weekOfDate(target.date, semester.start_date);
      setScope(sameWeek ? 'this' : 'date');
      return;
    }
    setMode('move');
    setScope('this');
    setSourceDate(data.today);
    setNewDate(data.today);
    setNewStart('1');
    setNewEnd('2');
    setNewRoom('');
    setTargetWeek(String(semester === null ? 1 : weekOfDate(data.today, semester.start_date)));
    setExtraDate(data.today);
    if (data.courses.length > 0) setCourseId(data.courses[0]?.id ?? '');
    // 只在打开或换目标时重置：刷新导致的 data 变化不应清掉用户正在填的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  useEffect(() => {
    if (schedules.length === 0) {
      setScheduleId('');
      return;
    }
    if (!schedules.some((item) => item.id === scheduleId)) {
      const first = schedules[0];
      setScheduleId(first?.id ?? '');
      if (first !== undefined) {
        setNewStart(String(first.periodStart));
        setNewEnd(String(first.periodEnd));
      }
    }
  }, [schedules, scheduleId]);

  const periodStart = Number(newStart);
  const periodEnd = Number(newEnd);
  const extraPeriodStart = Number(extraStart);
  const extraPeriodEnd = Number(extraEnd);

  function periodsValid(start: number, end: number): boolean {
    return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start;
  }

  /** 学期内日期校验，返回错误文案或 null。 */
  function dateError(date: string, label: string): string | null {
    if (semester === null) return '还没有学期';
    if (!DATE_RE.test(date)) return `请先选择${label}`;
    const first = weekStart(semester.start_date);
    const last = addDays(first, semester.total_weeks * 7 - 1);
    if (date < first || date > last) return `${label}要在学期内（${first} 至 ${last}）`;
    return null;
  }

  async function submitMove(): Promise<void> {
    if (semester === null || schedule === undefined) {
      toast.error('请先选课程与要调整的课次');
      return;
    }
    if (!periodsValid(periodStart, periodEnd)) {
      toast.error('节次需要是 1 起、且结束不小于开始');
      return;
    }
    const sourceError = dateError(sourceDate, '原日期');
    if (sourceError !== null) {
      toast.error(sourceError);
      return;
    }
    const targetError = dateError(newDate, '调整后日期');
    if (targetError !== null) {
      toast.error(targetError);
      return;
    }
    const targetDay = dayOfWeek(newDate);
    const semesterId = semester.id;
    // 每周：直接改课表本身，不再记一次调课
    if (scope === 'weekly') {
      if (
        targetDay === schedule.dayOfWeek &&
        periodStart === schedule.periodStart &&
        periodEnd === schedule.periodEnd
      ) {
        toast.error('目标位置和现在一样，没有需要调整的');
        return;
      }
      setBusy(true);
      try {
        const done = await withToast(
          () =>
            updateSchedule(storage, schedule.id, {
              day_of_week: targetDay,
              period_start: periodStart,
              period_end: periodEnd,
            }).then(() => undefined),
          `已改为每周 ${WEEKDAY_LABELS[targetDay - 1] ?? ''} ${formatPeriodRange(periodStart, periodEnd)}`,
          '改为每周失败',
        );
        if (!done) return;
        const overlap = overlapAt(data.courses, {
          dayOfWeek: targetDay,
          periodStart,
          periodEnd,
          week: null,
          excludeCourseId: courseId,
        });
        if (overlap !== null) {
          toast.info(`调整后与「${overlap.name}」${formatPeriodRange(overlap.start, overlap.end)}重叠，已同时保留`);
        }
        logInfo('adjust', '已改为每周', { scheduleId: schedule.id, dayOfWeek: targetDay });
        onChanged();
        onOpenChange(false);
      } finally {
        setBusy(false);
      }
      return;
    }

    // 这一次 / 指定周 / 指定日期：都只改原日期这一次课
    let finalDate = newDate;
    if (scope === 'week') {
      const wanted = Number(targetWeek);
      if (!Number.isInteger(wanted) || wanted < 1 || wanted > semester.total_weeks) {
        toast.error(`目标周要在 1–${semester.total_weeks} 周之间`);
        return;
      }
      finalDate = weekDateOf(semester, wanted, targetDay);
      const first = weekStart(semester.start_date);
      const last = addDays(first, semester.total_weeks * 7 - 1);
      if (finalDate < first || finalDate > last) {
        toast.error(`目标周超出学期范围（${first} 至 ${last}）`);
        return;
      }
    }
    const sameWeek = weekOfDate(finalDate, semester.start_date) === weekOfDate(sourceDate, semester.start_date);
    if (scope === 'this' && !sameWeek) {
      toast.error('「这一次」只改本周；跨周改用「指定日期」');
      return;
    }
    if (finalDate === sourceDate && periodStart === schedule.periodStart && periodEnd === schedule.periodEnd) {
      toast.error('目标位置和现在一样，没有需要调整的');
      return;
    }
    setBusy(true);
    try {
      const done = await withToast(
        () =>
          createReschedule(storage, {
            userId: USER_ID,
            semesterId,
            refScheduleId: schedule.id,
            onDate: sourceDate,
            action: 'move',
            title: `调课：${course?.name ?? ''}`,
            newDate: finalDate,
            newPeriodStart: periodStart,
            newPeriodEnd: periodEnd,
            newRoom: newRoom.trim().length === 0 ? null : newRoom.trim(),
            asDayOfWeek: dayOfWeek(finalDate),
          }).then(() => undefined),
        `已把这一次课调到 ${finalDate} ${formatPeriodRange(periodStart, periodEnd)}`,
        '调课失败',
      );
      if (!done) return;
      const overlap = overlapAt(data.courses, {
        dayOfWeek: dayOfWeek(finalDate),
        periodStart,
        periodEnd,
        week: weekOfDate(finalDate, semester.start_date),
        excludeCourseId: courseId,
      });
      if (overlap !== null) {
        toast.info(`调整后与「${overlap.name}」${formatPeriodRange(overlap.start, overlap.end)}重叠，已同时保留`);
      }
      logInfo('adjust', '已记录调课', {
        scheduleId: schedule.id,
        date: sourceDate,
        newDate: finalDate,
        periods: `${periodStart}-${periodEnd}`,
        scope,
      });
      onChanged();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitCancel(): Promise<void> {
    if (semester === null || schedule === undefined) {
      toast.error('请先选课程与要停的课次');
      return;
    }
    const sourceError = dateError(sourceDate, '原日期');
    if (sourceError !== null) {
      toast.error(sourceError);
      return;
    }
    setBusy(true);
    try {
      const done = await withToast(
        () =>
          createReschedule(storage, {
            userId: USER_ID,
            semesterId: semester.id,
            refScheduleId: schedule.id,
            onDate: sourceDate,
            action: 'cancel',
            title: `停课：${course?.name ?? ''}`,
          }).then(() => undefined),
        '已记录停课',
        '停课失败',
      );
      if (!done) return;
      logInfo('adjust', '已记录停课', { scheduleId: schedule.id, date: sourceDate });
      onChanged();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitSwap(): Promise<void> {
    if (semester === null) return;
    const fromError = dateError(restFrom, '原日期课表');
    if (fromError !== null) {
      toast.error(fromError);
      return;
    }
    const toError = dateError(restTo, '目标上课日');
    if (toError !== null) {
      toast.error(toError);
      return;
    }
    setBusy(true);
    try {
      const done = await withToast(
        () =>
          createEvent(storage, {
            userId: USER_ID,
            semesterId: semester.id,
            type: 'makeup',
            title: `${restFrom} 的课表调到 ${restTo}`,
            onDate: restTo,
            asDayOfWeek: dayOfWeek(restFrom),
          }).then(() => undefined),
        '已记录调休',
        '调休失败',
      );
      if (!done) return;
      logInfo('adjust', '已记录调休', { from: restFrom, to: restTo });
      onChanged();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitExtra(): Promise<void> {
    if (semester === null) return;
    if (extraCourse === '' && extraName.trim().length === 0) {
      toast.error('请选择课程或填写课程名称');
      return;
    }
    if (!periodsValid(extraPeriodStart, extraPeriodEnd)) {
      toast.error('节次需要是 1 起、且结束不小于开始');
      return;
    }
    const extraError = dateError(extraDate, '加课日期');
    if (extraError !== null) {
      toast.error(extraError);
      return;
    }
    setBusy(true);
    try {
      let targetCourseId = extraCourse;
      if (extraName.trim().length > 0) {
        const created = await createCourse(storage, {
          semesterId: semester.id,
          name: extraName.trim(),
          shortName: extraName.trim().slice(0, 4),
        });
        targetCourseId = String(created['id']);
      }
      const week = weekOfDate(extraDate, semester.start_date);
      await createSchedule(storage, {
        courseId: targetCourseId,
        dayOfWeek: dayOfWeek(extraDate),
        periodStart: extraPeriodStart,
        periodEnd: extraPeriodEnd,
        weeks: [week],
      });
      toast.success(`已加课：第 ${week} 周 ${WEEKDAY_LABELS[dayOfWeek(extraDate) - 1] ?? ''}`);
      onChanged();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const scopeItem = SCOPE_ITEMS.find((item) => item.id === scope) ?? SCOPE_ITEMS[0];
  const newDateHint =
    scope === 'weekly'
      ? '用它所在的星期几作为每周上课日'
      : scope === 'week'
        ? '用它所在的星期几落在「目标周」'
        : scope === 'this'
          ? '与原日期同一周内'
          : '可跨周、可换星期';
  const moveFromLabel = schedule === undefined ? '' : formatPeriodRange(schedule.periodStart, schedule.periodEnd);
  const moveToLabel = `${newDate} ${formatPeriodRange(periodStart, periodEnd)}`;
  const description =
    mode === 'move'
      ? `把「${course?.name ?? '课程'}」${moveFromLabel}调整为 ${moveToLabel}`
      : mode === 'cancel'
        ? `停掉「${course?.name ?? '课程'}」${sourceDate} 的这一次课，其他周次不受影响`
        : mode === 'swap'
          ? '把原日期那天的课表整体搬到目标上课日'
          : '只加这一次，可在课程管理里删除';

  return (
    <FormSurface
      open={open}
      onOpenChange={onOpenChange}
      container={container}
      title="调课"
      description={description}
      contentAttrs={{
        'data-role': 'adjust-dialog',
        'data-mode': mode,
        'data-scope': mode === 'move' ? scope : 'none',
      }}
    >
      <div className="flex flex-wrap gap-1" role="group" aria-label="调课操作" data-role="adjust-modes">
        {MODE_ITEMS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={mode === item.id ? 'primary' : 'secondary'}
            aria-pressed={mode === item.id}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {(mode === 'move' || mode === 'cancel') && (
        <div className="flex flex-col gap-3">
          <Field label="课程">
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger aria-label="课程">{course?.name ?? '选择课程'}</SelectTrigger>
              <SelectContent>
                {data.courses.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {schedules.length === 0 ? (
            <span className="text-sm text-muted">这门课还没有排课，请在课程管理中添加排课</span>
          ) : (
            <Field label="课次">
              <Select value={scheduleId} onValueChange={setScheduleId}>
                <SelectTrigger aria-label="课次">
                  {schedule === undefined
                    ? '选择课次'
                    : `${WEEKDAY_LABELS[schedule.dayOfWeek - 1] ?? ''} ${formatPeriodRange(
                        schedule.periodStart,
                        schedule.periodEnd,
                      )}`}
                </SelectTrigger>
                <SelectContent>
                  {schedules.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {`${WEEKDAY_LABELS[item.dayOfWeek - 1] ?? ''} ${formatPeriodRange(item.periodStart, item.periodEnd)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="原日期" hint="这一天的那节课次被调整">
            <Input
              type="date"
              value={sourceDate}
              aria-label="原日期"
              onChange={(event) => setSourceDate(event.target.value)}
            />
          </Field>
        </div>
      )}

      {mode === 'move' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1" role="group" aria-label="生效范围" data-role="adjust-scopes">
            <div className="flex flex-wrap gap-1">
              {SCOPE_ITEMS.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={scope === item.id ? 'primary' : 'secondary'}
                  aria-pressed={scope === item.id}
                  onClick={() => setScope(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted">{scopeItem.hint}</span>
          </div>
          {scope === 'week' && (
            <Field label="目标周" hint={`第几周 · 1–${data.semester?.total_weeks ?? 1}`}>
              <Input
                type="number"
                min={1}
                max={data.semester?.total_weeks ?? 1}
                aria-label="目标周"
                className="w-24"
                value={targetWeek}
                onChange={(event) => setTargetWeek(event.target.value)}
              />
            </Field>
          )}
          <Field label="调整后日期" hint={newDateHint}>
            <Input
              type="date"
              value={newDate}
              aria-label="调整后日期"
              onChange={(event) => setNewDate(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Field label="起始节">
              <Input
                type="number"
                min={1}
                max={40}
                className="w-20"
                aria-label="起始节"
                value={newStart}
                onChange={(event) => setNewStart(event.target.value)}
              />
            </Field>
            <Field label="结束节">
              <Input
                type="number"
                min={1}
                max={40}
                className="w-20"
                aria-label="结束节"
                value={newEnd}
                onChange={(event) => setNewEnd(event.target.value)}
              />
            </Field>
            {scope !== 'weekly' && (
              <Field label="教室（可选）">
                <Input
                  value={newRoom}
                  aria-label="教室（可选）"
                  onChange={(event) => setNewRoom(event.target.value)}
                />
              </Field>
            )}
          </div>
        </div>
      )}

      {mode === 'swap' && (
        <div className="flex flex-col gap-3">
          <Field label="原日期课表">
            <Input
              type="date"
              value={restFrom}
              aria-label="原日期课表"
              onChange={(event) => setRestFrom(event.target.value)}
            />
          </Field>
          <Field label="目标上课日" hint="原日课表整体搬过来" help="调休后，目标日按原日课表上课">
            <Input
              type="date"
              value={restTo}
              aria-label="目标上课日"
              onChange={(event) => setRestTo(event.target.value)}
            />
          </Field>
        </div>
      )}

      {mode === 'extra' && (
        <div className="flex flex-col gap-3">
          <Field label="已有课程">
            <Select value={extraCourse} onValueChange={setExtraCourse}>
              <SelectTrigger aria-label="已有课程">
                {data.courses.find((item) => item.id === extraCourse)?.name ?? '选择课程'}
              </SelectTrigger>
              <SelectContent>
                {data.courses.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="或自定义课程名称" hint="填了就按这个名字新建一门课">
            <Input
              value={extraName}
              aria-label="或自定义课程名称"
              placeholder="如 形势与政策（补课）"
              onChange={(event) => setExtraName(event.target.value)}
            />
          </Field>
          <Field label="加课日期">
            <Input
              type="date"
              value={extraDate}
              aria-label="加课日期"
              onChange={(event) => setExtraDate(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Field label="起始节">
              <Input
                type="number"
                min={1}
                max={40}
                className="w-20"
                aria-label="起始节"
                value={extraStart}
                onChange={(event) => setExtraStart(event.target.value)}
              />
            </Field>
            <Field label="结束节">
              <Input
                type="number"
                min={1}
                max={40}
                className="w-20"
                aria-label="结束节"
                value={extraEnd}
                onChange={(event) => setExtraEnd(event.target.value)}
              />
            </Field>
          </div>
          <span className="text-xs text-muted">只加这一次，可在课程管理里删除</span>
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          variant="primary"
          disabled={busy || semester === null || ((mode === 'move' || mode === 'cancel') && schedule === undefined)}
          onClick={() => {
            void (mode === 'move'
              ? submitMove()
              : mode === 'cancel'
                ? submitCancel()
                : mode === 'swap'
                  ? submitSwap()
                  : submitExtra());
          }}
        >
          {mode === 'cancel' ? '确认停课' : '应用调整'}
        </Button>
      </DialogFooter>
    </FormSurface>
  );
}
