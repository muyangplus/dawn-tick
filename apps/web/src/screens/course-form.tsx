import { useEffect, useState } from 'react';
import {
  createCourse,
  createSchedule,
  dayOfWeek,
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
  for (let week = from; week <= to; week += 1) out.push(week);
  return out;
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
}: CourseFormProps) {
  const [name, setName] = useState('');
  const [teacher, setTeacher] = useState('');
  const [location, setLocation] = useState('');
  const [credits, setCredits] = useState('');
  const [day, setDay] = useState(1);
  const [periodStart, setPeriodStart] = useState(1);
  const [periodEnd, setPeriodEnd] = useState(2);
  const [mode, setMode] = useState<WeekMode>('all');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(totalWeeks);
  const [colorIndex, setColorIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const palette = PRESETS[preset].courses;

  useEffect(() => {
    if (!open) return;
    setDay(dayOfWeek(semesterStart));
    setPeriodStart(slots[0]?.period_no ?? 1);
    setPeriodEnd(Math.min((slots[0]?.period_no ?? 1) + 1, slots.length === 0 ? 2 : (slots.at(-1)?.period_no ?? 2)));
    setTo(totalWeeks);
  }, [open, semesterStart, slots, totalWeeks]);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const course = await createCourse(storage, {
        semesterId,
        name: name.trim(),
        teacher: teacher.trim().length > 0 ? teacher.trim() : null,
        location: location.trim().length > 0 ? location.trim() : null,
        credits: credits.trim().length > 0 ? Number(credits) : null,
        color: palette[colorIndex % palette.length] ?? '#4F8DFD',
      });
      await createSchedule(storage, {
        courseId: String(course['id']),
        dayOfWeek: day,
        periodStart,
        periodEnd: Math.max(periodStart, periodEnd),
        weeks: weeksFor(mode, totalWeeks, from, to),
      });
      toast.success('已添加课程');
      setName('');
      setTeacher('');
      setLocation('');
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
      <DialogContent title="添加课程" description="课程信息与排课时段">
        <Field label="课程名">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="grid gap-2 tablet:grid-cols-3">
          <Field label="教师">
            <Input value={teacher} onChange={(event) => setTeacher(event.target.value)} />
          </Field>
          <Field label="地点">
            <Input value={location} onChange={(event) => setLocation(event.target.value)} />
          </Field>
          <Field label="学分">
            <Input type="number" step="0.5" value={credits} onChange={(event) => setCredits(event.target.value)} />
          </Field>
        </div>
        <div className="grid gap-2 tablet:grid-cols-3">
          <Field label="星期">
            <Select value={String(day)} onValueChange={(value) => setDay(Number(value))}>
              <SelectTrigger aria-label="星期">
                <span>{WEEKDAYS[day - 1]}</span>
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((label, index) => (
                  <SelectItem key={label} value={String(index + 1)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="起始节">
            <Select value={String(periodStart)} onValueChange={(value) => setPeriodStart(Number(value))}>
              <SelectTrigger aria-label="起始节">
                <span>第 {periodStart} 节</span>
              </SelectTrigger>
              <SelectContent>
                {slots.map((slot) => (
                  <SelectItem key={slot.period_no} value={String(slot.period_no)}>
                    第 {slot.period_no} 节
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="结束节">
            <Select value={String(periodEnd)} onValueChange={(value) => setPeriodEnd(Number(value))}>
              <SelectTrigger aria-label="结束节">
                <span>第 {periodEnd} 节</span>
              </SelectTrigger>
              <SelectContent>
                {slots.map((slot) => (
                  <SelectItem key={slot.period_no} value={String(slot.period_no)}>
                    第 {slot.period_no} 节
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="周次">
            <Select value={mode} onValueChange={(value) => setMode(value as WeekMode)}>
              <SelectTrigger aria-label="周次模式" className="w-32">
                <span>{{ all: '全周', odd: '单周', even: '双周', range: '指定范围' }[mode]}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全周</SelectItem>
                <SelectItem value="odd">单周</SelectItem>
                <SelectItem value="even">双周</SelectItem>
                <SelectItem value="range">指定范围</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {mode === 'range' && (
            <>
              <Field label="起始周">
                <Input
                  type="number"
                  min={1}
                  max={totalWeeks}
                  className="w-20"
                  value={from}
                  onChange={(event) => setFrom(Number(event.target.value))}
                />
              </Field>
              <Field label="结束周">
                <Input
                  type="number"
                  min={1}
                  max={totalWeeks}
                  className="w-20"
                  value={to}
                  onChange={(event) => setTo(Number(event.target.value))}
                />
              </Field>
            </>
          )}
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
                className={cn(
                  'size-tap rounded-full border-2',
                  index === colorIndex ? 'border-ink' : 'border-transparent',
                )}
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
          <Button variant="primary" disabled={busy || name.trim().length === 0} onClick={() => void submit()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
