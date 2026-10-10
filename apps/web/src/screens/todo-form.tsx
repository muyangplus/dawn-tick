import { useState } from 'react';
import { createEvent, formatDate, type Storage } from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { Field, Input, Textarea } from '../components/ui/input.tsx';
import { toast } from '../components/ui/toaster.tsx';

export interface TodoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
  userId: string;
  semesterId: string;
  timeZone: string;
  onCreated: () => void;
}

export function TodoForm({ open, onOpenChange, storage, userId, semesterId, timeZone, onCreated }: TodoFormProps) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(() => formatDate(Date.now(), timeZone));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (title.trim().length === 0) return;
    setBusy(true);
    try {
      await createEvent(storage, {
        userId,
        type: 'temp',
        semesterId,
        title: title.trim(),
        onDate: dueDate,
        note: note.trim().length > 0 ? note.trim() : null,
      });
      toast.success('已添加待办');
      setTitle('');
      setNote('');
      onCreated();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="添加待办" description="临时日程与待办事项">
        <Field label="标题">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="日期">
          <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
        <Field label="备注">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
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
