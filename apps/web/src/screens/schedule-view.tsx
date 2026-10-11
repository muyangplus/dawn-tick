import { CalendarClock, GraduationCap, ListChecks, MapPin, Trophy } from 'lucide-react';
import { useState } from 'react';
import { formatDate, formatTime, updateEvent, type EventRow, type Storage } from '@dawn-tick/core';
import type { AppData } from '../data.ts';
import { AdjustDialog, type AdjustTarget } from '../components/adjust-dialog.tsx';
import { Countdown } from '../components/countdown.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { Card } from '../components/ui/card.tsx';
import { Button } from '../components/ui/button.tsx';
import { formatDayCountdown } from '../lib/format.ts';
import { cn } from '../lib/cn.ts';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export interface ScheduleViewProps {
  data: AppData;
  storage: Storage;
  onChanged: () => void;
  onAddTodo: () => void;
  onAddExam: () => void;
}

interface TimelineItem {
  key: string;
  /** 所属日期；null 表示未排期 */
  date: string | null;
  /** 当天排序用的分钟数 */
  minute: number;
  /** 同一天内的先后：课程 → 调课/调休 → 待办 */
  rank: number;
  kind: 'lesson' | 'adjust' | 'todo';
  title: string;
  detail: string;
  color?: string;
  done?: boolean;
  event?: EventRow;
  lessonTarget?: AdjustTarget;
}

function dateLabel(date: string | null, timeZone: string): string {
  if (date === null) return '未排期';
  const [year, month, day] = date.split('-').map(Number);
  const weekday =
    WEEKDAYS[(new Date(Date.UTC(year as number, (month as number) - 1, day as number)).getUTCDay() + 6) % 7];
  void timeZone;
  return `${month} 月 ${day} 日 ${weekday}`;
}

