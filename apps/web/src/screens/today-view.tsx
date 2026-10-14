import { MapPin, Timer } from 'lucide-react';
import { formatTime } from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { Countdown } from '../components/countdown.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { cn } from '../lib/cn.ts';
import { formatRemaining } from '../lib/format.ts';
import { useNowTick } from '../lib/use-now.ts';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function dateLabel(date: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = WEEKDAYS[(new Date(Date.UTC(year as number, (month as number) - 1, day as number)).getUTCDay() + 6) % 7];
  return `${month} 月 ${day} 日 ${weekday}`;
}

export function TodayView({ data }: { data: AppData }) {
  const now = useNowTick(1000);
  const current = data.currentLesson;
  const next = data.nextLesson;
  const nextIsToday = next !== undefined && data.todayLessons.some((item) => item.startAt === next.startAt);

  return (
    <section className="flex flex-col gap-3" aria-label="今日视图">
      <div className="flex flex-col gap-1">
        <span className="text-lg font-semibold text-ink">今天 {dateLabel(data.today, data.timeZone)}</span>
        <span className="text-xs text-muted">
          第 {data.week} 周 · {data.todayLessons.length} 节课
        </span>
      </div>

      {current !== undefined && (
        <div
          className="flex flex-col gap-1 rounded-lg border border-primary-strong bg-surface p-4 shadow-sm"
          data-role="today-current"
        >
          <span className="flex items-center gap-2 text-xs text-muted">
            <Timer className="size-3" aria-hidden />
            正在上课
          </span>
          <span className="text-base font-semibold text-ink">{current.courseName}</span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="tabular text-xl text-primary-strong" data-role="today-current-remaining">
              剩余 {formatRemaining(current.endAt, now)}
            </span>
            <span className="tabular text-xs text-muted">
              {formatTime(current.startAt, data.timeZone)}–{formatTime(current.endAt, data.timeZone)}
              {current.room !== null && ` · ${current.room}`}
            </span>
          </div>
        </div>
      )}

      {nextIsToday && next !== undefined && current === undefined && (
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 shadow-sm">
          <span className="flex items-center gap-2 text-xs text-muted">
            <Timer className="size-3" aria-hidden />
            下一节课
          </span>
          <span className="text-base font-semibold text-ink">{next.courseName}</span>
          <div className="flex flex-wrap items-center gap-3">
            <Countdown target={next.startAt} className="text-xl text-primary-strong" />
            <span className="tabular text-xs text-muted">
              {formatTime(next.startAt, data.timeZone)}–{formatTime(next.endAt, data.timeZone)}
              {next.room !== null && ` · ${next.room}`}
            </span>
          </div>
        </div>
      )}

      {data.todayLessons.length === 0 ? (
        <EmptyState title="今天没有课" description="可切换到周视图查看本周安排" />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.todayLessons.map((lesson) => {
            const isNext = nextIsToday && next !== undefined && next.startAt === lesson.startAt;
            const running = lesson.startAt <= now && lesson.endAt > now;
            const finished = lesson.endAt <= now;
            return (
              <li
                key={`${lesson.scheduleId}-${lesson.startAt}`}
                className={cn(
                  'flex items-center gap-3 rounded-lg border bg-surface p-3',
                  isNext || running ? 'border-primary-strong shadow-sm' : 'border-line',
                  finished && 'opacity-60',
                )}
                style={{ borderLeft: `4px solid ${lesson.color}` }}
              >
                <div className="tabular flex w-24 shrink-0 flex-col text-xs text-ink">
                  <span>{formatTime(lesson.startAt, data.timeZone)}</span>
                  <span className="text-muted">{formatTime(lesson.endAt, data.timeZone)}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{lesson.courseName}</span>
                  <span className="flex items-center gap-2 truncate text-xs text-muted">
                    第 {lesson.periodStart}
                    {lesson.periodEnd > lesson.periodStart ? `-${lesson.periodEnd}` : ''} 节
                    {lesson.room !== null && (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden />
                        {lesson.room}
                      </span>
                    )}
                  </span>
                </div>
                {running ? (
                  <span className="tabular text-sm text-primary-strong" data-role="today-running-remaining">
                    剩余 {formatRemaining(lesson.endAt, now)}
                  </span>
                ) : (
                  isNext && <Countdown target={lesson.startAt} short className="text-sm text-primary-strong" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
