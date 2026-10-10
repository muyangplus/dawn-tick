import { useEffect, useState } from 'react';
import {
  activeSemester,
  dayOfWeek,
  formatDate,
  listTimeSlots,
  resolveTimeZone,
  weekOfDate,
  weekView,
  type SemesterRow,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { openIndexedDbStorage } from './db/idb-storage.ts';
import { SAMPLE_USER, seedSample } from './db/sample.ts';
import './styles.css';

const VIEW_DAYS = 5;
const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五'];

interface Cell {
  name: string;
  room: string | null;
  color: string;
}

interface Screen {
  kind: Storage['kind'];
  semester: SemesterRow | null;
  week: number;
  todayOfWeek: number;
  slots: TimeSlotRow[];
  grid: Map<string, Cell[]>;
}

async function loadScreen(storage: Storage): Promise<Screen> {
  const autoSync = (await storage.readMeta('auto_time_zone')) === '1';
  const timeZone = resolveTimeZone(await storage.readMeta('time_zone'), autoSync);
  const today = formatDate(Date.now(), timeZone);
  const semester = (await activeSemester(storage, SAMPLE_USER)) ?? null;
  if (semester === null) {
    return { kind: storage.kind, semester: null, week: 1, todayOfWeek: 0, slots: [], grid: new Map() };
  }

  const slots = await listTimeSlots(storage, semester.id);
  const week = Math.max(1, weekOfDate(today, semester.start_date));
  const grid = new Map<string, Cell[]>();
  for (let day = 1; day <= VIEW_DAYS; day += 1) {
    for (const row of await weekView(storage, semester.id, day, week)) {
      for (let period = row.period_start; period <= row.period_end; period += 1) {
        const key = `${day}:${period}`;
        const list = grid.get(key) ?? [];
        list.push({ name: row.short_name ?? row.name, room: row.room, color: row.color });
        grid.set(key, list);
      }
    }
  }
  return { kind: storage.kind, semester, week, todayOfWeek: dayOfWeek(today), slots, grid };
}

export function App() {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(target: Storage): Promise<void> {
    setScreen(await loadScreen(target));
  }

  useEffect(() => {
    let cancelled = false;
    openIndexedDbStorage()
      .then(async (opened) => {
        if (cancelled) return;
        setStorage(opened);
        await refresh(opened);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <main className="app">
        <p className="error">{error}</p>
      </main>
    );
  }

  if (storage === null || screen === null) {
    return <main className="app" />;
  }

  if (screen.semester === null) {
    return (
      <main className="app">
        <button
          type="button"
          onClick={() => {
            void (async () => {
              await seedSample(storage, '2026-09-07', 'Asia/Shanghai');
              await refresh(storage);
            })();
          }}
        >
          载入示例数据
        </button>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="bar">
        <span className="title">{screen.semester.name}</span>
        <span className="muted">第 {screen.week} 周</span>
      </header>
      <div className="grid">
        <div className="corner" />
        {WEEKDAY_LABELS.map((label, index) => (
          <div key={label} className={index + 1 === screen.todayOfWeek ? 'head today' : 'head'}>
            {label}
          </div>
        ))}
        {screen.slots.map((slot) => (
          <div key={`row-${slot.period_no}`} className="rowGroup">
            <div className="period">
              <span className="periodNo">{slot.period_no}</span>
              <span className="periodTime">{slot.start_time}</span>
            </div>
            {Array.from({ length: VIEW_DAYS }, (_, index) => {
              const cells = screen.grid.get(`${index + 1}:${slot.period_no}`) ?? [];
              return (
                <div key={`c-${slot.period_no}-${index}`} className="cell">
                  {cells.map((cell, cellIndex) => (
                    <span
                      key={`${cell.name}-${cellIndex}`}
                      className="lesson"
                      style={{ borderLeftColor: cell.color }}
                      title={cell.room ?? ''}
                    >
                      {cell.name}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <footer className="bar">
        <span className="muted">{screen.semester.time_zone}</span>
        <span className="muted">{screen.kind}</span>
      </footer>
    </main>
  );
}
