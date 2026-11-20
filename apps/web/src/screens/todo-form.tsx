import { useEffect, useState } from 'react';
import {
  createEvent,
  dateWallClockToEpoch,
  deleteEvent,
  formatDate,
  MAX_PERIODS,
  periodsForClockRange,
  updateEvent,
  weeksToMask,
  type EventRow,
  type SemesterRow,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { logDebug, logError, logInfo } from '../log.ts';
import { useBusyAction } from '../lib/busy.ts';
import { errorMessage } from '../lib/errors.ts';
import { confirmAction } from '../components/ui/confirm-dialog.tsx';
import { DELETE } from '../copy/zh.ts';
import { FormSurface, type FormContainer } from '../components/ui/sheet.tsx';
import { toast } from '../components/ui/toaster.tsx';
import {
  advanceIdFor,
  advanceMinutesOf,
  blankTodoForm,
  eventTypeFor,
  kindDefaults,
  loadEventAdvance,
  syncEventReminder,
  todoFormForCreate,
  todoFormFromEvent,
  type EventFormKind,
  type TodoFormState,
} from './todo-form-model.ts';
import { KIND_LABEL } from './todo-form/section-props.ts';
import { TodoBasicFields } from './todo-form/basic-fields.tsx';
import { TodoTimeFields } from './todo-form/time-fields.tsx';
import { TodoLabFields } from './todo-form/lab-fields.tsx';
import { TodoDetailFields } from './todo-form/detail-fields.tsx';
import { TodoFooter } from './todo-form/footer.tsx';

/** 待办类型：日程 / 作业 / 考试 / 实验。 */
export type { EventFormKind } from './todo-form-model.ts';

export interface TodoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
  userId: string;
  semesterId: string;
  timeZone: string;
  /** 预设类型；打开时可在表单里改 */
  kind?: EventFormKind;
  semester?: SemesterRow | null;
  /** 供日程与实验关联课程 */
  courses?: ReadonlyArray<{ id: string; name: string }>;
  /** 节次表：自定义时间时按重叠关系回填节次 */
  slots?: readonly TimeSlotRow[];
  /** 传入即进入详情编辑：字段按该条回填，保存写回同一条 */
  editing?: EventRow | null;
  onCreated: () => void;
  /** 容器形态由挂载处按断点决定：移动端底部 Sheet，桌面端居中 Dialog */
  container?: FormContainer;
}

/** 节次输入取整到 1..MAX_PERIODS，非法时用兜底值。 */
function toPeriod(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_PERIODS, Math.max(1, Math.round(parsed)));
}

