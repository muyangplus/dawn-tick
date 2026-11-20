import { useEffect, useState } from 'react';
import { BellRing, Trash2 } from 'lucide-react';
import { deleteReminder, listRemindersFor, setReminder, type Storage } from '@dawn-tick/core';
import { Button } from './ui/button.tsx';
import { confirmAction } from './ui/confirm-dialog.tsx';
import { SwitchField } from './ui/controls.tsx';
import { Input, Label } from './ui/input.tsx';
import { useAction } from '../lib/action.ts';
import { cn } from '../lib/cn.ts';
import { courseReminderCopy } from '../copy/home-reminder.ts';

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
  const { busy, run } = useAction();

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
    await run({
      scope: 'reminder',
      label: courseReminderCopy.saving,
      ok: courseReminderCopy.saved(advance),
      fail: { what: courseReminderCopy.saveFailed, next: courseReminderCopy.retryNext },
      task: async () => {
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
        onChanged();
      },
    });
  }

  async function remove(): Promise<void> {
    if (reminderId === null) return;
    await run({
      scope: 'reminder',
      label: courseReminderCopy.deleting,
      ok: courseReminderCopy.deleted,
      fail: { what: courseReminderCopy.deleteFailed, next: courseReminderCopy.retryNext },
      confirm: () =>
        confirmAction({
          title: courseReminderCopy.deleteConfirmTitle,
          description: courseReminderCopy.deleteConfirmDescription,
          confirmLabel: courseReminderCopy.deleteConfirmButton,
        }),
      task: async () => {
        await deleteReminder(storage, reminderId);
        setReminderId(null);
        onChanged();
      },
    });
  }

  return (
    <section className="flex flex-col gap-3" data-role="reminder-section" aria-labelledby="reminder-section-title">
      <span id="reminder-section-title" className="text-sm font-medium text-ink">
        {courseReminderCopy.sectionTitle}
      </span>
      <SwitchField
        label={courseReminderCopy.useGlobalLabel}
        icon={BellRing}
        description={useGlobal ? undefined : courseReminderCopy.customDescription}
        checked={useGlobal}
        onCheckedChange={(checked) => {
          setUseGlobal(checked);
          if (checked && reminderId !== null) void remove();
        }}
        ariaLabel={courseReminderCopy.useGlobalLabel}
      />
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
                {courseReminderCopy.presetButton(minutes)}
              </Button>
            ))}
            <Button
              size="sm"
              variant={custom ? 'primary' : 'secondary'}
              aria-pressed={custom}
              onClick={() => setCustom(true)}
            >
              {courseReminderCopy.customButton}
            </Button>
          </div>

          {custom && (
            <div className="flex items-center gap-2">
              <Label htmlFor="advance-minutes">{courseReminderCopy.advanceLabel}</Label>
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
            {courseReminderCopy.skipHolidays}
          </label>
          <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4"
              checked={snooze}
              onChange={(event) => setSnooze(event.target.checked)}
            />
            {courseReminderCopy.snooze}
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              {courseReminderCopy.saveButton}
            </Button>
            {reminderId !== null && (
              <Button variant="ghost" loading={busy} onClick={() => void remove()}>
                <Trash2 className="size-4" aria-hidden />
                {courseReminderCopy.deleteButton}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
