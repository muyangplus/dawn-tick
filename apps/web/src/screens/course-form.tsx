import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  createCourse,
  DEFAULT_COURSE_COLOR,
  listManagedCourses,
  rangesOverlap,
  setSchedules,
  updateCourse,
  WEEKDAY_LABELS,
  weeksIntersect,
  type ManagedCourse,
  type Storage,
  type ThemePreset,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { PRESETS } from '../design/tokens.ts';
import { Button } from '../components/ui/button.tsx';
import { WeekPicker } from '../components/week-picker.tsx';
import { DialogFooter } from '../components/ui/dialog.tsx';
import { FormSurface, type FormContainer } from '../components/ui/sheet.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, Switch } from '../components/ui/controls.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { logError, logInfo } from '../log.ts';
import { useBusyAction } from '../lib/busy.ts';
import { cn } from '../lib/cn.ts';
import { formatPeriodRange } from '../lib/format.ts';

function allWeeks(total: number): number[] {
  return Array.from({ length: total }, (_, index) => index + 1);
}

interface ScheduleDraft {
  key: string;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  /** 直接点选的周次集合 */
  weeks: number[];
  room: string;
  /** 自定义时间：打开后按真实起止时间展示，节次仅作提醒与重叠判定 */
  customTime: boolean;
  startTime: string;
  endTime: string;
}

let draftSeed = 0;
function newDraft(
  totalWeeks: number,
  dayOfWeek: number,
  periodStart: number,
  periodEnd = periodStart,
  weeks?: readonly number[],
): ScheduleDraft {
  draftSeed += 1;
  return {
    key: `draft-${draftSeed}`,
    dayOfWeek,
    periodStart,
    periodEnd: Math.max(periodStart, periodEnd),
    weeks: weeks === undefined ? allWeeks(totalWeeks) : [...weeks],
    room: '',
    customTime: false,
    startTime: '19:00',
    endTime: '21:00',
  };
}

/** 「点空白格新建」时带进来的预填信息。 */
export interface CourseFormPreset {
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  /** 预选周次，一般只有当前查看的那一周 */
  weeks?: readonly number[] | undefined;
}

interface ScheduleShape {
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  weeks: readonly number[];
}

/** 本次排课与已有课程重叠的第一处；课程允许重叠，这里只用于提醒，不阻断写入。 */
function findOverlap(
  courses: readonly ManagedCourse[],
  selfId: string,
  schedules: readonly ScheduleShape[],
): { name: string; start: number; end: number } | null {
  for (const course of courses) {
    if (course.id === selfId) continue;
    for (const other of course.schedules) {
      for (const draft of schedules) {
        if (other.dayOfWeek !== draft.dayOfWeek) continue;
        if (!rangesOverlap(other.periodStart, other.periodEnd, draft.periodStart, draft.periodEnd)) continue;
        if (!weeksIntersect(other.weeks, draft.weeks)) continue;
        return { name: course.name, start: other.periodStart, end: other.periodEnd };
      }
    }
  }
  return null;
}

export interface CourseFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
  semesterId: string;
  semesterStart: string;
  totalWeeks: number;
  preset: ThemePreset;
  slots: readonly TimeSlotRow[];
  onCreated: () => void;
  /** 传入时为编辑模式 */
  course?: ManagedCourse | null;
  /** 新建时的预填星期与节次范围（编辑模式忽略） */
  presetDraft?: CourseFormPreset | null | undefined;
  /** 容器形态由挂载处按断点决定：移动端底部 Sheet，桌面端居中 Dialog */
  container?: FormContainer;
}

