import { useState } from 'react';
import { createEvent, dateWallClockToEpoch, formatDate, type Storage } from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { Field, Input, Textarea } from '../components/ui/input.tsx';
import { toast } from '../components/ui/toaster.tsx';

export type EventFormKind = 'todo' | 'exam';

export interface TodoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
  userId: string;
  semesterId: string;
  timeZone: string;
  /** todo：日程/待办；exam：考试倒计时 */
  kind?: EventFormKind;
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
  onCreated,
}: TodoFormProps) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(() => formatDate(Date.now(), timeZone));
  const [dueTime, setDueTime] = useState('09:00');
  const [location, setLocation] = useState('');
  const [seatNo, setSeatNo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const isExam = kind === 'exam';

  async function submit(): Promise<void> {
    if (title.trim().length === 0) return;
    setBusy(true);
    try {
      await createEvent(storage, {
        userId,
        type: isExam ? 'exam' : 'temp',
        semesterId,
        title: title.trim(),
        onDate: dueDate,
        startAt: isExam ? dateWallClockToEpoch(dueDate, dueTime, timeZone) : null,
        location: isExam && location.trim().length > 0 ? location.trim() : null,
        seatNo: isExam && seatNo.trim().length > 0 ? seatNo.trim() : null,
        note: note.trim().length > 0 ? note.trim() : null,
      });
      toast.success(isExam ? '已添加考试' : '已添加日程');
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
        title={isExam ? '添加考试' : '添加日程'}
        description={isExam ? '记入考试倒计时' : '临时日程与待办事项'}
      >
        <Field label={isExam ? '考试名称' : '标题'}>
          <Input value={title} aria-label={isExam ? '考试名称' : '标题'} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Field label={isExam ? '考试日期' : '日期'}>
            <Input
              type="date"
              value={dueDate}
              aria-label={isExam ? '考试日期' : '日期'}
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
