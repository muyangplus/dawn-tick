import { useState } from 'react';
import {
  createEvent,
  dateWallClockToEpoch,
  formatDate,
  setReminder,
  type Storage,
} from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { Field, Input, Textarea } from '../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../components/ui/controls.tsx';
import { toast } from '../components/ui/toaster.tsx';

export type EventFormKind = 'todo' | 'exam' | 'assignment';

const ADVANCE_OPTIONS: ReadonlyArray<{ id: string; label: string; minutes: number }> = [
  { id: 'same', label: '截止当天提醒', minutes: 0 },
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
  /** todo：日程/待办；exam：考试倒计时；assignment：大作业与小组汇报 */
  kind?: EventFormKind;
  /** 供作业/汇报关联课程 */
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
  courses = [],
  onCreated,
}: TodoFormProps) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(() => formatDate(Date.now(), timeZone));
  const [dueTime, setDueTime] = useState('09:00');
  const [location, setLocation] = useState('');
  const [seatNo, setSeatNo] = useState('');
  const [courseId, setCourseId] = useState('');
  const [advance, setAdvance] = useState('day');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const isExam = kind === 'exam';
  const isAssignment = kind === 'assignment';
  const titleLabel = isExam ? '考试名称' : isAssignment ? '作业/汇报标题' : '标题';

  async function submit(): Promise<void> {
    if (title.trim().length === 0) return;
    setBusy(true);
    try {
      const deadline = dateWallClockToEpoch(dueDate, isAssignment ? '23:59' : dueTime, timeZone);
      const created = await createEvent(storage, {
        userId,
        type: isExam ? 'exam' : isAssignment ? 'todo' : 'temp',
        semesterId,
        title: title.trim(),
        onDate: dueDate,
        startAt: isExam ? dateWallClockToEpoch(dueDate, dueTime, timeZone) : isAssignment ? deadline : null,
        dueAt: isAssignment ? deadline : null,
        subject: isAssignment && courseId.length > 0 ? courseId : null,
        location: isExam && location.trim().length > 0 ? location.trim() : null,
        seatNo: isExam && seatNo.trim().length > 0 ? seatNo.trim() : null,
        note: note.trim().length > 0 ? note.trim() : null,
      });
      if (isAssignment && created['id'] !== undefined) {
        const minutes = ADVANCE_OPTIONS.find((item) => item.id === advance)?.minutes ?? 24 * 60;
        await setReminder(storage, {
          userId,
          targetType: 'event',
          targetId: String(created['id']),
          advanceMinutes: minutes,
          skipHolidays: true,
        });
      }
      toast.success(isExam ? '已添加考试' : isAssignment ? '已添加作业' : '已添加日程');
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
        title={isExam ? '添加考试' : isAssignment ? '添加作业/汇报' : '添加日程'}
        description={
          isExam ? '记入考试倒计时' : isAssignment ? '关联课程、带截止倒计时与提前提醒' : '临时日程与待办事项'
        }
      >
        <Field label={titleLabel}>
          <Input value={title} aria-label={titleLabel} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Field label={isExam ? '考试日期' : isAssignment ? '截止日期' : '日期'}>
            <Input
              type="date"
              value={dueDate}
              aria-label={isExam ? '考试日期' : isAssignment ? '截止日期' : '日期'}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          {isExam && (
            <Field label="开考时间">
              <Input
                type="time"
                value={dueTime}
                aria-label="开考时间"
                onChange={(event) => setDueTime(event.target.value)}
              />
            </Field>
          )}
        </div>
        {isAssignment && (
          <div className="flex flex-wrap gap-3">
            <Field label="关联课程（可选）">
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
            <Field label="提前提醒">
              <Select value={advance} onValueChange={setAdvance}>
                <SelectTrigger aria-label="作业提前提醒">
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
        )}
        {isExam && (
          <div className="flex flex-wrap gap-3">
            <Field label="地点（可选）">
              <Input value={location} aria-label="考试地点" onChange={(event) => setLocation(event.target.value)} />
            </Field>
            <Field label="座位号（可选）">
              <Input value={seatNo} aria-label="座位号" onChange={(event) => setSeatNo(event.target.value)} />
            </Field>
          </div>
        )}
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
