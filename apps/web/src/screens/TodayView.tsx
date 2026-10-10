import { formatTime } from '@dawn-tick/core';
import type { AppData } from '../data.ts';

interface Props {
  data: AppData;
  timeZone: string;
}

export function TodayView({ data, timeZone }: Props) {
  if (data.todayLessons.length === 0) {
    return <p className="empty">{data.today}</p>;
  }

  return (
    <div className="list">
      {data.todayLessons.map((lesson) => (
        <div key={`${lesson.scheduleId}-${lesson.date}`} className="card row">
          <span
            style={{
              width: 4,
              alignSelf: 'stretch',
              borderRadius: 2,
              background: lesson.color,
            }}
          />
          <span style={{ flex: 1 }}>
            <strong>{lesson.courseName}</strong>
            <span className="muted">
              {' '}
              {formatTime(lesson.startAt, timeZone)}–{formatTime(lesson.endAt, timeZone)} · 第 {lesson.periodStart}
              {lesson.periodEnd > lesson.periodStart ? `-${lesson.periodEnd}` : ''} 节
              {lesson.room !== null ? ` · ${lesson.room}` : ''}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
