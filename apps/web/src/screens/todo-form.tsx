import { useEffect, useState } from 'react';
import {
  createEvent,
  dateWallClockToEpoch,
  formatDate,
  setReminder,
  weeksToMask,
  type SemesterRow,
  type Storage,
} from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { Field, Input, Textarea } from '../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, Switch } from '../components/ui/controls.tsx';
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

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

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
  onCreated: () => void;
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
  onCreated,
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
  const [busy, setBusy] = useState(false);
  const [switches, setSwitches] = useState(() => defaultSwitches(kind));
  // 实验：只这一次 / 每周重复
  const [labRepeat, setLabRepeat] = useState(false);
  const [labWeekday, setLabWeekday] = useState(1);
  const [labPeriodStart, setLabPeriodStart] = useState('1');
  const [labPeriodEnd, setLabPeriodEnd] = useState('2');
  const [labWeeks, setLabWeeks] = useState<number[]>(() => Array.from({ length: 16 }, (_, index) => index + 1));

  const isExam = current === 'exam';
  const isLab = current === 'lab';
  const isHomework = current === 'homework';

  /** 每次打开都回到调用方指定的类型与默认开关，避免沿用上一次的选择。 */
  useEffect(() => {
    if (!open) return;
    setCurrent(kind);
    setSwitches(defaultSwitches(kind));
  }, [open, kind]);

  /** 切换类型时把开关恢复成该类型的默认值。 */
  function changeKind(next: EventFormKind): void {
    setCurrent(next);
    setSwitches(defaultSwitches(next));
  }

  async function submit(): Promise<void> {
    if (title.trim().length === 0) return;
    setBusy(true);
    try {
      const at = dateWallClockToEpoch(dueDate, dueTime, timeZone);
      const linked = !isExam && courseId.length > 0;
      let created: Record<string, unknown>;
      if (isLab) {
        const start = Number(labPeriodStart);
        const end = Number(labPeriodEnd);
        created = await createEvent(storage, {
          userId,
          type: 'lab',
          semesterId,
          title: title.trim(),
          onDate: dueDate,
          subject: linked ? courseId : null,
          location: location.trim().length > 0 ? location.trim() : null,
          note: note.trim().length > 0 ? note.trim() : null,
          nature: 'lab',
          periodStart: Number.isFinite(start) ? start : 1,
          periodEnd: Number.isFinite(end) ? end : start,
          weeksMask: labRepeat ? weeksToMask(labWeeks) : null,
          asDayOfWeek: labRepeat ? labWeekday : null,
          countdown: switches.countdown,
          manualDone: switches.manualDone,
        });
      } else {
        created = await createEvent(storage, {
          userId,
          type: isExam ? 'exam' : isHomework ? 'homework' : linked ? 'todo' : 'temp',
          semesterId,
          title: title.trim(),
          onDate: dueDate,
          startAt: at,
          dueAt: isHomework || linked ? at : null,
          subject: linked ? courseId : null,
          location: isExam ? (location.trim().length > 0 ? location.trim() : null) : null,
          seatNo: isExam ? (seatNo.trim().length > 0 ? seatNo.trim() : null) : null,
          note: note.trim().length > 0 ? note.trim() : null,
          countdown: switches.countdown,
          manualDone: switches.manualDone,
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
      toast.success(`已添加${KIND_LABEL[current]}「${title.trim()}」`);
      setTitle('');
      setNote('');
      setLocation('');
      setSeatNo('');
      onCreated();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="添加待办"
        description="选类型后填对应字段；作业与考试可显示倒计时，实验会排进课表"
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
          {!isLab && (
            <Field label={isExam ? '开考时间' : '时间'}>
              <Input
                type="time"
                value={dueTime}
                aria-label={isExam ? '开考时间' : '时间'}
                onChange={(event) => setDueTime(event.target.value)}
              />
            </Field>
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
        {isLab && (
          <div className="flex flex-col gap-2" data-role="lab-fields">
            <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
              <span className="flex min-w-0 flex-col">
                <span>每周重复</span>
                <span className="truncate text-xs text-muted">关闭时只在这一天</span>
              </span>
              <Switch
                aria-label="实验每周重复"
                checked={labRepeat}
                onCheckedChange={(checked) => setLabRepeat(checked)}
              />
            </label>
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
                <div className="flex flex-wrap gap-1" data-role="lab-weeks">
                  {Array.from({ length: semester?.total_weeks ?? 20 }, (_, index) => index + 1).map((week) => (
                    <Button
                      key={week}
                      size="sm"
                      variant={labWeeks.includes(week) ? 'primary' : 'secondary'}
                      aria-label={`第 ${week} 周`}
                      aria-pressed={labWeeks.includes(week)}
                      onClick={() =>
                        setLabWeeks((current) =>
                          current.includes(week) ? current.filter((item) => item !== week) : [...current, week].sort((a, b) => a - b),
                        )
                      }
                    >
                      {week}
                    </Button>
                  ))}
                </div>
                <span className="text-xs text-muted">
                  已选 {labWeeks.length} 周；起始日期所在周的星期几会在上面以「星期」为准
                </span>
              </>
            )}
            <div className="flex flex-wrap gap-3">
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
        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
          <span className="flex min-w-0 flex-col">
            <span>开启倒计时</span>
            <span className="truncate text-xs text-muted">在倒计时卡片里显示剩余天数</span>
          </span>
          <Switch
            aria-label="开启倒计时"
            checked={switches.countdown}
            onCheckedChange={(checked) => setSwitches((current) => ({ ...current, countdown: checked }))}
          />
        </label>
        <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
          <span className="flex min-w-0 flex-col">
            <span>需要手动确认完成</span>
            <span className="truncate text-xs text-muted">打开后不会自动完成，过期仍留在待办列表</span>
          </span>
          <Switch
            aria-label="需要手动确认完成"
            checked={switches.manualDone}
            onCheckedChange={(checked) => setSwitches((current) => ({ ...current, manualDone: checked }))}
          />
        </label>
        <Field label="备注">
          <Textarea value={note} aria-label="备注" onChange={(event) => setNote(event.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" disabled={busy || title.trim().length === 0} onClick={() => void submit()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
