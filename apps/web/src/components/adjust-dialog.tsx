import { useEffect, useMemo, useState } from 'react';
import { weekOfDate, WEEKDAY_LABELS, type Storage } from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { useAction } from '../lib/action.ts';
import { formatPeriodRange } from '../lib/format.ts';
import { logInfo } from '../log.ts';
import {
  applyCancel,
  applyExam,
  applyExtra,
  applyMove,
  applySwap,
  overlapAt,
  planCancel,
  planExam,
  planExtra,
  planMove,
  planSwap,
  type AdjustMode,
  type AdjustScope,
  type AdjustTarget,
} from '../screens/timetable/move-controller.ts';
import { Button } from './ui/button.tsx';
import { DialogFooter } from './ui/dialog.tsx';
import { EmptyState } from './ui/empty-state.tsx';
import { FormSurface, type FormContainer } from './ui/sheet.tsx';
import { Field, Input } from './ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/controls.tsx';
import { toast } from './ui/toaster.tsx';

export type { AdjustMode, AdjustScope, AdjustTarget } from '../screens/timetable/move-controller.ts';

const USER_ID = 'u1';

const MODE_ITEMS = [
  { id: 'move', label: '改期' },
  { id: 'cancel', label: '停课' },
  { id: 'swap', label: '调休' },
  { id: 'extra', label: '临时加课' },
  { id: 'exam', label: '改为考试' },
] as const;

const SCOPE_ITEMS = [
  { id: 'this', label: '这一次', hint: '只改原日期所在周的这一次课' },
  { id: 'weekly', label: '每周', hint: '直接改课表本身，之后每周都在新时间' },
  { id: 'week', label: '指定周', hint: '把这节课调到一个指定周次' },
  { id: 'date', label: '指定日期', hint: '把这节课调到某一天，可跨周、可换星期' },
] as const;

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

