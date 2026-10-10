import { useState } from 'react';
import { addDays, createSemester, formatDate, weekStart, type Storage } from '@dawn-tick/core';

interface Props {
  storage: Storage;
  userId: string;
  timeZone: string;
  onDone: () => void;
}

export function Onboarding({ storage, userId, timeZone, onDone }: Props) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => weekStart(formatDate(Date.now(), timeZone)));
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
      onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <h1 className="title">新建学期</h1>
      <div className="card form">
        <label className="field">
          <span>学期名称</span>
          <input
            value={name}
            placeholder="2026-2027 第一学期"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>开学日期（该周记为第 1 周）</span>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="field">
          <span>总周数</span>
          <input
            type="number"
            min={1}
            max={30}
            value={totalWeeks}
            onChange={(event) => setTotalWeeks(Number(event.target.value))}
          />
        </label>
        <div className="row">
          <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
            创建
          </button>
          <button
            type="button"
            onClick={() => setStartDate(addDays(weekStart(formatDate(Date.now(), timeZone)), 7))}
          >
            下周一
          </button>
        </div>
        {error !== null && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
