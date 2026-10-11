import { useEffect, useMemo, useState } from 'react';
import {
  createCourse,
  createEvent,
  createReschedule,
  createSchedule,
  dayOfWeek,
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
  courseId: string;
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

  // 调课
  const [courseId, setCourseId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [sourceDate, setSourceDate] = useState(data.today);
  const [cancelOnly, setCancelOnly] = useState(false);
  const [newDate, setNewDate] = useState(data.today);
  const [newStart, setNewStart] = useState('1');
  const [newEnd, setNewEnd] = useState('2');
  const [newRoom, setNewRoom] = useState('');

  // 调休：把 A 天的课表调到 B 天
  const [restFrom, setRestFrom] = useState(data.today);
  const [restTo, setRestTo] = useState(data.today);

  // 临时加课
  const [extraCourse, setExtraCourse] = useState('');
  const [extraName, setExtraName] = useState('');
  const [extraDate, setExtraDate] = useState(data.today);
  const [extraStart, setExtraStart] = useState('1');
  const [extraEnd, setExtraEnd] = useState('2');

  const course = useMemo(() => data.courses.find((item) => item.id === courseId), [data.courses, courseId]);
  const schedules = course?.schedules ?? [];
  const schedule = useMemo(() => schedules.find((item) => item.id === scheduleId), [schedules, scheduleId]);

  useEffect(() => {
    if (!open) return;
    if (target !== null) {
      setMode('move');
      setCourseId(target.courseId);
      setScheduleId(target.scheduleId);
      setSourceDate(target.date);
      setNewDate(target.date);
      setNewStart(String(target.periodStart));
      setNewEnd(String(target.periodEnd));
      setCancelOnly(false);
      return;
    }
    if (courseId === '' && data.courses.length > 0) setCourseId(data.courses[0]?.id ?? '');
  }, [open, target, courseId, data.courses]);

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

  async function submitMove(): Promise<void> {
    if (semester === null || schedule === undefined) {
      toast.error('请先选课程与要调整的课次');
      return;
    }
    if (!Number.isInteger(periodStart) || !Number.isInteger(periodEnd) || periodStart < 1 || periodEnd < periodStart) {
      toast.error('节次需要是 1 起、且结束不小于开始');
      return;
    }
    setBusy(true);
    try {
      await createReschedule(storage, {
        userId: USER_ID,
        semesterId: semester.id,
        refScheduleId: schedule.id,
        onDate: sourceDate,
        action: cancelOnly ? 'cancel' : 'move',
        title: cancelOnly ? `停课：${course?.name ?? ''}` : `调课：${course?.name ?? ''}`,
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
        title: `${restFrom} 的课表调到 ${restTo}`,
        onDate: restTo,
        asDayOfWeek: dayOfWeek(restFrom),
      });
      toast.success('已记录调休');
      onChanged();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitExtra(): Promise<void> {
    if (semester === null) return;
    if (extraCourse === '' && extraName.trim().length === 0) {
      toast.error('请选择课程或填写课程名称');
      return;
    }
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
      let targetCourseId = extraCourse;
      if (extraName.trim().length > 0) {
        const created = await createCourse(storage, {
          semesterId: semester.id,
          name: extraName.trim(),
          shortName: extraName.trim().slice(0, 4),
        });
        targetCourseId = String(created['id']);
      }
      const week = weekOfDate(extraDate, semester.start_date);
      await createSchedule(storage, {
        courseId: targetCourseId,
        dayOfWeek: dayOfWeek(extraDate),
        periodStart: extraPeriodStart,
        periodEnd: extraPeriodEnd,
        weeks: [week],
      });
      toast.success(`已加课：第 ${week} 周 ${WEEKDAYS[dayOfWeek(extraDate) - 1] ?? ''}`);
      onChanged();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="课程调整" description="改动只影响指定日期，原课表不变">
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
            <Field label="哪门课">
              <Select value={courseId} onValueChange={setCourseId}>
                <SelectTrigger aria-label="哪门课">{course?.name ?? '选择课程'}</SelectTrigger>
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
              <span className="text-sm text-muted">这门课还没有排课，先去课程管理里加排课</span>
            ) : (
              <Field label="要调整的课次">
                <Select value={scheduleId} onValueChange={setScheduleId}>
                  <SelectTrigger aria-label="要调整的课次">
                    {schedule === undefined
                      ? '选择课次'
                      : `${WEEKDAYS[schedule.dayOfWeek - 1] ?? ''} 第 ${schedule.periodStart}-${schedule.periodEnd} 节`}
                  </SelectTrigger>
                  <SelectContent>
                    {schedules.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {`${WEEKDAYS[item.dayOfWeek - 1] ?? ''} 第 ${item.periodStart}-${item.periodEnd} 节`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="原来哪一天" hint="这一天的那节课次被调整">
              <Input
                type="date"
                value={sourceDate}
                aria-label="原来哪一天"
                onChange={(event) => setSourceDate(event.target.value)}
              />
            </Field>
            <div className="flex gap-1">
              <Button size="sm" variant={!cancelOnly ? 'primary' : 'secondary'} onClick={() => setCancelOnly(false)}>
                改期
              </Button>
              <Button size="sm" variant={cancelOnly ? 'primary' : 'secondary'} onClick={() => setCancelOnly(true)}>
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
          </div>
        )}

        {mode === 'rest' && (
          <div className="flex flex-col gap-3">
            <Field label="把哪一天的课表">
              <Input
                type="date"
                value={restFrom}
                aria-label="把哪一天的课表"
                onChange={(event) => setRestFrom(event.target.value)}
              />
            </Field>
            <Field label="调到哪一天上">
              <Input type="date" value={restTo} aria-label="调到哪一天上" onChange={(event) => setRestTo(event.target.value)} />
            </Field>
            <span className="text-xs text-muted">
              例：把周四的课表调到周六 → 周六按周四课表上课（{WEEKDAYS[dayOfWeek(restFrom) - 1] ?? ''} 的课）
            </span>
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
            <span className="text-xs text-muted">只加这一次，按该日期所在周记录；可在课程管理里删除</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy || semester === null || (mode === 'move' && schedule === undefined)}
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
