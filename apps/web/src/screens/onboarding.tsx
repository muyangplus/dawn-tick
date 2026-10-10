import { useState } from 'react';
import { addDays, createSemester, formatDate, weekStart, type Storage } from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { Card, CardTitle } from '../components/ui/card.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { toast } from '../components/ui/toaster.tsx';

export interface OnboardingProps {
  storage: Storage;
  userId: string;
  timeZone: string;
  onDone: () => void;
}

export function Onboarding({ storage, userId, timeZone, onDone }: OnboardingProps) {
  const today = formatDate(Date.now(), timeZone);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => weekStart(today));
  const [totalWeeks, setTotalWeeks] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await createSemester(storage, {
        userId,
        name: name.trim().length > 0 ? name.trim() : '我的学期',
        startDate,
        totalWeeks,
        timeZone,
      });
      toast.success('学期已创建');
      onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-page p-4">
      <div className="w-full max-w-md">
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>欢迎使用晓刻 DawnTick</CardTitle>
            <span className="text-xs text-muted">先创建学期，课表按周次计算</span>
          </div>
          <Field label="学期名称">
            <Input
              value={name}
              placeholder="2026-2027 第一学期"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="开学日期" hint="该周记为第 1 周">
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label="总周数">
            <Input
              type="number"
              min={1}
              max={30}
              value={totalWeeks}
              onChange={(event) => setTotalWeeks(Number(event.target.value))}
            />
          </Field>
          {error !== null && <p className="text-xs text-danger-strong">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              创建并开始
            </Button>
            <Button
              variant="secondary"
              onClick={() => setStartDate(addDays(weekStart(formatDate(Date.now(), timeZone)), 7))}
            >
              下周一开学
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
