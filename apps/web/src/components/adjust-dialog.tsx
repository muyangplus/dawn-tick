import { useEffect, useState } from 'react';
import {
  createEvent,
  createReschedule,
  createSchedule,
  dayOfWeek,
  formatDate,
  weekOfDate,
  type Storage,
} from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog.tsx';
import { Field, Input } from './ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/controls.tsx';
import { toast } from './ui/toaster.tsx';

const USER_ID = 'u1';
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export interface AdjustTarget {
  scheduleId: string;
  courseName: string;
  /** 被调整的那一天，YYYY-MM-DD */
  date: string;
  periodStart: number;
  periodEnd: number;
}

export interface AdjustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
  data: AppData;
  /** 从某节课点进来时的预设目标 */
  target: AdjustTarget | null;
  onChanged: () => void;
}

type Mode = 'move' | 'rest' | 'extra';

/** 调课 / 调休 / 临时加课入口。 */
export function AdjustDialog({ open, onOpenChange, storage, data, target, onChanged }: AdjustDialogProps) {
  const [mode, setMode] = useState<Mode>('move');
  const [busy, setBusy] = useState(false);
  const semester = data.semester;

  const [cancelOnly, setCancelOnly] = useState(false);
  const [newDate, setNewDate] = useState(data.today);
  const [newStart, setNewStart] = useState('1');
  const [newEnd, setNewEnd] = useState('2');
  const [newRoom, setNewRoom] = useState('');

  const [restDate, setRestDate] = useState(data.today);
  const [restDay, setRestDay] = useState('1');

  const [extraCourse, setExtraCourse] = useState('');
  const [extraDate, setExtraDate] = useState(data.today);
  const [extraStart, setExtraStart] = useState('1');
  const [extraEnd, setExtraEnd] = useState('2');

  useEffect(() => {
    if (target !== null) {
      setMode('move');
      setNewStart(String(target.periodStart));
      setNewEnd(String(target.periodEnd));
      setNewDate(target.date);
    }
  }, [target]);

  useEffect(() => {
    if (extraCourse === '' && data.courses.length > 0) setExtraCourse(data.courses[0]?.id ?? '');
  }, [data.courses, extraCourse]);

  const periodStart = Number(newStart);
  const periodEnd = Number(newEnd);
  const extraPeriodStart = Number(extraStart);
  const extraPeriodEnd = Number(extraEnd);

  async function submitMove(): Promise<void> {
    if (semester === null || target === null) return;
    if (!Number.isInteger(periodStart) || !Number.isInteger(periodEnd) || periodStart < 1 || periodEnd < periodStart) {
      toast.error('节次需要是 1 起、且结束不小于开始');
      return;
    }
    setBusy(true);
    try {
      await createReschedule(storage, {
        userId: USER_ID,
        semesterId: semester.id,
        refScheduleId: target.scheduleId,
        onDate: target.date,
        action: cancelOnly ? 'cancel' : 'move',
        title: cancelOnly ? `停课：${target.courseName}` : `调课：${target.courseName}`,
        newDate: cancelOnly ? null : newDate,
        newPeriodStart: cancelOnly ? null : periodStart,
        newPeriodEnd: cancelOnly ? null : periodEnd,
        newRoom: cancelOnly || newRoom.trim().length === 0 ? null : newRoom.trim(),
      });
      toast.success(cancelOnly ? '已记录停课' : '已记录调课');
      onChanged();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitRest(): Promise<void> {
    if (semester === null) return;
    setBusy(true);
    try {
      await createEvent(storage, {
        userId: USER_ID,
        semesterId: semester.id,
        type: 'makeup',
        title: `${restDate} 按${WEEKDAYS[Number(restDay) - 1] ?? '周一'}课表上课`,
        onDate: restDate,
        asDayOfWeek: Number(restDay),
      });
      toast.success('已记录调休');
      onChanged();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitExtra(): Promise<void> {
    if (semester === null || extraCourse === '') return;
    if (
      !Number.isInteger(extraPeriodStart) ||
      !Number.isInteger(extraPeriodEnd) ||
      extraPeriodStart < 1 ||
      extraPeriodEnd < extraPeriodStart
    ) {
      toast.error('节次需要是 1 起、且结束不小于开始');
      return;
    }
    setBusy(true);
    try {
      const week = weekOfDate(extraDate, semester.start_date);
      await createSchedule(storage, {
        courseId: extraCourse,
        dayOfWeek: dayOfWeek(extraDate),
        periodStart: extraPeriodStart,
        periodEnd: extraPeriodEnd,
        weeks: [week],
      });
      toast.success(`已加课：第 ${week} 周 ${formatDate(Date.parse(`${extraDate}T00:00:00Z`), 'UTC').slice(0, 10)}`);
      onChanged();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="调课 / 调休 / 加课" description="改动只影响对应日期，原课表不变">
        <div className="flex gap-1">
          {(
            [
              { id: 'move', label: '调课' },
              { id: 'rest', label: '调休' },
              { id: 'extra', label: '临时加课' },
            ] as const
          ).map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={mode === item.id ? 'primary' : 'secondary'}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {mode === 'move' && (
          <div className="flex flex-col gap-3">
            {target === null ? (
              <span className="text-sm text-muted">
                请到「今日课程」里点某一节课的「调课」，或在周视图点课程后进入详情再调课
              </span>
            ) : (
              <>
                <span className="text-sm text-ink">
                  {target.courseName} · {target.date} · 第 {target.periodStart}
                  {target.periodEnd > target.periodStart ? `-${target.periodEnd}` : ''} 节
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={!cancelOnly ? 'primary' : 'secondary'}
                    onClick={() => setCancelOnly(false)}
                  >
                    改期
                  </Button>
                  <Button
                    size="sm"
                    variant={cancelOnly ? 'primary' : 'secondary'}
                    onClick={() => setCancelOnly(true)}
                  >
                    停课
                  </Button>
                </div>
                {!cancelOnly && (
                  <>
                    <Field label="改到哪一天">
                      <Input
                        type="date"
                        value={newDate}
                        aria-label="改到哪一天"
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
                          value={newEnd}
                          onChange={(event) => setNewEnd(event.target.value)}
                        />
                      </Field>
                      <Field label="教室（可选）">
                        <Input
                          value={newRoom}
                          aria-label="教室（可选）"
                          onChange={(event) => setNewRoom(event.target.value)}
                        />
                      </Field>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {mode === 'rest' && (
          <div className="flex flex-col gap-3">
            <Field label="哪一天调休">
              <Input
                type="date"
                value={restDate}
                aria-label="哪一天调休"
                onChange={(event) => setRestDate(event.target.value)}
              />
            </Field>
            <Field label="按星期几的课表">
              <Select value={restDay} onValueChange={setRestDay}>
                <SelectTrigger aria-label="按星期几的课表">
                  {WEEKDAYS[Number(restDay) - 1] ?? '周一'}
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
          </div>
        )}

        {mode === 'extra' && (
          <div className="flex flex-col gap-3">
            <Field label="加哪门课">
              <Select value={extraCourse} onValueChange={setExtraCourse}>
                <SelectTrigger aria-label="加哪门课">
                  {data.courses.find((course) => course.id === extraCourse)?.name ?? '选择课程'}
                </SelectTrigger>
                <SelectContent>
                  {data.courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="哪一天">
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
                  value={extraEnd}
                  onChange={(event) => setExtraEnd(event.target.value)}
                />
              </Field>
            </div>
            <span className="text-xs text-muted">
              临时加课按该日期所在周记录一次，只影响这一周；可在课程管理里删除
            </span>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy || semester === null || (mode === 'move' && target === null) || (mode === 'extra' && extraCourse === '')}
            onClick={() => {
              void (mode === 'move' ? submitMove() : mode === 'rest' ? submitRest() : submitExtra());
            }}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
