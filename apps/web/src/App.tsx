import { useEffect, useState } from 'react';
import {
  activeSemester,
  dayOfWeek,
  formatDate,
  resolveTimeZone,
  weekOfDate,
  weekView,
  type SemesterRow,
  type SqlDriver,
  type TimeSlotRow,
  type WeekViewRow,
} from '@dawn-tick/core';
import { openWebDatabase, type WebDatabase } from './db/driver.ts';
import { SAMPLE_SEMESTER, SAMPLE_USER, seedSample } from './db/sample.ts';
import './styles.css';

const VIEW_DAYS = 5;

interface Cell {
  name: string;
  room: string | null;
  color: string;
}

interface Screen {
  engine: string;
  storage: WebDatabase['storage'];
  semester: SemesterRow | null;
  week: number;
  today: string;
  slots: TimeSlotRow[];
  grid: Map<string, Cell[]>;
}

function buildGrid(db: SqlDriver, semester: SemesterRow, week: number, slots: TimeSlotRow[]): Map<string, Cell[]> {
  const grid = new Map<string, Cell[]>();
  for (let day = 1; day <= VIEW_DAYS; day += 1) {
    for (const row of weekView(db, semester.id, day, week)) {
      for (let period = row.period_start; period <= row.period_end; period += 1) {
        const key = `${day}:${period}`;
        const list = grid.get(key) ?? [];
        list.push({ name: row.short_name ?? row.name, room: row.room, color: row.color });
        grid.set(key, list);
      }
    }
  }
  return grid;
}

export function App() {
  const [database, setDatabase] = useState<WebDatabase | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh(db: WebDatabase): void {
    const timeZone = resolveTimeZone(undefined, false);
    const today = formatDate(Date.now(), timeZone);
    const semester = activeSemester(db.driver, SAMPLE_USER) ?? null;
    if (semester === null) {
      setScreen({
        engine: db.engine,
        storage: db.storage,
        semester: null,
        week: 1,
        today,
        slots: [],
        grid: new Map(),
      });
      return;
    }
    const slots = db.driver.all<TimeSlotRow>(
      'SELECT * FROM time_slots WHERE semester_id = ? AND deleted_at IS NULL ORDER BY period_no',
      [semester.id],
    );
    const week = Math.max(1, weekOfDate(today, semester.start_date));
    setScreen({
      engine: db.engine,
      storage: db.storage,
      semester,
      week,
      today,
      slots,
      grid: buildGrid(db.driver, semester, week, slots),
    });
  }

  useEffect(() => {
    let cancelled = false;
    openWebDatabase()
      .then((db) => {
        if (cancelled) return;
        setDatabase(db);
        refresh(db);
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

  if (database === null || screen === null) {
    return (
      <main className="app">
        <p className="muted">SQLite</p>
      </main>
    );
  }

  if (screen.semester === null) {
    return (
      <main className="app">
        <button
          type="button"
          onClick={() => {
            seedSample(database.driver, '2026-09-07', 'Asia/Shanghai');
            refresh(database);
          }}
        >
          载入示例数据
        </button>
      </main>
    );
  }

  const todayOfWeek = dayOfWeek(screen.today);

  return (
    <main className="app">
      <header className="bar">
        <span className="title">{screen.semester.name}</span>
        <span className="muted">
          第 {screen.week} 周 · {SAMPLE_SEMESTER}
        </span>
      </header>
      <div className="grid">
        <div className="corner" />
        {Array.from({ length: VIEW_DAYS }, (_, index) => (
          <div key={`h-${index}`} className={index + 1 === todayOfWeek ? 'head today' : 'head'}>
            {['周一', '周二', '周三', '周四', '周五'][index]}
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
                      key={`cell-${cellIndex}`}
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
        <span className="muted">SQLite {screen.engine}</span>
        <span className="muted">{screen.storage === 'opfs' ? 'OPFS' : '内存'}</span>
      </footer>
    </main>
  );
}
