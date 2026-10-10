import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  createCourse,
  setSchedules,
  updateCourse,
  type ManagedCourse,
  type Storage,
  type ThemePreset,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { PRESETS } from '../design/tokens.ts';
import { Button } from '../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../components/ui/controls.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { logInfo } from '../log.ts';
import { cn } from '../lib/cn.ts';

type WeekMode = 'all' | 'odd' | 'even' | 'range';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function weeksFor(mode: WeekMode, total: number, from: number, to: number): number[] {
  if (mode === 'all') return Array.from({ length: total }, (_, index) => index + 1);
  if (mode === 'odd' || mode === 'even') {
    const out: number[] = [];
    for (let week = mode === 'odd' ? 1 : 2; week <= total; week += 2) out.push(week);
    return out;
  }
  const out: number[] = [];
  for (let week = Math.max(1, from); week <= Math.min(total, to); week += 1) out.push(week);
  return out;
}

function modeOf(weeks: readonly number[], total: number): WeekMode {
  if (weeks.length === 0) return 'range';
  if (weeks.length === total) return 'all';
  const allOdd = weeks.every((week) => week % 2 === 1);
  const allEven = weeks.every((week) => week % 2 === 0);
  if (allOdd) return 'odd';
  if (allEven) return 'even';
  return 'range';
}

interface ScheduleDraft {
  key: string;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  mode: WeekMode;
  from: number;
  to: number;
  room: string;
}

let draftSeed = 0;
function newDraft(totalWeeks: number, dayOfWeek: number, periodStart: number): ScheduleDraft {
  draftSeed += 1;
  return {
    key: `draft-${draftSeed}`,
    dayOfWeek,
    periodStart,
    periodEnd: periodStart,
    mode: 'all',
    from: 1,
    to: totalWeeks,
    room: '',
  };
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
}

export function CourseForm({
  open,
  onOpenChange,
  storage,
  semesterId,
  semesterStart,
  totalWeeks,
  preset,
  slots,
  onCreated,
  course = null,
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
  const [busy, setBusy] = useState(false);

  const palette = PRESETS[preset].courses;
  const firstPeriod = slots[0]?.period_no ?? 1;
  const lastPeriod = slots.at(-1)?.period_no ?? firstPeriod + 1;

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
      setDrafts([newDraft(totalWeeks, 1, firstPeriod)]);
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
              mode: modeOf(weeks, totalWeeks),
              from: weeks[0] ?? 1,
              to: weeks.at(-1) ?? totalWeeks,
              room: schedule.room ?? '',
            };
          }),
    );
  }, [open, course, totalWeeks, firstPeriod, palette]);

  function patchDraft(key: string, changes: Partial<ScheduleDraft>): void {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...changes } : draft)));
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        shortName: shortName.trim().length > 0 ? shortName.trim() : null,
        teacher: teacher.trim().length > 0 ? teacher.trim() : null,
        location: location.trim().length > 0 ? location.trim() : null,
        color: palette[colorIndex % palette.length] ?? '#4F8DFD',
        credits: credits.trim().length > 0 ? Number(credits) : null,
        note: note.trim().length > 0 ? note.trim() : null,
      };
      const schedules = drafts.map((draft) => ({
        dayOfWeek: draft.dayOfWeek,
        periodStart: Math.min(draft.periodStart, draft.periodEnd),
        periodEnd: Math.max(draft.periodStart, draft.periodEnd),
        weeks: weeksFor(draft.mode, totalWeeks, draft.from, draft.to),
        room: draft.room.trim().length > 0 ? draft.room.trim() : null,
      }));

      if (course === null) {
        const created = await createCourse(storage, { semesterId, ...payload });
        await setSchedules(storage, String(created['id']), schedules);
        logInfo('course', '新建课程', { name: payload.name, schedules: schedules.length });
        toast.success('已添加课程');
      } else {
        await updateCourse(storage, course.id, payload as unknown as Record<string, unknown>);
        await setSchedules(storage, course.id, schedules);
        logInfo('course', '修改课程', { id: course.id, schedules: schedules.length });
        toast.success('已保存课程');
      }
      onCreated();
      onOpenChange(false);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={course === null ? '添加课程' : '编辑课程'} description="课程信息与排课时段">
        <Field label="课程名">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
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
                    <span>{WEEKDAYS[draft.dayOfWeek - 1]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((label, index) => (
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
              <div className="flex flex-wrap items-end gap-2">
                <Field label="周次">
                  <Select
                    value={draft.mode}
                    onValueChange={(value) => patchDraft(draft.key, { mode: value as WeekMode })}
                  >
                    <SelectTrigger aria-label="周次模式" className="w-32">
                      <span>{{ all: '全周', odd: '单周', even: '双周', range: '指定范围' }[draft.mode]}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全周</SelectItem>
                      <SelectItem value="odd">单周</SelectItem>
                      <SelectItem value="even">双周</SelectItem>
                      <SelectItem value="range">指定范围</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {draft.mode === 'range' && (
                  <>
                    <Field label="起始周">
                      <Input
                        type="number"
                        min={1}
                        max={totalWeeks}
                        className="w-20"
                        value={draft.from}
                        onChange={(event) => patchDraft(draft.key, { from: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="结束周">
                      <Input
                        type="number"
                        min={1}
                        max={totalWeeks}
                        className="w-20"
                        value={draft.to}
                        onChange={(event) => patchDraft(draft.key, { to: Number(event.target.value) })}
                      />
                    </Field>
                  </>
                )}
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy || name.trim().length === 0 || drafts.length === 0 || lastPeriod < firstPeriod}
            onClick={() => void submit()}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
