import { useEffect, useState } from 'react';
import {
  createEvent,
  dateWallClockToEpoch,
  deleteEvent,
  formatDate,
  maskToWeeks,
  periodsForClockRange,
  plusMinutesText,
  setReminder,
  updateEvent,
  weeksToMask,
  WEEKDAY_LABELS,
  type EventRow,
  type SemesterRow,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { logDebug, logError, logInfo } from '../log.ts';
import { useBusyAction } from '../lib/busy.ts';
import { formatPeriodRange } from '../lib/format.ts';
import { Button } from '../components/ui/button.tsx';
import { confirmAction } from '../components/ui/confirm-dialog.tsx';
import { DELETE } from '../copy/zh.ts';
import { DialogFooter } from '../components/ui/dialog.tsx';
import { FormSurface, type FormContainer } from '../components/ui/sheet.tsx';
import { WeekPicker } from '../components/week-picker.tsx';
import { Field, Input, Textarea } from '../components/ui/input.tsx';
import { HelpHint } from '../components/ui/help-hint.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SwitchField,
} from '../components/ui/controls.tsx';
import { toast } from '../components/ui/toaster.tsx';

/** 待办类型：日程 / 作业 / 考试 / 实验。 */
export type EventFormKind = 'todo' | 'homework' | 'exam' | 'lab';

const KIND_LABEL: Record<EventFormKind, string> = {
  todo: '日程',
  homework: '作业',
  exam: '考试',
  lab: '实验',
};

/** 新建时的开关默认值：作业与考试默认开启倒计时，作业默认需要手动确认完成。 */
function defaultSwitches(kind: EventFormKind): { countdown: boolean; manualDone: boolean } {
  return {
    countdown: kind === 'homework' || kind === 'exam',
    manualDone: kind === 'homework',
  };
}

const ADVANCE_OPTIONS: ReadonlyArray<{ id: string; label: string; minutes: number }> = [
  { id: 'none', label: '不提醒', minutes: -1 },
  { id: 'same', label: '当天提醒', minutes: 0 },
  { id: 'half', label: '提前 30 分钟', minutes: 30 },
  { id: 'day', label: '提前 1 天', minutes: 24 * 60 },
  { id: 'three', label: '提前 3 天', minutes: 3 * 24 * 60 },
  { id: 'week', label: '提前 1 周', minutes: 7 * 24 * 60 },
];

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