/**
 * 全仓唯一的调课弹窗：改期 / 停课 / 调休 / 临时加课 / 改为考试 五选一。
 * 课程详情、日程卡与拖拽三个入口都打开它，只传预填参数（`target`）；
 * 校验与写库在 `screens/timetable/move-controller.ts`，这里只留表单状态与呈现。
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
  const { busy, run } = useAction();
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

  // 改为考试：日期与节次复用改期那组输入，备注单独一份
  const [examNote, setExamNote] = useState('');

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
      setExamNote('');
      setTargetWeek(String(semester === null ? 1 : weekOfDate(drop?.date ?? target.date, semester.start_date)));
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
    setExamNote('');
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

  /** 计划通过校验后学期一定存在；这里只把类型收窄成字符串。 */
  const semesterId = (): string => (semester === null ? '' : semester.id);

  /** 冲突提示：课程允许重叠，只提醒，不拦截。 */
  function warnOverlap(position: {
    dayOfWeek: number;
    periodStart: number;
    periodEnd: number;
    week: number | null;
  }): void {
    const overlap = overlapAt(data.courses, { ...position, excludeCourseId: courseId });
    if (overlap !== null) {
      toast.info(`调整后与「${overlap.name}」${formatPeriodRange(overlap.start, overlap.end)}重叠，已同时保留`);
    }
  }

  async function submitMove(): Promise<void> {
    const planned = planMove({
      semester,
      schedule,
      scope,
      sourceDate,
      newDate,
      targetWeek,
      periodStart,
      periodEnd,
    });
    if (!planned.ok) {
      toast.error(planned.message);
      return;
    }
    const plan = planned.plan;
    if (plan.scope === 'weekly') {
      const result = await run({
        scope: 'adjust',
        label: '正在改为每周…',
        ok: `已改为每周 ${WEEKDAY_LABELS[plan.dayOfWeek - 1] ?? ''} ${formatPeriodRange(plan.periodStart, plan.periodEnd)}`,
        fail: { what: '改为每周失败', next: '请重试；仍失败请重新打开调课弹窗。' },
        task: () =>
          applyMove(storage, plan, {
            userId: USER_ID,
            semesterId: semesterId(),
            courseName: course?.name ?? '',
            sourceDate,
          }),
      });
      if (!result.ok) return;
      warnOverlap({ dayOfWeek: plan.dayOfWeek, periodStart: plan.periodStart, periodEnd: plan.periodEnd, week: null });
      logInfo('adjust', '已改为每周', { scheduleId: plan.scheduleId, dayOfWeek: plan.dayOfWeek });
      onChanged();
      onOpenChange(false);
      return;
    }
    const result = await run({
      scope: 'adjust',
      label: '正在调课…',
      ok: `已把这一次课调到 ${plan.finalDate} ${formatPeriodRange(plan.periodStart, plan.periodEnd)}`,
      fail: { what: '调课失败', next: '请重试；仍失败请重新打开调课弹窗。' },
      task: () =>
        applyMove(storage, plan, {
          userId: USER_ID,
          semesterId: semesterId(),
          courseName: course?.name ?? '',
          sourceDate,
          room: newRoom.trim().length === 0 ? null : newRoom.trim(),
        }),
    });
    if (!result.ok) return;
    warnOverlap({
      dayOfWeek: plan.dayOfWeek,
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      week: plan.week,
    });
    logInfo('adjust', '已记录调课', {
      scheduleId: plan.scheduleId,
      date: sourceDate,
      newDate: plan.finalDate,
      periods: `${plan.periodStart}-${plan.periodEnd}`,
      scope,
    });
    onChanged();
    onOpenChange(false);
  }

  async function submitCancel(): Promise<void> {
    const planned = planCancel({ semester, schedule, sourceDate });
    if (!planned.ok) {
      toast.error(planned.message);
      return;
    }
    const plan = planned.plan;
    const result = await run({
      scope: 'adjust',
      label: '正在停课…',
      ok: '已记录停课',
      fail: { what: '停课失败', next: '请重试；仍失败请重新打开调课弹窗。' },
      task: () =>
        applyCancel(storage, plan, {
          userId: USER_ID,
          semesterId: semesterId(),
          courseName: course?.name ?? '',
          sourceDate,
        }),
    });
    if (!result.ok) return;
    logInfo('adjust', '已记录停课', { scheduleId: plan.scheduleId, date: sourceDate });
    onChanged();
    onOpenChange(false);
  }

  async function submitExam(): Promise<void> {
    const planned = planExam({
      semester,
      schedule,
      courseId,
      courseName: course?.name ?? '',
      sourceDate,
      date: newDate,
      periodStart,
      periodEnd,
      note: examNote,
      slots: data.slots,
      timeZone: data.timeZone,
    });
    if (!planned.ok) {
      toast.error(planned.message);
      return;
    }
    const examPlan = planned.plan;
    const result = await run({
      scope: 'adjust',
      label: '正在改为考试…',
      ok: `已改为考试：${examPlan.date} ${formatPeriodRange(examPlan.periodStart, examPlan.periodEnd)}`,
      fail: { what: '改为考试失败', next: '请重试；仍失败请重新打开调课弹窗。' },
      task: () => applyExam(storage, examPlan, { userId: USER_ID, semesterId: semesterId() }),
    });
    if (!result.ok) return;
    logInfo('adjust', '已改为考试', {
      scheduleId: examPlan.scheduleId,
      date: examPlan.date,
      periods: `${examPlan.periodStart}-${examPlan.periodEnd}`,
      note: examPlan.note !== null,
    });
    onChanged();
    onOpenChange(false);
  }

  async function submitSwap(): Promise<void> {
    const planned = planSwap({ semester, restFrom, restTo });
    if (!planned.ok) {
      toast.error(planned.message);
      return;
    }
    const swapPlan = planned.plan;
    const result = await run({
      scope: 'adjust',
      label: '正在调休…',
      ok: '已记录调休',
      fail: { what: '调休失败', next: '请重试；仍失败请重新打开调课弹窗。' },
      task: () =>
        applySwap(storage, swapPlan, {
          userId: USER_ID,
          semesterId: semesterId(),
        }),
    });
    if (!result.ok) return;
    logInfo('adjust', '已记录调休', { from: swapPlan.from, to: swapPlan.to });
    onChanged();
    onOpenChange(false);
  }

  async function submitExtra(): Promise<void> {
    const planned = planExtra({
      semester,
      courseId: extraCourse,
      courseName: extraName,
      date: extraDate,
      periodStart: extraPeriodStart,
      periodEnd: extraPeriodEnd,
    });
    if (!planned.ok) {
      toast.error(planned.message);
      return;
    }
    const extraPlan = planned.plan;
    const result = await run({
      scope: 'adjust',
      label: '正在临时加课…',
      ok: `已加课：第 ${extraPlan.week} 周 ${WEEKDAY_LABELS[extraPlan.dayOfWeek - 1] ?? ''}`,
      fail: { what: '临时加课失败', next: '请重试；仍失败请重新打开调课弹窗。' },
      task: () => applyExtra(storage, extraPlan, { semesterId: semesterId() }),
    });
    if (!result.ok) return;
    onChanged();
    onOpenChange(false);
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
          : mode === 'exam'
            ? `把「${course?.name ?? '课程'}」${sourceDate} 的这一次课改成 ${newDate} 的考试，原课次从课表移除`
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

      {(mode === 'move' || mode === 'cancel' || mode === 'exam') && (
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
            <EmptyState size="sm" tone="muted" title="这门课还没有排课，请在课程管理中添加排课" />
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
          <Field
            label="原日期"
            hint={mode === 'exam' ? '这一天的这节课会被移除' : '这一天的那节课次被调整'}
          >
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

      {mode === 'exam' && (
        <div className="flex flex-col gap-3">
          <Field label="考试日期" hint="默认取「调整后日期」，可跨周">
            <Input
              type="date"
              value={newDate}
              aria-label="考试日期"
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
                aria-label="考试起始节"
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
                aria-label="考试结束节"
                value={newEnd}
                onChange={(event) => setNewEnd(event.target.value)}
              />
            </Field>
          </div>
          <Field label="备注（可选）">
            <Input
              value={examNote}
              aria-label="考试备注"
              placeholder="如 开卷、带计算器"
              onChange={(event) => setExamNote(event.target.value)}
            />
          </Field>
          <span className="text-xs text-muted">考试写进日程并开启倒计时，原课次按停课处理</span>
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
          loading={busy}
          disabled={
            semester === null ||
            ((mode === 'move' || mode === 'cancel' || mode === 'exam') && schedule === undefined)
          }
          onClick={() => {
            void (mode === 'move'
              ? submitMove()
              : mode === 'cancel'
                ? submitCancel()
                : mode === 'exam'
                  ? submitExam()
                  : mode === 'swap'
                    ? submitSwap()
                    : submitExtra());
          }}
        >
          {mode === 'cancel' ? '确认停课' : mode === 'exam' ? '改为考试' : '应用调整'}
        </Button>
      </DialogFooter>
    </FormSurface>
  );
}