export function TodoForm({
  open,
  onOpenChange,
  storage,
  userId,
  semesterId,
  timeZone,
  kind = 'todo',
  semester = null,
  courses = [],
  slots = [],
  editing = null,
  onCreated,
  container = 'dialog',
}: TodoFormProps) {
  const [form, setForm] = useState(() => blankTodoForm(kind, formatDate(Date.now(), timeZone)));
  const update = (patch: Partial<TodoFormState>): void => setForm((previous) => ({ ...previous, ...patch }));
  const {
    kind: current,
    title,
    courseId,
    dueDate,
    dueTime,
    advance,
    location,
    seatNo,
    note,
    labRepeat,
    labWeekday,
    labPeriodStart,
    labPeriodEnd,
    labWeeks,
    customTime,
    startTime,
    endTime,
    showInTimetable,
  } = form;
  const switches = { countdown: form.countdown, manualDone: form.manualDone };
  /** 保存/删除/复制共用一份提交态：busy 期间按钮转圈、重复触发被忽略 */
  const { busy, run } = useBusyAction();

  const isExam = current === 'exam';
  const isLab = current === 'lab';
  const isHomework = current === 'homework';

  /** 每次打开都回到调用方指定的类型与默认开关；编辑时按该条回填，避免沿用上一次的选择。 */
  useEffect(() => {
    if (!open) return;
    if (editing === null) {
      update(todoFormForCreate(kind));
      return;
    }
    setForm(todoFormFromEvent(editing, { timeZone, totalWeeks: semester?.total_weeks ?? null, now: Date.now() }));
    let cancelled = false;
    void loadEventAdvance(storage, editing.id).then((minutes) => {
      if (!cancelled) update({ advance: advanceIdFor(minutes) });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, editing]);

  /** 切换类型时把开关恢复成该类型的默认值。 */
  function changeKind(next: EventFormKind): void {
    update(kindDefaults(next));
  }

  /** 提交入口：先过一遍空标题守卫，再进统一的 busy/蒙版保护。 */
  async function submit(): Promise<void> {
    if (title.trim().length === 0) return;
    await run(`正在保存${KIND_LABEL[current]}…`, saveTodo);
  }

  async function saveTodo(): Promise<void> {
    try {
      const at = customTime
        ? dateWallClockToEpoch(dueDate, startTime, timeZone)
        : dateWallClockToEpoch(dueDate, dueTime, timeZone);
      const endAt = customTime ? dateWallClockToEpoch(dueDate, endTime, timeZone) : null;
      const linked = !isExam && courseId.length > 0;
      const derived = customTime && isLab ? periodsForClockRange(slots, startTime, endTime) : null;
      // 节次只写数字：自定义时间算不出重叠节次、或输入不是数字时，退回该条原有节次
      const fallbackPeriod = editing?.period_start ?? 1;
      const timetable = isLab || showInTimetable;
      const periodStart = isLab
        ? (derived?.periodStart ?? toPeriod(labPeriodStart, fallbackPeriod))
        : null;
      const periodEnd = isLab
        ? Math.max(periodStart ?? 1, derived?.periodEnd ?? toPeriod(labPeriodEnd, periodStart ?? 1))
        : null;
      logDebug('todo', editing === null ? '保存待办：开始' : '保存待办修改：开始', {
        type: current,
        title: title.trim(),
        date: dueDate,
        time: customTime ? `${startTime}-${endTime}` : dueTime,
        customTime,
        linked,
        countdown: switches.countdown,
        manualDone: switches.manualDone,
        periodStart,
        periodEnd,
        repeat: isLab && labRepeat ? labWeeks.length : 0,
      });
      if (editing !== null) {
        // 只写列名（snake_case），避免 camelCase 与列名同时出现把行写脏
        await updateEvent(storage, editing.id, {
          type: eventTypeFor(current, linked),
          title: title.trim(),
          semester_id: semesterId,
          on_date: dueDate,
          start_at: at,
          end_at: endAt,
          due_at: isHomework || linked ? (customTime ? endAt ?? at : at) : null,
          subject: linked ? courseId : null,
          location: isExam || isLab ? (location.trim().length > 0 ? location.trim() : null) : null,
          seat_no: isExam ? (seatNo.trim().length > 0 ? seatNo.trim() : null) : null,
          note: note.trim().length > 0 ? note.trim() : null,
          countdown: switches.countdown ? 1 : 0,
          manual_done: switches.manualDone ? 1 : 0,
          start_time: customTime ? startTime : null,
          end_time: customTime ? endTime : null,
          period_start: periodStart,
          period_end: periodEnd,
          weeks_mask: isLab && labRepeat ? weeksToMask(labWeeks) : null,
          as_day_of_week: isLab && labRepeat ? labWeekday : null,
          nature: isLab ? 'lab' : editing.nature,
          show_in_timetable: timetable ? 1 : 0,
        });
        await syncEventReminder(storage, userId, editing.id, advanceMinutesOf(advance));
        logInfo('todo', `已保存${KIND_LABEL[current]}`, { id: editing.id, title: title.trim() });
        toast.success(`已保存${KIND_LABEL[current]}「${title.trim()}」`);
        onCreated();
        onOpenChange(false);
        return;
      }
      let created: Record<string, unknown>;
      if (isLab) {
        created = await createEvent(storage, {
          userId,
          type: 'lab',
          title: title.trim(),
          semesterId,
          onDate: dueDate,
          startAt: at,
          endAt,
          nature: 'lab',
          subject: linked ? courseId : null,
          location: location.trim().length > 0 ? location.trim() : null,
          note: note.trim().length > 0 ? note.trim() : null,
          countdown: switches.countdown,
          manualDone: switches.manualDone,
          startTime: customTime ? startTime : null,
          endTime: customTime ? endTime : null,
          periodStart,
          periodEnd,
          weeksMask: labRepeat ? weeksToMask(labWeeks) : null,
          asDayOfWeek: labRepeat ? labWeekday : null,
          showInTimetable: timetable,
        });
      } else {
        created = await createEvent(storage, {
          userId,
          type: eventTypeFor(current, linked),
          title: title.trim(),
          semesterId,
          onDate: dueDate,
          startAt: at,
          endAt,
          dueAt: isHomework || linked ? (customTime ? endAt ?? at : at) : null,
          subject: linked ? courseId : null,
          location: isExam ? (location.trim().length > 0 ? location.trim() : null) : null,
          seatNo: isExam ? (seatNo.trim().length > 0 ? seatNo.trim() : null) : null,
          note: note.trim().length > 0 ? note.trim() : null,
          countdown: switches.countdown,
          manualDone: switches.manualDone,
          startTime: customTime ? startTime : null,
          endTime: customTime ? endTime : null,
          showInTimetable: timetable,
        });
      }
      const minutes = advanceMinutesOf(advance);
      if (created['id'] !== undefined && minutes >= 0) {
        await syncEventReminder(storage, userId, String(created['id']), minutes);
      }
      logInfo('todo', `已添加${KIND_LABEL[current]}`, { id: String(created['id'] ?? ''), title: title.trim() });
      toast.success(`已添加${KIND_LABEL[current]}「${title.trim()}」`);
      update({ title: '', note: '', location: '', seatNo: '' });
      onCreated();
      onOpenChange(false);
    } catch (cause: unknown) {
      // 保存失败要看得见：写日志 + 弹提示，不再静默
      const message = errorMessage(cause);
      logError('todo', '保存失败', { message, type: current, editing: editing?.id ?? null });
      toast.error(`保存失败：${message}`);
    }
  }

  /** 删除当前待办：详情页 footer 的 danger 入口，确认后硬删并关闭。 */
  async function remove(): Promise<void> {
    if (editing === null) return;
    const target = editing;
    const name = target.title;
    const ok = await confirmAction({
      title: '删除待办',
      description: DELETE(name, ['关联提醒']),
      confirmLabel: '确认删除',
    });
    if (!ok) return;
    await run('正在删除…', async () => {
      try {
        await deleteEvent(storage, target.id);
        logInfo('todo', `已删除${KIND_LABEL[current]}`, { id: target.id, title: name });
        toast.success(`已删除「${name}」`);
        onCreated();
        onOpenChange(false);
      } catch (cause: unknown) {
        const message = errorMessage(cause);
        logError('todo', '删除失败', { message, id: target.id });
        toast.error(`删除失败：${message}`);
      }
    });
  }

  /** 复制当前这一条：新建一条同名「副本」，其余字段照抄。 */
  async function copyOne(): Promise<void> {
    if (editing === null) return;
    const target = editing;
    const copyTitle = `${target.title} 副本`;
    await run('正在复制…', async () => {
      try {
        await createEvent(storage, {
          userId,
          type: target.type,
          title: copyTitle,
          semesterId: target.semester_id,
          onDate: target.on_date,
          startAt: target.start_at,
          endAt: target.end_at,
          dueAt: target.due_at,
          subject: target.subject,
          location: target.location,
          seatNo: target.seat_no,
          note: target.note,
          countdown: target.countdown === 1,
          manualDone: target.manual_done === 1,
          nature: target.nature,
          periodStart: target.period_start,
          periodEnd: target.period_end,
          weeksMask: target.weeks_mask,
          asDayOfWeek: target.as_day_of_week,
          startTime: target.start_time,
          endTime: target.end_time,
          showInTimetable: target.show_in_timetable === 1,
        });
        toast.success(`已复制为「${copyTitle}」`);
        onCreated();
        onOpenChange(false);
      } catch (cause: unknown) {
        const message = errorMessage(cause);
        logError('todo', '复制失败', { message, id: target.id });
        toast.error(`复制失败：${message}`);
      }
    });
  }

  const clockPeriods = customTime ? periodsForClockRange(slots, startTime, endTime) : null;

  return (
    <FormSurface
      open={open}
      onOpenChange={onOpenChange}
      container={container}
      title={editing === null ? '添加待办' : '待办详情'}
      description={editing === null ? '选类型后填字段' : '保存写回这一条'}
      contentAttrs={{ 'data-role': 'todo-form' }}
    >
      <TodoBasicFields form={form} update={update} courses={courses} onChangeKind={changeKind} />
      <TodoTimeFields form={form} update={update} />
      {isLab && (
        <TodoLabFields
          form={form}
          update={update}
          totalWeeks={semester?.total_weeks ?? 20}
          clockPeriods={clockPeriods}
        />
      )}
      <TodoDetailFields form={form} update={update} />
      <TodoFooter
        editingTitle={editing === null ? null : editing.title}
        busy={busy}
        canSave={title.trim().length > 0}
        onRemove={() => void remove()}
        onCancel={() => onOpenChange(false)}
        onCopy={() => void copyOne()}
        onSave={() => void submit()}
      />
    </FormSurface>
  );
}