/** 节次输入取整到 1..40，非法时用兜底值。 */
function toPeriod(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(40, Math.max(1, Math.round(parsed)));
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
  const [current, setCurrent] = useState<EventFormKind>(kind);
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('');
  const [dueDate, setDueDate] = useState(() => formatDate(Date.now(), timeZone));
  const [dueTime, setDueTime] = useState('09:00');
  const [advance, setAdvance] = useState('half');
  const [location, setLocation] = useState('');
  const [seatNo, setSeatNo] = useState('');
  const [note, setNote] = useState('');
  /** 保存/删除/复制共用一份提交态：busy 期间按钮转圈、重复触发被忽略 */
  const { busy, run } = useBusyAction();
  const [switches, setSwitches] = useState(() => defaultSwitches(kind));
  // 实验：只这一次 / 每周重复
  const [labRepeat, setLabRepeat] = useState(false);
  const [labWeekday, setLabWeekday] = useState(1);
  const [labPeriodStart, setLabPeriodStart] = useState('1');
  const [labPeriodEnd, setLabPeriodEnd] = useState('2');
  const [labWeeks, setLabWeeks] = useState<number[]>(() => Array.from({ length: 16 }, (_, index) => index + 1));
  // 自定义时间：不按节次，直接给开始与结束时间
  const [customTime, setCustomTime] = useState(false);
  const [startTime, setStartTime] = useState('19:00');
  const [endTime, setEndTime] = useState('21:00');
  /** 显示在课表上：实验默认开，日程/作业/考试默认关 */
  const [showInTimetable, setShowInTimetable] = useState(false);

  const isExam = current === 'exam';
  const isLab = current === 'lab';
  const isHomework = current === 'homework';

  /** 每次打开都回到调用方指定的类型与默认开关；编辑时按该条回填，避免沿用上一次的选择。 */
  useEffect(() => {
    if (!open) return;
    if (editing !== null) {
      setCurrent(editing.type === 'exam' ? 'exam' : editing.type === 'lab' ? 'lab' : editing.type === 'homework' ? 'homework' : 'todo');
      setSwitches({ countdown: editing.countdown === 1, manualDone: editing.manual_done === 1 });
      setTitle(editing.title);
      setCourseId(editing.subject ?? '');
      setDueDate(editing.on_date ?? formatDate(editing.start_at ?? editing.due_at ?? Date.now(), timeZone));
      setLocation(editing.location ?? '');
      setSeatNo(editing.seat_no ?? '');
      setNote(editing.note ?? '');
      setCustomTime(editing.start_time !== null && editing.end_time !== null);
      setStartTime(editing.start_time ?? '19:00');
      setEndTime(editing.end_time ?? '21:00');
      setLabWeekday(editing.as_day_of_week ?? 1);
      setLabRepeat(editing.weeks_mask !== null);
      setLabWeeks(
        editing.weeks_mask === null
          ? Array.from({ length: semester?.total_weeks ?? 16 }, (_, index) => index + 1)
          : maskToWeeks(editing.weeks_mask, semester?.total_weeks ?? 20),
      );
      setLabPeriodStart(String(editing.period_start ?? 1));
      setLabPeriodEnd(String(editing.period_end ?? editing.period_start ?? 2));
      setShowInTimetable(editing.show_in_timetable === 1);
      return;
    }
    setCurrent(kind);
    setSwitches(defaultSwitches(kind));
    setCustomTime(false);
    setShowInTimetable(kind === 'lab');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, editing]);

  /** 切换类型时把开关恢复成该类型的默认值。 */
  function changeKind(next: EventFormKind): void {
    setCurrent(next);
    setSwitches(defaultSwitches(next));
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
          type: isExam ? 'exam' : isHomework ? 'homework' : linked ? 'todo' : 'temp',
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
      const minutes = ADVANCE_OPTIONS.find((item) => item.id === advance)?.minutes ?? -1;
      if (created['id'] !== undefined && minutes >= 0) {
        await setReminder(storage, {
          userId,
          targetType: 'event',
          targetId: String(created['id']),
          advanceMinutes: minutes,
          skipHolidays: true,
        });
      }
      logInfo('todo', `已添加${KIND_LABEL[current]}`, { id: String(created['id'] ?? ''), title: title.trim() });
      toast.success(`已添加${KIND_LABEL[current]}「${title.trim()}」`);
      setTitle('');
      setNote('');
      setLocation('');
      setSeatNo('');
      onCreated();
      onOpenChange(false);
    } catch (cause: unknown) {
      // 保存失败要看得见：写日志 + 弹提示，不再静默
      const message = cause instanceof Error ? cause.message : String(cause);
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
        const message = cause instanceof Error ? cause.message : String(cause);
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
        const message = cause instanceof Error ? cause.message : String(cause);
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
      <Field label="类型">
        <div className="flex flex-wrap gap-2">
          {(['todo', 'homework', 'exam', 'lab'] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={current === item ? 'primary' : 'secondary'}
              aria-label={`待办类型：${KIND_LABEL[item]}`}
              aria-pressed={current === item}
              onClick={() => changeKind(item)}
            >
              {KIND_LABEL[item]}
            </Button>
          ))}
        </div>
      </Field>
      <Field label={isExam ? '考试名称' : isLab ? '实验名称' : isHomework ? '作业名称' : '标题'}>
        <Input
          value={title}
          aria-label={isExam ? '考试名称' : isLab ? '实验名称' : isHomework ? '作业名称' : '标题'}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      {!isExam && (
        <Field label="关联课程（可选）" hint={isLab ? '实验会挂在课的同一列里展示' : '关联后归入该课程'}>
          <Select value={courseId} onValueChange={setCourseId}>
            <SelectTrigger aria-label="关联课程">
              {courses.find((item) => item.id === courseId)?.name ?? '不关联'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">不关联</SelectItem>
              {courses.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <div className="flex flex-wrap gap-3">
        <Field label={isExam ? '考试日期' : isLab ? '首次日期' : '日期'}>
          <Input
            type="date"
            value={dueDate}
            aria-label={isExam ? '考试日期' : isLab ? '首次日期' : '日期'}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>
        {!isLab && !customTime && (
          <Field label={isExam ? '开考时间' : '时间'}>
            <Input
              type="time"
              value={dueTime}
              aria-label={isExam ? '开考时间' : '时间'}
              onChange={(event) => setDueTime(event.target.value)}
            />
          </Field>
        )}
        {customTime && (
          <>
            <Field label="开始时间">
              <Input
                type="time"
                value={startTime}
                aria-label="开始时间"
                onChange={(event) => {
                  setStartTime(event.target.value);
                  setEndTime((current) => (current <= event.target.value ? plusMinutesText(event.target.value, 90) : current));
                }}
              />
            </Field>
            <Field label="结束时间">
              <Input
                type="time"
                value={endTime}
                aria-label="结束时间"
                onChange={(event) => setEndTime(event.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="提前提醒">
          <Select value={advance} onValueChange={setAdvance}>
            <SelectTrigger aria-label={isExam ? '考试提前提醒' : '待办提前提醒'}>
              {ADVANCE_OPTIONS.find((item) => item.id === advance)?.label ?? '提前 1 天'}
            </SelectTrigger>
            <SelectContent>
              {ADVANCE_OPTIONS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <SwitchField
        label="自定义时间"
        description="按真实起止时间显示"
        checked={customTime}
        onCheckedChange={(checked) => setCustomTime(checked)}
        ariaLabel="自定义时间"
      />
      {isLab && (
        <div className="flex flex-col gap-2" data-role="lab-fields">
          <SwitchField
            label="每周重复"
            description="关闭时只在这一天"
            checked={labRepeat}
            onCheckedChange={(checked) => setLabRepeat(checked)}
            ariaLabel="实验每周重复"
          />
          {labRepeat && (
            <>
              <Field label="星期">
                <Select value={String(labWeekday)} onValueChange={(value) => setLabWeekday(Number(value))}>
                  <SelectTrigger aria-label="实验星期">
                    {WEEKDAY_LABELS[labWeekday - 1] ?? '周一'}
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_LABELS.map((label, index) => (
                      <SelectItem key={label} value={String(index + 1)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <WeekPicker
                totalWeeks={semester?.total_weeks ?? 20}
                value={labWeeks}
                onValueChange={setLabWeeks}
                showShortcuts={false}
                dataRole="lab-weeks"
              />
              <span className="flex items-center gap-1 text-xs text-muted">
                每周重复按上面的「星期」
                <HelpHint label="每周重复">起始日期只决定首次上课日，之后按「星期」与所选周次重复</HelpHint>
              </span>
            </>
          )}
          <div className="flex flex-wrap gap-3">
            {!customTime && (
              <>
                <Field label="起始节">
                  <Input
                    type="number"
                    min={1}
                    max={40}
                    className="w-24"
                    aria-label="实验起始节"
                    value={labPeriodStart}
                    onChange={(event) => setLabPeriodStart(event.target.value)}
                  />
                </Field>
                <Field label="结束节">
                  <Input
                    type="number"
                    min={1}
                    max={40}
                    className="w-24"
                    aria-label="实验结束节"
                    value={labPeriodEnd}
                    onChange={(event) => setLabPeriodEnd(event.target.value)}
                  />
                </Field>
              </>
            )}
            {customTime && (
              <span className="self-center text-xs text-muted">
                已按起止时间回填节次{clockPeriods === null
                  ? ''
                  : `（${formatPeriodRange(clockPeriods.periodStart, clockPeriods.periodEnd)}）`}
              </span>
            )}
          </div>
        </div>
      )}
      {(isExam || isLab) && (
        <div className="flex flex-wrap gap-3">
          <Field label="地点（可选）">
            <Input
              value={location}
              aria-label={isLab ? '实验地点' : '考试地点'}
              onChange={(event) => setLocation(event.target.value)}
            />
          </Field>
          {isExam && (
            <Field label="座位号（可选）">
              <Input value={seatNo} aria-label="座位号" onChange={(event) => setSeatNo(event.target.value)} />
            </Field>
          )}
        </div>
      )}
      <SwitchField
        label="开启倒计时"
        description="在倒计时卡片里显示剩余天数"
        checked={switches.countdown}
        onCheckedChange={(checked) => setSwitches((current) => ({ ...current, countdown: checked }))}
        ariaLabel="开启倒计时"
      />
      <SwitchField
        label="显示在课表上"
        description="占用课表格子"
        checked={showInTimetable}
        onCheckedChange={(checked) => setShowInTimetable(checked)}
        ariaLabel="显示在课表上"
      />
      <SwitchField
        label="需要手动确认完成"
        description="打开后不会自动完成，过期仍留在待办列表"
        checked={switches.manualDone}
        onCheckedChange={(checked) => setSwitches((current) => ({ ...current, manualDone: checked }))}
        ariaLabel="需要手动确认完成"
      />
      <Field label="备注">
        <Textarea value={note} aria-label="备注" onChange={(event) => setNote(event.target.value)} />
      </Field>
      <DialogFooter>
        {editing !== null && (
          <Button
            variant="danger"
            className="mr-auto"
            loading={busy}
            aria-label={`删除条目 ${editing.title}`}
            onClick={() => void remove()}
          >
            删除这条
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
          取消
        </Button>
        {editing !== null && (
          <Button variant="secondary" loading={busy} onClick={() => void copyOne()}>
            复制一条
          </Button>
        )}
        <Button
          variant="primary"
          loading={busy}
          disabled={title.trim().length === 0}
          onClick={() => void submit()}
        >
          保存
        </Button>
      </DialogFooter>
    </FormSurface>
  );
}
