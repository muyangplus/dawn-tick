import { CalendarClock, GraduationCap, ListChecks, MapPin } from 'lucide-react';
import { formatDate, formatTime, updateEvent, type EventRow, type Storage } from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { Countdown } from '../components/countdown.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { Card } from '../components/ui/card.tsx';
import { Button } from '../components/ui/button.tsx';
import { formatDayCountdown } from '../lib/format.ts';
import { cn } from '../lib/cn.ts';

export interface ScheduleViewProps {
  data: AppData;
  storage: Storage;
  onChanged: () => void;
}

function groupKey(event: EventRow): string {
  if (event.due_at !== null && event.due_at !== undefined) {
    return new Date(event.due_at).toISOString().slice(0, 10);
  }
  return event.on_date ?? '未排期';
}

export function ScheduleView({ data, storage, onChanged }: ScheduleViewProps) {
  const now = Date.now();
  const groups = new Map<string, EventRow[]>();
  for (const todo of data.todos) {
    const key = groupKey(todo);
    const list = groups.get(key) ?? [];
    list.push(todo);
    groups.set(key, list);
  }
  const sortedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));

  async function toggleDone(event: EventRow): Promise<void> {
    await updateEvent(storage, event.id, { done: event.done === 1 ? 0 : 1 });
    onChanged();
  }

  return (
    <section className="flex flex-col gap-4" aria-label="日程视图">
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarClock className="size-4" aria-hidden />
          今日课程
        </span>
        {data.todayLessons.length === 0 ? (
          <EmptyState icon={CalendarClock} title="今天没有课" description="可在周视图查看本周安排" />
        ) : (
          <ul className="flex flex-col gap-1">
            {data.todayLessons.map((lesson) => (
              <li
                key={`${lesson.scheduleId}-${lesson.startAt}`}
                className="flex min-h-tap items-center gap-3 rounded-md border border-line bg-surface px-3"
                style={{ borderLeft: `4px solid ${lesson.color}` }}
              >
                <span className="tabular flex w-24 shrink-0 flex-col text-xs text-ink">
                  <span>{formatTime(lesson.startAt, data.timeZone)}</span>
                  <span className="text-muted">{formatTime(lesson.endAt, data.timeZone)}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-ink">{lesson.courseName}</span>
                  <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted">
                    第 {lesson.periodStart}
                    {lesson.periodEnd > lesson.periodStart ? `-${lesson.periodEnd}` : ''} 节
                    {lesson.room !== null && (
                      <>
                        <MapPin className="size-3 shrink-0" aria-hidden />
                        <span className="min-w-0 truncate">{lesson.room}</span>
                      </>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <GraduationCap className="size-4" aria-hidden />
          考试倒计时
        </span>
        {data.exams.length === 0 ? (
          <EmptyState icon={GraduationCap} title="暂无考试安排" />
        ) : (
          <div className="grid gap-2 tablet:grid-cols-2">
            {data.exams.map((exam) => (
              <Card key={exam.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{exam.title}</span>
                  <span className="truncate text-xs text-muted">
                    {exam.on_date ?? (exam.start_at === null ? '' : formatDate(exam.start_at, data.timeZone))}
                    {exam.location !== null && ` · ${exam.location}`}
                    {exam.seat_no !== null && ` · 座位 ${exam.seat_no}`}
                  </span>
                </div>
                {exam.start_at !== null && (
                  <span className="tabular shrink-0 text-sm font-semibold text-danger-strong">
                    {formatDayCountdown(exam.start_at, now)}
                  </span>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ListChecks className="size-4" aria-hidden />
          待办
        </span>
        {sortedGroups.length === 0 ? (
          <EmptyState icon={ListChecks} title="暂无待办" description="用右下角按钮添加待办或临时日程" />
        ) : (
          sortedGroups.map(([date, items]) => (
            <div key={date} className="flex flex-col gap-1">
              <span className="text-xs text-muted">{date}</span>
              <ul className="flex flex-col gap-1">
                {items.map((todo) => (
                  <li
                    key={todo.id}
                    className={cn(
                      'flex min-h-tap items-center gap-3 rounded-md border border-line bg-surface px-3',
                      todo.done === 1 && 'opacity-60',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={todo.done === 1}
                      aria-label={`标记完成：${todo.title}`}
                      onChange={() => void toggleDone(todo)}
                    />
                    <span className={cn('flex min-w-0 flex-col', todo.done === 1 && 'line-through')}>
                      <span className="truncate text-sm text-ink">{todo.title}</span>
                      {todo.note !== null && <span className="truncate text-xs text-muted">{todo.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarClock className="size-4" aria-hidden />
          调课与临时日程
        </span>
        {data.reschedules.length === 0 ? (
          <EmptyState icon={CalendarClock} title="本周没有调课" />
        ) : (
          <ul className="flex flex-col gap-1">
            {data.reschedules.map((item) => (
              <li
                key={item.id}
                className="flex min-h-tap items-center justify-between gap-2 rounded-md border border-line bg-surface px-3"
              >
                <span className="truncate text-sm text-ink">{item.title}</span>
                <span className="tabular shrink-0 text-xs text-muted">
                  {item.on_date}
                  {item.action === 'cancel'
                    ? ' · 停课'
                    : item.new_date !== null
                      ? ` · 改至 ${item.new_date} 第 ${item.new_period_start ?? ''}-${item.new_period_end ?? ''} 节`
                      : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button variant="secondary" size="sm" onClick={() => onChanged()}>
        刷新
      </Button>
    </section>
  );
}
