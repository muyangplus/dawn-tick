import { CalendarDays, MapPin, Timer } from 'lucide-react';
import { formatTime, weekOfDate, type Occurrence } from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { Countdown } from '../components/countdown.tsx';
import { Button } from '../components/ui/button.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { cn } from '../lib/cn.ts';
import { formatPeriodRange, formatRemaining } from '../lib/format.ts';
import { useNowTick } from '../lib/use-now.ts';

export interface TodayViewProps {
  data: AppData;
  /** 日模式查看的日期（YYYY-MM-DD）：顶部日期翻页决定 */
  date: string;
  /** 查看的是不是今天：只有今天才显示「正在上课」「下一节课」 */
  isToday: boolean;
  /** 空态主按钮：切回周视图看本周安排（由上层提供；没有入口时不渲染按钮） */
  onOpenWeek?: () => void;
  /** 课程行可点：点开当天这次课的详情（详情里有调课入口，与周视图同一条路径） */
  onSelectLesson: (lesson: Occurrence) => void;
}

export function TodayView({ data, date, isToday, onOpenWeek, onSelectLesson }: TodayViewProps) {
  const now = useNowTick(1000);
  const lessons = data.lessonsByDate.get(date) ?? [];
  const current = isToday ? data.currentLesson : undefined;
  const next = isToday ? data.nextLesson : undefined;
  const nextIsToday = next !== undefined && lessons.some((item) => item.startAt === next.startAt);
  const week = data.semester === null ? 0 : weekOfDate(date, data.semester.start_date);
  const inSemester = data.semester !== null && week >= 1 && week <= data.semester.total_weeks;

  return (
    <section className="flex flex-col gap-3" aria-label="日视图">
      <span className="text-xs text-muted">
        {inSemester ? `第 ${week} 周 · ${lessons.length} 节课` : `${lessons.length} 节课`}
      </span>

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

      {lessons.length === 0 ? (
        <div data-role="day-empty">
          <EmptyState
            icon={CalendarDays}
            title={isToday ? '今天没有课' : '这一天没有课'}
            description="切换周视图可看本周安排"
            action={
              onOpenWeek === undefined ? undefined : (
                <Button size="sm" variant="secondary" aria-label="查看周视图" onClick={onOpenWeek}>
                  查看周视图
                </Button>
              )
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {lessons.map((lesson) => {
            const isNext = nextIsToday && next !== undefined && next.startAt === lesson.startAt;
            const running = lesson.startAt <= now && lesson.endAt > now;
            const finished = lesson.endAt <= now;
            return (
              // 课程行整体可点：鼠标、触控与键盘（Enter / Space）都打开同一次课的详情，
              // 调课在详情里操作，与周视图的「点课程卡 → 调课」是同一条路径。
              <li
                key={`${lesson.scheduleId}-${lesson.startAt}`}
                role="button"
                tabIndex={0}
                aria-label={`查看课程详情：${lesson.courseName}`}
                data-role="day-lesson"
                className={cn(
                  'flex min-h-tap cursor-pointer items-center gap-3 rounded-lg border bg-surface p-3 text-left',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong focus-visible:ring-offset-2 focus-visible:ring-offset-page',
                  isNext || running ? 'border-primary-strong shadow-sm' : 'border-line',
                  finished && 'opacity-60',
                )}
                style={{ borderLeft: `4px solid ${lesson.color}` }}
                onClick={() => onSelectLesson(lesson)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSelectLesson(lesson);
                }}
              >
                <div className="tabular flex w-24 shrink-0 flex-col text-xs text-ink">
                  <span>{formatTime(lesson.startAt, data.timeZone)}</span>
                  <span className="text-muted">{formatTime(lesson.endAt, data.timeZone)}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{lesson.courseName}</span>
                  <span className="flex items-center gap-2 truncate text-xs text-muted">
                    {formatPeriodRange(lesson.periodStart, lesson.periodEnd)}
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
