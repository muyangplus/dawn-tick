import { useEffect, useMemo, useState } from 'react';
import { WEEKDAY_LABELS, deleteEvent, type Storage } from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { useAction, type ActionApi } from '../lib/action.ts';
import { formatPeriodRange } from '../lib/format.ts';
import { logInfo } from '../log.ts';
import {
  applyCancel,
  applyCancelBatch,
  applyExam,
  applyExtra,
  applyMove,
  applySwap,
  overlapAt,
  planCancel,
  planCancelBatch,
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
import { AdjustCancelFields } from './adjust-dialog/cancel-fields.tsx';
import { confirmAction } from './ui/confirm-dialog.tsx';
import { AdjustExamFields, AdjustExtraFields, AdjustSwapFields } from './adjust-dialog/target-fields.tsx';
import { AdjustFooter } from './adjust-dialog/footer.tsx';
import { adjustCopy } from '../copy/timetable-adjust.ts';

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
    cancelRange,
    cancelTarget,
    cancelTo,
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
  const { busy, run: runAction } = useAction();
  // 修改已有调整：新记录写成功后再删旧记录，写失败时旧记录原样保留
  const replaceEventId = target?.replaceEventId;
  const run: ActionApi['run'] = (spec) =>
    runAction({
      ...spec,
      task: async () => {
        const value = await spec.task();
        if (replaceEventId !== undefined) await deleteEvent(storage, replaceEventId);
        return value;
      },
    });
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
      toast.info(adjustCopy.overlapToast(overlap.name, formatPeriodRange(overlap.start, overlap.end)));
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
        scope: 'timetable',
        label: adjustCopy.weeklyBusy,
        ok: adjustCopy.weeklyDone(WEEKDAY_LABELS[plan.dayOfWeek - 1] ?? '', formatPeriodRange(plan.periodStart, plan.periodEnd)),
        fail: adjustCopy.weeklyFail,
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
      logInfo('timetable', '已改为每周', { scheduleId: plan.scheduleId, dayOfWeek: plan.dayOfWeek });
      onChanged();
      onOpenChange(false);
      return;
    }
    const result = await run({
      scope: 'timetable',
      label: adjustCopy.moveBusy,
      ok: adjustCopy.moveDone(plan.finalDate, formatPeriodRange(plan.periodStart, plan.periodEnd)),
      fail: adjustCopy.moveFail,
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
    logInfo('timetable', '已记录调课', {
      scheduleId: plan.scheduleId,
      date: sourceDate,
      newDate: plan.finalDate,
      periods: `${plan.periodStart}-${plan.periodEnd}`,
      scope,
    });
    onChanged();
    onOpenChange(false);
  }

  async function submitCancelBatch(): Promise<void> {
    const cancelledKeys = new Set(
      data.reschedules
        .filter((row) => row.action === 'cancel' && row.ref_schedule_id !== null && row.on_date !== null)
        .map((row) => `${row.ref_schedule_id}|${row.on_date}`),
    );
    const planned = planCancelBatch({
      semester,
      course,
      schedule,
      range: cancelRange,
      target: cancelTarget,
      from: sourceDate,
      to: cancelTo,
      cancelledKeys,
    });
    if (!planned.ok) {
      toast.error(planned.message);
      return;
    }
    const entries = planned.entries;
    const ok = await confirmAction({
      title: adjustCopy.cancelConfirmTitle,
      description: adjustCopy.cancelConfirmDescription(
        entries.length,
        entries[0]?.date ?? sourceDate,
        entries[entries.length - 1]?.date ?? sourceDate,
      ),
      confirmLabel: adjustCopy.cancelConfirmButton(entries.length),
    });
    if (!ok) return;
    const result = await run({
      scope: 'timetable',
      label: adjustCopy.cancelBusy,
      ok: adjustCopy.cancelBatchDone(entries.length),
      fail: adjustCopy.cancelFail,
      task: () =>
        applyCancelBatch(storage, entries, {
          userId: USER_ID,
          semesterId: semesterId(),
          courseName: course?.name ?? '',
        }),
    });
    if (!result.ok) return;
    logInfo('timetable', '已批量停课', { courseId, range: cancelRange, target: cancelTarget, count: entries.length });
    onChanged();
    onOpenChange(false);
  }

  async function submitCancel(): Promise<void> {
    if (cancelRange !== 'this' || cancelTarget !== 'schedule') {
      await submitCancelBatch();
      return;
    }
    const planned = planCancel({ semester, schedule, sourceDate });
    if (!planned.ok) {
      toast.error(planned.message);
      return;
    }
    const plan = planned.plan;
    const result = await run({
      scope: 'timetable',
      label: adjustCopy.cancelBusy,
      ok: adjustCopy.cancelDone,
      fail: adjustCopy.cancelFail,
      task: () =>
        applyCancel(storage, plan, {
          userId: USER_ID,
          semesterId: semesterId(),
          courseName: course?.name ?? '',
          sourceDate,
        }),
    });
    if (!result.ok) return;
    logInfo('timetable', '已记录停课', { scheduleId: plan.scheduleId, date: sourceDate });
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
      scope: 'timetable',
      label: adjustCopy.examBusy,
      ok: adjustCopy.examDone(examPlan.date, formatPeriodRange(examPlan.periodStart, examPlan.periodEnd)),
      fail: adjustCopy.examFail,
      task: () => applyExam(storage, examPlan, { userId: USER_ID, semesterId: semesterId() }),
    });
    if (!result.ok) return;
    logInfo('timetable', '已改为考试', {
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
      scope: 'timetable',
      label: adjustCopy.swapBusy,
      ok: adjustCopy.swapDone,
      fail: adjustCopy.swapFail,
      task: () =>
        applySwap(storage, swapPlan, {
          userId: USER_ID,
          semesterId: semesterId(),
        }),
    });
    if (!result.ok) return;
    logInfo('timetable', '已记录调休', { from: swapPlan.from, to: swapPlan.to });
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
      scope: 'timetable',
      label: adjustCopy.extraBusy,
      ok: adjustCopy.extraDone(extraPlan.week, WEEKDAY_LABELS[extraPlan.dayOfWeek - 1] ?? ''),
      fail: adjustCopy.extraFail,
      task: () => applyExtra(storage, extraPlan, { semesterId: semesterId() }),
    });
    if (!result.ok) return;
    onChanged();
    onOpenChange(false);
  }

  const moveFromLabel = schedule === undefined ? '' : formatPeriodRange(schedule.periodStart, schedule.periodEnd);
  const moveToLabel = `${newDate} ${formatPeriodRange(periodStart, periodEnd)}`;
  const courseLabel = course?.name ?? adjustCopy.fallbackCourseName;
  const description =
    mode === 'move'
      ? adjustCopy.descriptionMove(courseLabel, moveFromLabel, moveToLabel)
      : mode === 'cancel'
        ? cancelRange === 'from'
          ? adjustCopy.descriptionCancelFrom(courseLabel, sourceDate)
          : cancelRange === 'range'
            ? adjustCopy.descriptionCancelRange(courseLabel, sourceDate, cancelTo)
            : adjustCopy.descriptionCancel(courseLabel, sourceDate)
        : mode === 'swap'
          ? adjustCopy.descriptionSwap
          : mode === 'exam'
            ? adjustCopy.descriptionExam(courseLabel, sourceDate, newDate)
            : adjustCopy.descriptionExtra;

  return (
    <FormSurface
      open={open}
      onOpenChange={onOpenChange}
      container={container}
      title={adjustCopy.title}
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
      {mode === 'cancel' && <AdjustCancelFields form={form} update={update} />}

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
