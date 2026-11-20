import { useEffect, useMemo, useState } from 'react';
import { WEEKDAY_LABELS, type Storage } from '@dawn-tick/core';
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
  type AdjustTarget,
} from '../screens/timetable/move-controller.ts';
import { adjustFormOnOpen, blankAdjustForm, scheduleSelection, type AdjustForm } from '../screens/timetable/adjust-form.ts';
import { FormSurface, type FormContainer } from './ui/sheet.tsx';
import { toast } from './ui/toaster.tsx';
import { AdjustModePicker } from './adjust-dialog/mode-picker.tsx';
import { AdjustSourceFields } from './adjust-dialog/source-fields.tsx';
import { AdjustMoveFields } from './adjust-dialog/move-fields.tsx';
import { AdjustExamFields, AdjustExtraFields, AdjustSwapFields } from './adjust-dialog/target-fields.tsx';
import { AdjustFooter } from './adjust-dialog/footer.tsx';

export type { AdjustMode, AdjustScope, AdjustTarget } from '../screens/timetable/move-controller.ts';

const USER_ID = 'u1';

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
  const [form, setForm] = useState(() => blankAdjustForm(data.today));
  const update = (patch: Partial<AdjustForm>): void => setForm((current) => ({ ...current, ...patch }));
  const {
    mode,
    scope,
    courseId,
    scheduleId,
    sourceDate,
    newDate,
    targetWeek,
    newStart,
    newEnd,
    newRoom,
    restFrom,
    restTo,
    extraCourse,
    extraName,
    extraDate,
    extraStart,
    extraEnd,
    examNote,
  } = form;
  const { busy, run } = useAction();
  const semester = data.semester;

  const course = useMemo(() => data.courses.find((item) => item.id === courseId), [data.courses, courseId]);
  const schedules = course?.schedules ?? [];
  const schedule = useMemo(() => schedules.find((item) => item.id === scheduleId), [schedules, scheduleId]);

  // 每次打开都按入口给的目标重置；刷新导致的 data 变化不清掉正在填的内容
  useEffect(() => {
    if (!open) return;
    update(
      adjustFormOnOpen(target, {
        today: data.today,
        semesterStart: semester?.start_date ?? null,
        firstCourseId: data.courses[0]?.id,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  useEffect(() => {
    const patch = scheduleSelection(schedules, scheduleId);
    if (patch !== null) update(patch);
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
      <AdjustModePicker form={form} update={update} />

      {(mode === 'move' || mode === 'cancel' || mode === 'exam') && (
        <AdjustSourceFields
          form={form}
          update={update}
          data={data}
          course={course}
          schedules={schedules}
          schedule={schedule}
        />
      )}

      {mode === 'move' && <AdjustMoveFields form={form} update={update} data={data} />}

      {mode === 'exam' && <AdjustExamFields form={form} update={update} />}

      {mode === 'swap' && <AdjustSwapFields form={form} update={update} />}

      {mode === 'extra' && <AdjustExtraFields form={form} update={update} data={data} />}

      <AdjustFooter
        mode={mode}
        busy={busy}
        disabled={
          semester === null ||
          ((mode === 'move' || mode === 'cancel' || mode === 'exam') && schedule === undefined)
        }
        onCancel={() => onOpenChange(false)}
        onSubmit={() => {
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
      />
    </FormSurface>
  );
}
