import { useEffect, useState } from 'react';
import { BellRing, Trash2 } from 'lucide-react';
import { deleteReminder, listRemindersFor, setReminder, type Storage } from '@dawn-tick/core';
import { Button } from './ui/button.tsx';
import { confirmAction } from './ui/confirm-dialog.tsx';
import { Switch } from './ui/controls.tsx';
import { Input, Label } from './ui/input.tsx';
import { toast } from './ui/toaster.tsx';
import { cn } from '../lib/cn.ts';

const PRESETS = [5, 10, 15, 20, 30];

export interface ReminderFormProps {
  storage: Storage;
  userId: string;
  courseId: string;
  onChanged: () => void;
}

export function ReminderForm({ storage, userId, courseId, onChanged }: ReminderFormProps) {
  const [reminderId, setReminderId] = useState<string | null>(null);
  /** 默认使用全局配置；只有关掉才显示并保存本课程单独设置 */
  const [useGlobal, setUseGlobal] = useState(true);
  const [advance, setAdvance] = useState(20);
  const [custom, setCustom] = useState(false);
  const [skipHolidays, setSkipHolidays] = useState(true);
  const [snooze, setSnooze] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await listRemindersFor(storage, 'course', courseId);
      if (cancelled) return;
      const reminder = rows[0];
      if (reminder === undefined) {
        setReminderId(null);
        setUseGlobal(true);
        setAdvance(20);
        setCustom(false);
        setSkipHolidays(true);
        setSnooze(false);
        return;
      }
      const minutes = Number(reminder['advance_minutes'] ?? 20);
      setReminderId(String(reminder['id']));
      setUseGlobal(false);
      setAdvance(minutes);
      setCustom(!PRESETS.includes(minutes));
      setSkipHolidays(reminder['skip_holidays'] === 1);
      setSnooze(reminder['snooze_minutes'] !== null && reminder['snooze_minutes'] !== undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [storage, courseId]);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await setReminder(storage, {
        userId,
        targetType: 'course',
        targetId: courseId,
        advanceMinutes: advance,
        skipHolidays,
        snoozeMinutes: snooze ? 5 : null,
      });
      const rows = await listRemindersFor(storage, 'course', courseId);
      setReminderId(rows[0] === undefined ? null : String(rows[0]['id']));
      toast.success(`已设置课前 ${advance} 分钟提醒`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (reminderId === null) return;
    const ok = await confirmAction({
      title: '删除提醒',
      description: '将删除这节课的课前提醒，不可撤销',
      confirmLabel: '确认删除',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteReminder(storage, reminderId);
      setReminderId(null);
      toast.success('已删除提醒');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" data-role="reminder-section" aria-labelledby="reminder-section-title">
      <span id="reminder-section-title" className="text-sm font-medium text-ink">
        课前提醒
      </span>
      <label className="flex min-h-tap items-center justify-between gap-3 text-sm text-ink">
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <BellRing className="size-4" aria-hidden />
            使用全局配置
          </span>
          <span className="text-xs text-muted">
            {useGlobal ? '跟随全局设置' : '本课程单独设置'}
          </span>
        </span>
        <Switch
          aria-label="使用全局配置"
          checked={useGlobal}
          onCheckedChange={(checked) => {
            setUseGlobal(checked);
            if (checked && reminderId !== null) void remove();
          }}
        />
      </label>
      {!useGlobal && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((minutes) => (
              <Button
                key={minutes}
                size="sm"
                variant={!custom && advance === minutes ? 'primary' : 'secondary'}
                aria-pressed={!custom && advance === minutes}
                onClick={() => {
                  setCustom(false);
                  setAdvance(minutes);
                }}
              >
                {minutes} 分钟
              </Button>
            ))}
            <Button
              size="sm"
              variant={custom ? 'primary' : 'secondary'}
              aria-pressed={custom}
              onClick={() => setCustom(true)}
            >
              自定义
            </Button>
          </div>

          {custom && (
            <div className="flex items-center gap-2">
              <Label htmlFor="advance-minutes">提前分钟</Label>
              <Input
                id="advance-minutes"
                type="number"
                min={1}
                max={1440}
                className={cn('w-24')}
                value={advance}
                onChange={(event) => setAdvance(Number(event.target.value))}
              />
            </div>
          )}

          <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4"
              checked={skipHolidays}
              onChange={(event) => setSkipHolidays(event.target.checked)}
            />
            放假当天不提醒
          </label>
          <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4"
              checked={snooze}
              onChange={(event) => setSnooze(event.target.checked)}
            />
            允许贪睡 5 分钟
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              保存提醒
            </Button>
            {reminderId !== null && (
              <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
                <Trash2 className="size-4" aria-hidden />
                删除提醒
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