export function CourseForm({
  open,
  onOpenChange,
  storage,
  semesterId,
  totalWeeks,
  preset,
  slots,
  onCreated,
  course = null,
  presetDraft = null,
  container = 'dialog',
}: CourseFormProps) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [teacher, setTeacher] = useState('');
  const [location, setLocation] = useState('');
  const [credits, setCredits] = useState('');
  const [note, setNote] = useState('');
  const [colorIndex, setColorIndex] = useState(0);
  const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 保存是唯一提交入口：busy 期间按钮转圈 + 整页蒙版，重复点击被忽略 */
  const { busy, run } = useBusyAction();

  const palette = PRESETS[preset].courses;
  const firstPeriod = slots[0]?.period_no ?? 1;
  const lastPeriod = slots.at(-1)?.period_no ?? firstPeriod + 1;
  const nameEmpty = name.trim().length === 0;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (course === null) {
      setName('');
      setShortName('');
      setTeacher('');
      setLocation('');
      setCredits('');
      setNote('');
      setColorIndex(0);
      if (presetDraft == null) {
        setDrafts([newDraft(totalWeeks, 1, firstPeriod)]);
        return;
      }
      const start = Math.min(Math.max(1, presetDraft.periodStart), lastPeriod);
      const end = Math.min(Math.max(start, presetDraft.periodEnd), lastPeriod);
      const weeks = (presetDraft.weeks ?? [])
        .map((week) => Math.round(week))
        .filter((week) => week >= 1 && week <= totalWeeks);
      setDrafts([
        newDraft(
          totalWeeks,
          Math.min(7, Math.max(1, presetDraft.dayOfWeek)),
          start,
          end,
          weeks.length > 0 ? weeks : undefined,
        ),
      ]);
      return;
    }
    setName(course.name);
    setShortName(course.shortName ?? '');
    setTeacher(course.teacher ?? '');
    setLocation(course.location ?? '');
    setCredits(course.credits === null ? '' : String(course.credits));
    setNote(course.note ?? '');
    const index = palette.indexOf(course.color);
    setColorIndex(index >= 0 ? index : 0);
    setDrafts(
      course.schedules.length === 0
        ? [newDraft(totalWeeks, 1, firstPeriod)]
        : course.schedules.map((schedule) => {
            draftSeed += 1;
            const weeks = [...schedule.weeks].sort((left, right) => left - right);
            return {
              key: `draft-${draftSeed}`,
              dayOfWeek: schedule.dayOfWeek,
              periodStart: schedule.periodStart,
              periodEnd: schedule.periodEnd,
              weeks: weeks.length > 0 ? weeks : allWeeks(totalWeeks),
              room: schedule.room ?? '',
              customTime: schedule.startTime !== null && schedule.endTime !== null,
              startTime: schedule.startTime ?? '19:00',
              endTime: schedule.endTime ?? '21:00',
            };
          }),
    );
  }, [open, course, totalWeeks, firstPeriod, lastPeriod, palette, presetDraft]);

  function patchDraft(key: string, changes: Partial<ScheduleDraft>): void {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...changes } : draft)));
  }

  async function submit(): Promise<void> {
    // 空名在 UI 层已禁用保存，这里再挡一次：回车/程序触发也不写空白课卡
    if (nameEmpty) return;
    await run('正在保存课程…', async () => {
      setError(null);
      try {
        const payload = {
          name: name.trim(),
          shortName: shortName.trim().length > 0 ? shortName.trim() : null,
          teacher: teacher.trim().length > 0 ? teacher.trim() : null,
          location: location.trim().length > 0 ? location.trim() : null,
          color: palette[colorIndex % palette.length] ?? DEFAULT_COURSE_COLOR,
          credits: credits.trim().length > 0 ? Number(credits) : null,
          note: note.trim().length > 0 ? note.trim() : null,
        };
        const schedules = drafts.map((draft) => ({
          dayOfWeek: draft.dayOfWeek,
          periodStart: Math.min(draft.periodStart, draft.periodEnd),
          periodEnd: Math.max(draft.periodStart, draft.periodEnd),
          weeks: [...draft.weeks].sort((left, right) => left - right),
          room: draft.room.trim().length > 0 ? draft.room.trim() : null,
          startTime: draft.customTime ? draft.startTime : null,
          endTime: draft.customTime ? draft.endTime : null,
        }));

        logInfo('course', course === null ? '新建课程：开始' : '修改课程：开始', {
          name: payload.name,
          schedules: schedules.map((item) => ({
            day: item.dayOfWeek,
            periods: `${item.periodStart}-${item.periodEnd}`,
            weeks: item.weeks.length,
            time: item.startTime === null ? null : `${item.startTime}-${item.endTime}`,
          })),
        });
        let savedId: string;
        if (course === null) {
          const created = await createCourse(storage, { semesterId, ...payload });
          savedId = String(created['id']);
          await setSchedules(storage, savedId, schedules, { totalWeeks });
          logInfo('course', '新建课程', { id: savedId, name: payload.name, schedules: schedules.length });
          toast.success('已添加课程');
        } else {
          savedId = course.id;
          await updateCourse(storage, course.id, payload as unknown as Record<string, unknown>);
          await setSchedules(storage, course.id, schedules, { totalWeeks });
          logInfo('course', '修改课程', { id: course.id, schedules: schedules.length });
          toast.success('已保存课程');
        }
        // 重叠只提醒不阻止：课程此时已经保存成功
        const overlap = findOverlap(await listManagedCourses(storage, semesterId), savedId, schedules);
        if (overlap !== null) {
          toast.info(`与「${overlap.name}」${formatPeriodRange(overlap.start, overlap.end)}重叠，已同时保留`);
        }
        onCreated();
        onOpenChange(false);
      } catch (cause: unknown) {
        // 保存失败同时写日志与界面提示，避免只留一句「无反应」
        const message = cause instanceof Error ? cause.message : String(cause);
        logError('course', '保存课程失败', { message, id: course?.id ?? null });
        setError(message);
        toast.error(`保存课程失败：${message}`);
      }
    });
  }

  return (
    <FormSurface
      open={open}
      onOpenChange={onOpenChange}
      container={container}
      title={course === null ? '添加课程' : '编辑课程'}
      description="课程信息与排课时段"
      contentAttrs={{ 'data-role': 'course-form' }}
    >
      <Field label="课程名">
        <Input
          value={name}
          aria-required="true"
          aria-invalid={nameEmpty}
          aria-describedby={nameEmpty ? 'course-name-error' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      {nameEmpty && (
        <p id="course-name-error" className="text-xs text-danger-strong">
          课程名不能为空
        </p>
      )}
      <div className="grid gap-2 tablet:grid-cols-3">
        <Field label="简称">
          <Input value={shortName} onChange={(event) => setShortName(event.target.value)} />
        </Field>
        <Field label="教师">
          <Input value={teacher} onChange={(event) => setTeacher(event.target.value)} />
        </Field>
        <Field label="地点">
          <Input value={location} onChange={(event) => setLocation(event.target.value)} />
        </Field>
      </div>
      <div className="grid gap-2 tablet:grid-cols-2">
        <Field label="学分">
          <Input type="number" step="0.5" value={credits} onChange={(event) => setCredits(event.target.value)} />
        </Field>
        <Field label="备注">
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted">排课时段</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDrafts((current) => [...current, newDraft(totalWeeks, 1, firstPeriod)])}
          >
            <Plus className="size-4" aria-hidden />
            增加时段
          </Button>
        </div>
        {drafts.map((draft) => (
          <div key={draft.key} className="flex flex-col gap-2 rounded-md border border-line p-2">
            <div className="grid grid-cols-3 gap-2">
              <Select
                value={String(draft.dayOfWeek)}
                onValueChange={(value) => patchDraft(draft.key, { dayOfWeek: Number(value) })}
              >
                <SelectTrigger aria-label="星期">
                  <span>{WEEKDAY_LABELS[draft.dayOfWeek - 1]}</span>
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <SelectItem key={label} value={String(index + 1)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(draft.periodStart)}
                onValueChange={(value) => patchDraft(draft.key, { periodStart: Number(value) })}
              >
                <SelectTrigger aria-label="起始节">
                  <span>第 {draft.periodStart} 节</span>
                </SelectTrigger>
                <SelectContent>
                  {slots.map((slot) => (
                    <SelectItem key={slot.period_no} value={String(slot.period_no)}>
                      第 {slot.period_no} 节
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(draft.periodEnd)}
                onValueChange={(value) => patchDraft(draft.key, { periodEnd: Number(value) })}
              >
                <SelectTrigger aria-label="结束节">
                  <span>第 {draft.periodEnd} 节</span>
                </SelectTrigger>
                <SelectContent>
                  {slots.map((slot) => (
                    <SelectItem key={slot.period_no} value={String(slot.period_no)}>
                      第 {slot.period_no} 节
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-tap items-center gap-2 text-xs text-muted">
                <Switch
                  aria-label="自定义时间"
                  checked={draft.customTime}
                  onCheckedChange={(checked) => patchDraft(draft.key, { customTime: checked })}
                />
                自定义时间
              </label>
              {draft.customTime && (
                <>
                  <Input
                    type="time"
                    className="w-28"
                    aria-label="开始时间"
                    value={draft.startTime}
                    onChange={(event) => patchDraft(draft.key, { startTime: event.target.value })}
                  />
                  <Input
                    type="time"
                    className="w-28"
                    aria-label="结束时间"
                    value={draft.endTime}
                    onChange={(event) => patchDraft(draft.key, { endTime: event.target.value })}
                  />
                </>
              )}
            </div>
            <div className="flex flex-col gap-2 rounded-md border border-line p-2">
              <WeekPicker
                totalWeeks={totalWeeks}
                value={draft.weeks}
                onValueChange={(weeks) => patchDraft(draft.key, { weeks })}
              />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="教室">
                <Input
                  className="w-28"
                  value={draft.room}
                  onChange={(event) => patchDraft(draft.key, { room: event.target.value })}
                />
              </Field>
              {drafts.length > 1 && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="删除此时段"
                  onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}
                >
                  <Trash2 className="size-4 text-danger-strong" aria-hidden />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">颜色</span>
        <div className="flex flex-wrap gap-2">
          {palette.map((color, index) => (
            <button
              key={color}
              type="button"
              aria-label={`课程色 ${index + 1}`}
              aria-pressed={index === colorIndex}
              onClick={() => setColorIndex(index)}
              className={cn('size-tap rounded-full border-2', index === colorIndex ? 'border-ink' : 'border-transparent')}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>
      {error !== null && <p className="text-xs text-danger-strong">{error}</p>}
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={nameEmpty || drafts.length === 0 || lastPeriod < firstPeriod}
          onClick={() => void submit()}
        >
          保存
        </Button>
      </DialogFooter>
    </FormSurface>
  );
}