function minuteOf(epoch: number | null, timeZone: string): number {
  if (epoch === null) return 0;
  const [hour, minute] = formatTime(epoch, timeZone).split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function buildTimeline(data: AppData): TimelineItem[] {  const items: TimelineItem[] = [];

  for (const lesson of data.todayLessons) {
    items.push({
      key: `lesson-${lesson.scheduleId}-${lesson.startAt}`,
      date: lesson.date,
      minute: minuteOf(lesson.startAt, data.timeZone),
      rank: 0,
      kind: 'lesson',
      title: lesson.courseName,
      detail: `第 ${lesson.periodStart}${lesson.periodEnd > lesson.periodStart ? `-${lesson.periodEnd}` : ''} 节${
        lesson.room === null ? '' : ` · ${lesson.room}`
      }`,
      color: lesson.color,
      lessonTarget: {
        scheduleId: lesson.scheduleId,
        courseId: lesson.courseId,
        courseName: lesson.courseName,
        date: lesson.date,
        periodStart: lesson.periodStart,
        periodEnd: lesson.periodEnd,
      },
    });
  }

  for (const item of data.reschedules) {
    const date = item.on_date ?? null;
    const detail =
      item.type === 'makeup'
        ? '调休'
        : item.action === 'cancel'
          ? '停课'
          : item.new_date !== null
            ? `改至 ${item.new_date} 第 ${item.new_period_start ?? ''}-${item.new_period_end ?? ''} 节`
            : '调课';
    items.push({
      key: `adjust-${item.id}`,
      date,
      minute: 0,
      rank: 1,
      kind: 'adjust',
      title: item.title,
      detail,
      event: item,
    });
  }

  for (const todo of data.todos) {
    const date =
      todo.on_date ?? (todo.due_at === null || todo.due_at === undefined ? null : formatDate(todo.due_at, data.timeZone));
    const linkedCourse = data.courses.find((course) => course.id === todo.subject);
    const parts: string[] = [];
    if (linkedCourse !== undefined) parts.push(linkedCourse.name);
    if (todo.due_at !== null && todo.due_at !== undefined && todo.due_at > Date.now()) {
      parts.push(formatDayCountdown(todo.due_at, Date.now()));
    }
    if (todo.note !== null && todo.note.length > 0) parts.push(todo.note);
    items.push({
      key: `todo-${todo.id}`,
      date,
      minute: minuteOf(todo.due_at ?? null, data.timeZone),
      rank: 2,
      kind: 'todo',
      title: todo.title,
      detail: parts.join(' · '),
      done: todo.done === 1,
      event: todo,
    });
  }

  return items.sort((left, right) => {
    const leftDate = left.date ?? '9999-99-99';
    const rightDate = right.date ?? '9999-99-99';
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    if (left.rank !== right.rank) return left.rank - right.rank;
    return left.minute - right.minute;
  });
}

/** 日程页：考试倒计时 + 按时间顺序合并的课程、调课与日程。 */
export function ScheduleView({ data, storage, onChanged, onAddTodo, onAddExam }: ScheduleViewProps) {
  const now = Date.now();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);
  const timeline = buildTimeline(data);

  const groups: Array<{ date: string | null; items: TimelineItem[] }> = [];
  for (const item of timeline) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, items: [item] });
  }

  async function toggleDone(event: EventRow): Promise<void> {
    await updateEvent(storage, event.id, { done: event.done === 1 ? 0 : 1 });
    onChanged();
  }

  return (
    <section className="flex flex-col gap-4" aria-label="日程视图">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onAddTodo}>
          加日程
        </Button>
        <Button variant="secondary" size="sm" onClick={onAddExam}>
          加考试
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setAdjustTarget(null);
            setAdjustOpen(true);
          }}
        >
          课程调整
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <GraduationCap className="size-4" aria-hidden />
          考试倒计时
        </span>
        {data.exams.length === 0 ? (
          <EmptyState icon={GraduationCap} title="暂无考试安排" description="用上方「加考试」录入考试时间" />
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

      <div className="flex flex-col gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarClock className="size-4" aria-hidden />
          日程
        </span>
        {data.holidays.includes(data.today) && <span className="text-xs text-muted">今天放假，课程不排</span>}
        {groups.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="暂无日程"
            description="用上方按钮加日程，或到课表页添加课程"
          />
        ) : (
          groups.map((group) => (
            <div key={group.date ?? 'undated'} className="flex flex-col gap-1">
              <span className="text-xs text-muted">{dateLabel(group.date, data.timeZone)}</span>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li
                    key={item.key}
                    className={cn(
                      'flex min-h-tap items-center gap-3 rounded-md border border-line bg-surface px-3',
                      item.done === true && 'opacity-60',
                    )}
                    style={item.color === undefined ? undefined : { borderLeft: `4px solid ${item.color}` }}
                    data-kind={item.kind}
                  >
                    {item.kind === 'todo' && item.event !== undefined ? (
                      <input
                        type="checkbox"
                        className="size-4 shrink-0"
                        checked={item.done === true}
                        aria-label={`标记完成：${item.title}`}
                        onChange={() => void toggleDone(item.event as EventRow)}
                      />
                    ) : (
                      <span className="shrink-0 text-muted" aria-hidden>
                        {item.kind === 'lesson' ? (
                          <CalendarClock className="size-4" />
                        ) : item.kind === 'adjust' ? (
                          <Trophy className="size-4" />
                        ) : (
                          <ListChecks className="size-4" />
                        )}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn('truncate text-sm text-ink', item.done === true && 'line-through')}>
                        {item.title}
                      </span>
                      {item.detail.length > 0 && (
                        <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted">
                          {item.detail}
                        </span>
                      )}
                    </span>
                    {item.kind === 'lesson' && item.lessonTarget !== undefined && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        aria-label={`调课：${item.title}`}
                        onClick={() => {
                          setAdjustTarget(item.lessonTarget ?? null);
                          setAdjustOpen(true);
                        }}
                      >
                        调课
                      </Button>
                    )}
                    {item.kind === 'lesson' && item.minute > 0 && (
                      <span className="tabular shrink-0 text-xs text-muted">
                        {String(Math.floor(item.minute / 60)).padStart(2, '0')}:
                        {String(item.minute % 60).padStart(2, '0')}
                      </span>
                    )}
                    {item.kind === 'adjust' && item.event !== undefined && (
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="tabular text-xs text-muted">{item.event.on_date}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`删除调整：${item.title}`}
                          onClick={() => {
                            void (async () => {
                              await updateEvent(storage, String(item.event?.id ?? ''), { deleted_at: Date.now() });
                              onChanged();
                            })();
                          }}
                        >
                          删除
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MapPin className="size-3 text-muted" aria-hidden />
        <span className="text-xs text-muted">
          今天第 {data.week} 周 · 共 {data.todayLessons.length} 节课 · {data.todos.length} 条待办
        </span>
        <Button variant="ghost" size="sm" onClick={() => onChanged()}>
          刷新
        </Button>
      </div>

      <AdjustDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        storage={storage}
        data={data}
        target={adjustTarget}
        onChanged={onChanged}
      />
    </section>
  );
}
