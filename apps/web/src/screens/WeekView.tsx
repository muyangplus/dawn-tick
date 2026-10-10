import { useState } from 'react';
import {
  deleteCourse,
  deleteSchedule,
  formatTime,
  type CourseRow,
  type CourseScheduleRow,
  type Storage,
} from '@dawn-tick/core';
import type { AppData, LessonCell } from '../data.ts';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

interface Props {
  storage: Storage;
  data: AppData;
  viewDays: number;
  timeZone: string;
  onChanged: () => void;
}

interface Detail {
  cell: LessonCell;
  course: CourseRow | undefined;
  schedules: CourseScheduleRow[];
}

export function WeekView({ storage, data, viewDays, timeZone, onChanged }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(cell: LessonCell): Promise<void> {
    const course = await storage.collection<CourseRow>('courses').get(cell.courseId);
    const all = await storage.collection<CourseScheduleRow>('course_schedules').getAll();
    setDetail({
      cell,
      course,
      schedules: all.filter((row) => row.course_id === cell.courseId && row.deleted_at === null),
    });
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
                  {WEEKDAYS[(row.day_of_week ?? 1) - 1]} 第 {row.period_start}-{row.period_end} 节 · {row.weeks_raw ?? '—'}
                </div>
              ))}
            </div>
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
            {data.todayLessons.length > 0 && (
              <div className="muted">
                第一节课 {formatTime(data.todayLessons[0]?.startAt ?? 0, timeZone)}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
