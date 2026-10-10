import { useState } from 'react';
import {
  createCourse,
  createSchedule,
  dayOfWeek,
  type Storage,
  type ThemePreset,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { THEMES } from '../theme.ts';

interface Props {
  storage: Storage;
  semesterId: string;
  semesterStart: string;
  totalWeeks: number;
  preset: ThemePreset;
  slots: TimeSlotRow[];
  onDone: () => void;
}

type WeekMode = 'all' | 'odd' | 'even' | 'range';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function weeksFor(mode: WeekMode, total: number, from: number, to: number): number[] {
  const out: number[] = [];
  if (mode === 'all') {
    for (let week = 1; week <= total; week += 1) out.push(week);
    return out;
  }
  if (mode === 'odd' || mode === 'even') {
    for (let week = mode === 'odd' ? 1 : 2; week <= total; week += 2) out.push(week);
    return out;
  }
  for (let week = from; week <= to; week += 1) out.push(week);
  return out;
}

export function CourseForm({ storage, semesterId, semesterStart, totalWeeks, preset, slots, onDone }: Props) {
  const [name, setName] = useState('');
  const [teacher, setTeacher] = useState('');
  const [location, setLocation] = useState('');
  const [dow, setDow] = useState(() => dayOfWeek(semesterStart));
  const [periodStart, setPeriodStart] = useState(slots[0]?.period_no ?? 1);
  const [periodEnd, setPeriodEnd] = useState(slots[0]?.period_no ?? 1);
  const [mode, setMode] = useState<WeekMode>('all');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(totalWeeks);
  const [colorIndex, setColorIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const palette = THEMES[preset].courses;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const course = await createCourse(storage, {
        semesterId,
        name: name.trim(),
        teacher: teacher.trim().length > 0 ? teacher.trim() : null,
        location: location.trim().length > 0 ? location.trim() : null,
        color: palette[colorIndex % palette.length] ?? '#4F8DFD',
      });
      const weeks = weeksFor(mode, totalWeeks, from, to);
      await createSchedule(storage, {
        courseId: String(course['id']),
        dayOfWeek: dow,
        periodStart,
        periodEnd: Math.max(periodStart, periodEnd),
        weeks,
      });
      onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onDone}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <strong>添加课程</strong>
        <label className="field">
          <span>课程名</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            <span>教师</span>
            <input value={teacher} onChange={(event) => setTeacher(event.target.value)} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>地点</span>
            <input value={location} onChange={(event) => setLocation(event.target.value)} />
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span>星期</span>
            <select value={dow} onChange={(event) => setDow(Number(event.target.value))}>
              {WEEKDAYS.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>起始节</span>
            <select value={periodStart} onChange={(event) => setPeriodStart(Number(event.target.value))}>
              {slots.map((slot) => (
                <option key={slot.period_no} value={slot.period_no}>
                  第 {slot.period_no} 节
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>结束节</span>
            <select value={periodEnd} onChange={(event) => setPeriodEnd(Number(event.target.value))}>
              {slots.map((slot) => (
                <option key={slot.period_no} value={slot.period_no}>
                  第 {slot.period_no} 节
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span>周次</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as WeekMode)}>
              <option value="all">全周</option>
              <option value="odd">单周</option>
              <option value="even">双周</option>
              <option value="range">指定范围</option>
            </select>
          </label>
          {mode === 'range' && (
            <>
              <label className="field">
                <span>起始周</span>
                <input
                  type="number"
                  min={1}
                  max={totalWeeks}
                  value={from}
                  onChange={(event) => setFrom(Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>结束周</span>
                <input
                  type="number"
                  min={1}
                  max={totalWeeks}
                  value={to}
                  onChange={(event) => setTo(Number(event.target.value))}
                />
              </label>
            </>
          )}
        </div>
        <div className="field">
          <span>颜色</span>
          <div className="swatches">
            {palette.map((color, index) => (
              <button
                key={color}
                type="button"
                className="swatch"
                aria-pressed={index === colorIndex}
                style={{ background: color }}
                onClick={() => setColorIndex(index)}
              />
            ))}
          </div>
        </div>
        {error !== null && <p className="error">{error}</p>}
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={busy || name.trim().length === 0}
            onClick={() => void submit()}
          >
            保存
          </button>
          <button type="button" onClick={onDone}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
