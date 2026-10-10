import { useState } from 'react';
import {
  deleteCourse,
  deleteReminder,
  deleteSchedule,
  setReminder,
  type CourseRow,
  type CourseScheduleRow,
  type ReminderRow,
  type Storage,
} from '@dawn-tick/core';
import type { AppData, LessonCell } from '../data.ts';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const ADVANCE_OPTIONS = [5, 10, 15, 30];

interface Props {
  storage: Storage;
  userId: string;
  data: AppData;
  viewDays: number;
  onChanged: () => void;
}

interface Detail {
  cell: LessonCell;
  course: CourseRow | undefined;
  schedules: CourseScheduleRow[];
  reminder: ReminderRow | undefined;
}

export function WeekView({ storage, userId, data, viewDays, onChanged }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [advance, setAdvance] = useState(10);
  const [custom, setCustom] = useState(false);
  const [skipHolidays, setSkipHolidays] = useState(true);
  const [snooze, setSnooze] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function open(cell: LessonCell): Promise<void> {
    const [course, all, reminders] = await Promise.all([
      storage.collection<CourseRow>('courses').get(cell.courseId),
      storage.collection<CourseScheduleRow>('course_schedules').getAll(),
      storage.collection<ReminderRow>('reminders').getAll(),
    ]);
    const reminder = reminders.find(
      (row) => row.deleted_at === null && row.target_type === 'course' && row.target_id === cell.courseId,
    );
    setAdvance(reminder?.advance_minutes ?? 10);
    setCustom(reminder !== undefined && !ADVANCE_OPTIONS.includes(reminder.advance_minutes));
    setSkipHolidays((reminder?.skip_holidays ?? 1) === 1);
    setSnooze(reminder?.snooze_minutes !== null && reminder?.snooze_minutes !== undefined);
    setMessage(null);
    setDetail({
      cell,
      course,
      schedules: all.filter((row) => row.course_id === cell.courseId && row.deleted_at === null),
      reminder,
    });
  }

  async function refreshDetail(): Promise<void> {
    if (detail === null) return;
    const reminders = await storage.collection<ReminderRow>('reminders').getAll();
    const reminder = reminders.find(
      (row) =>
        row.deleted_at === null &&
        row.target_type === 'course' &&
        row.target_id === detail.cell.courseId,
    );
    setDetail({ ...detail, reminder });
  }

  async function saveReminder(): Promise<void> {
    if (detail === null) return;
    setBusy(true);
    try {
      await setReminder(storage, {
        userId,
        targetType: 'course',
        targetId: detail.cell.courseId,
        advanceMinutes: advance,
        skipHolidays,
        snoozeMinutes: snooze ? 5 : null,
      });
      await refreshDetail();
      setMessage(`已设置课前 ${advance} 分钟提醒`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeReminder(): Promise<void> {
    if (detail?.reminder === undefined) return;
    setBusy(true);
    try {
      await deleteReminder(storage, detail.reminder.id);
      await refreshDetail();
      setMessage('已删除提醒');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeSchedule(id: string): Promise<void> {
    setBusy(true);
    try {
      await deleteSchedule(storage, id);
      setDetail(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeCourse(id: string): Promise<void> {
    setBusy(true);
    try {
      await deleteCourse(storage, id);
      setDetail(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="grid" style={{ ['--days' as string]: String(viewDays) }}>
        <div className="corner" />
        {WEEKDAYS.slice(0, viewDays).map((label, index) => (
          <div key={label} className={index + 1 === data.todayOfWeek ? 'head today' : 'head'}>
            {label}
          </div>
        ))}
        {data.slots.map((slot) => (
          <div key={`row-${slot.period_no}`} className="rowGroup">
            <div className="period">
              <span className="periodNo">{slot.period_no}</span>
              <span>{slot.start_time}</span>
            </div>
            {Array.from({ length: viewDays }, (_, index) => {
              const cells = data.grid.get(`${index + 1}:${slot.period_no}`) ?? [];
              return (
                <div key={`c-${slot.period_no}-${index}`} className="cell">
                  {cells.map((cell) => (
                    <button
                      key={`${cell.courseId}-${cell.periodStart}`}
                      type="button"
                      className="lesson"
                      style={{ borderLeftColor: cell.color }}
                      onClick={() => void open(cell)}
                    >
                      {cell.name}
                      {cell.room !== null && <span className="room">{cell.room}</span>}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {data.grid.size === 0 && <p className="empty">本学期还没有课程，可用右上角添加或导入</p>}

      {detail !== null && (
        <div className="dialog-backdrop" onClick={() => setDetail(null)}>
          <div className="dialog" onClick={(event) => event.stopPropagation()}>
            <strong>{detail.course?.name ?? detail.cell.name}</strong>
            <div className="muted">
              {detail.course?.teacher ?? '未填教师'} · {detail.cell.room ?? '未填地点'}
            </div>
            <div className="muted">
              {detail.schedules.map((row) => (
                <div key={row.id}>
                  {WEEKDAYS[(row.day_of_week ?? 1) - 1]} 第 {row.period_start}-{row.period_end} 节 ·{' '}
                  {row.weeks_raw ?? '—'}
                </div>
              ))}
            </div>

            <div className="field">
              <span>课前提醒（分钟）</span>
              <div className="row">
                {ADVANCE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={!custom && advance === option}
                    className={!custom && advance === option ? 'primary' : ''}
                    onClick={() => {
                      setCustom(false);
                      setAdvance(option);
                    }}
                  >
                    {option}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={custom}
                  className={custom ? 'primary' : ''}
                  onClick={() => setCustom(true)}
                >
                  自定义
                </button>
              </div>
              {custom && (
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={advance}
                  onChange={(event) => setAdvance(Number(event.target.value))}
                />
              )}
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={skipHolidays}
                onChange={(event) => setSkipHolidays(event.target.checked)}
              />
              <span>放假当天不提醒</span>
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={snooze}
                onChange={(event) => setSnooze(event.target.checked)}
              />
              <span>允许贪睡 5 分钟</span>
            </label>
            <div className="row">
              <button type="button" className="primary" disabled={busy} onClick={() => void saveReminder()}>
                保存提醒
              </button>
              {detail.reminder !== undefined && (
                <button type="button" disabled={busy} onClick={() => void removeReminder()}>
                  删除提醒
                </button>
              )}
            </div>
            {detail.reminder !== undefined && (
              <div className="muted">当前：课前 {detail.reminder.advance_minutes} 分钟</div>
            )}
            {message !== null && <div className="muted">{message}</div>}

            {detail.schedules.length > 0 && (
              <div className="row">
                {detail.schedules.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void removeSchedule(row.id)}
                  >
                    删除该排课
                  </button>
                ))}
              </div>
            )}
            <div className="row">
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeCourse(detail.cell.courseId)}
              >
                删除整门课
              </button>
              <button type="button" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
