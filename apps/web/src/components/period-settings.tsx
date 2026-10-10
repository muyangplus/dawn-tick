import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, Plus, Trash2, Wand2 } from 'lucide-react';
import {
  appendTimeSlot,
  deleteTimeSlot,
  generatePeriods,
  listTimeSlots,
  replaceTimeSlots,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { Button } from './ui/button.tsx';
import { Card, CardTitle } from './ui/card.tsx';
import { Field, Input } from './ui/input.tsx';
import { toast } from './ui/toaster.tsx';
import { logInfo } from '../log.ts';

const SECTION_LABEL = { am: '上午', pm: '下午', night: '晚上' } as const;

export interface PeriodSettingsProps {
  storage: Storage;
  semesterId: string;
  onChanged: () => void;
}

export function PeriodSettings({ storage, semesterId, onChanged }: PeriodSettingsProps) {
  const [duration, setDuration] = useState(45);
  const [gap, setGap] = useState(10);
  const [amStart, setAmStart] = useState('08:00');
  const [amCount, setAmCount] = useState(4);
  const [pmStart, setPmStart] = useState('14:00');
  const [pmCount, setPmCount] = useState(4);
  const [nightStart, setNightStart] = useState('19:00');
  const [nightCount, setNightCount] = useState(2);
  const [slots, setSlots] = useState<readonly TimeSlotRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setSlots(await listTimeSlots(storage, semesterId));
  }, [storage, semesterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function generate(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const periods = generatePeriods({
        durationMinutes: duration,
        breakMinutes: gap,
        blocks: [
          { section: 'am', startTime: amStart, count: amCount },
          { section: 'pm', startTime: pmStart, count: pmCount },
          { section: 'night', startTime: nightStart, count: nightCount },
        ],
      });
      await replaceTimeSlots(storage, semesterId, periods);
      logInfo('timetable', '生成课次', { periods: periods.length, duration, gap });
      toast.success(`已生成 ${periods.length} 节课次`);
      await reload();
      onChanged();
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function append(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const created = await appendTimeSlot(storage, semesterId, duration, gap);
      logInfo('timetable', '追加课次', { periodNo: created['period_no'], startTime: created['start_time'] });
      toast.success(`已添加第 ${created['period_no']} 节`);
      await reload();
      onChanged();
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(periodNo: number): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await deleteTimeSlot(storage, semesterId, periodNo);
      if (!result.deleted) {
        setMessage(
          result.usedBy > 0
            ? `第 ${periodNo} 节被 ${result.usedBy} 条排课使用，请先调整这些课程的节次`
            : `第 ${periodNo} 节不存在`,
        );
        return;
      }
      logInfo('timetable', '删除课次', { periodNo });
      await reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle className="flex items-center gap-2">
        <CalendarRange className="size-4" aria-hidden />
        时间表
      </CardTitle>

      <div className="grid gap-2 tablet:grid-cols-2">
        <Field label="固定上课时长（分钟）">
          <Input
            type="number"
            min={10}
            max={240}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </Field>
        <Field label="课间间隔（分钟）">
          <Input
            type="number"
            min={0}
            max={120}
            value={gap}
            onChange={(event) => setGap(Number(event.target.value))}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted">
          <span>时段</span>
          <span>第一节开始</span>
          <span>节数</span>
        </div>
        {[
          { label: SECTION_LABEL.am, start: amStart, setStart: setAmStart, count: amCount, setCount: setAmCount },
          { label: SECTION_LABEL.pm, start: pmStart, setStart: setPmStart, count: pmCount, setCount: setPmCount },
          {
            label: SECTION_LABEL.night,
            start: nightStart,
            setStart: setNightStart,
            count: nightCount,
            setCount: setNightCount,
          },
        ].map((block) => (
          <div key={block.label} className="grid grid-cols-3 items-center gap-2">
            <span className="text-sm text-ink">{block.label}</span>
            <Input type="time" value={block.start} onChange={(event) => block.setStart(event.target.value)} />
            <Input
              type="number"
              min={0}
              max={20}
              value={block.count}
              aria-label={`${block.label}节数`}
              onChange={(event) => block.setCount(Number(event.target.value))}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void generate()}>
          <Wand2 className="size-4" aria-hidden />
          自动生成课次
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void append()}>
          <Plus className="size-4" aria-hidden />
          追加一节
        </Button>
      </div>
      {message !== null && <span className="text-xs text-danger-strong">{message}</span>}

      <ul className="flex flex-col gap-1">
        {slots.map((slot) => (
          <li key={slot.id} className="flex min-h-tap items-center justify-between gap-2 text-sm">
            <span className="tabular text-ink">
              第 {slot.period_no} 节 · {slot.start_time}–{slot.end_time}
              <span className="ml-2 text-xs text-muted">{SECTION_LABEL[slot.section ?? 'am']}</span>
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`删除第 ${slot.period_no} 节`}
              disabled={busy}
              onClick={() => void remove(slot.period_no)}
            >
              <Trash2 className="size-4 text-danger-strong" aria-hidden />
            </Button>
          </li>
        ))}
        {slots.length === 0 && <li className="text-xs text-muted">还没有课次，先点「自动生成课次」</li>}
      </ul>
    </Card>
  );
}
