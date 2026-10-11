import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppData, LessonCell } from '../data.ts';
import { CourseCard } from '../components/course-card.tsx';
import { NowIndicator } from '../components/now-indicator.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { cn } from '../lib/cn.ts';
import { localMinuteOfDay, nowRatio } from '../lib/timeline.ts';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const ROW_HEIGHT = 56;
const AXIS_WIDTH = '3.5rem';

/** 查看周里第 day 天的日期（周一为第 1 天）。 */
function weekDayDate(weekStartDate: string, day: number): string {
  const base = Date.parse(`${weekStartDate}T00:00:00Z`);
  if (Number.isNaN(base)) return weekStartDate;
  return new Date(base + (day - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** 表头显示月日。 */
function formatMonthDay(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

export interface WeekViewProps {
  data: AppData;
  viewDays: number;
  /** 非本周课程是否用虚线显示 */
  showOtherWeeks: boolean;
  onSelectLesson: (cell: LessonCell) => void;
  onMoveLesson: (cell: LessonCell, dayOfWeek: number, period: number) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

function lessonsOf(data: AppData): LessonCell[] {
  const out: LessonCell[] = [];
  for (const list of data.grid.values()) out.push(...list);
  return out;
}

export function WeekView({
  data,
  viewDays,
  showOtherWeeks,
  onSelectLesson,
  onMoveLesson,
  onPrevWeek,
  onNextWeek,
}: WeekViewProps) {
  const [dragging, setDragging] = useState<LessonCell | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const slots = useMemo(
    () => data.slots.map((slot) => ({ periodNo: slot.period_no, startTime: slot.start_time, endTime: slot.end_time })),
    [data.slots],
  );
  const ratio = nowRatio(slots, localMinuteOfDay(nowTick, data.timeZone));
  const lessons = useMemo(() => lessonsOf(data), [data]);
  const periodCount = slots.length;

  return (
    <section
      aria-label="周视图"
      className="flex flex-col gap-2"
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        const end = event.changedTouches[0]?.clientX ?? null;
        touchStart.current = null;
        if (start === null || end === null) return;
        const delta = end - start;
        if (Math.abs(delta) < 60) return;
        if (delta > 0) onPrevWeek();
        else onNextWeek();
      }}
    >
      {!data.hasLessons && (
        <EmptyState
          title={`第 ${data.viewWeek} 周没有课程`}
          description="可用右上角添加课程，或到导入页从 ICS、CSV/Excel 与教务系统导入"
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <div className="min-w-[40rem]">
          <div
            className="grid border-b border-line"
            style={{ gridTemplateColumns: `${AXIS_WIDTH} repeat(${viewDays}, minmax(0, 1fr))` }}
          >
            <div className="px-2 py-2 text-center text-xs text-muted">节次</div>
            {WEEKDAYS.slice(0, viewDays).map((label, index) => {
              const day = index + 1;
              const isToday = data.viewWeek === data.week && day === data.todayOfWeek;
              const date = weekDayDate(data.weekStartDate, day);
              const isHoliday = data.holidayLabels.has(date);
              return (
                <div
                  key={label}
                  className={cn(
                    'px-2 py-2 text-center text-xs',
                    isToday ? 'font-semibold text-primary-strong' : isHoliday ? 'text-muted' : 'text-ink',
                  )}
                >
                  <span className="flex flex-col items-center gap-0.5">
                    <span>{label}</span>
                    <span className="tabular text-[10px] text-muted">{formatMonthDay(date)}</span>
                    {isToday && <span className="text-[10px] text-muted">今天</span>}
                    {isHoliday && <span className="text-[10px] text-muted">放假</span>}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `${AXIS_WIDTH} repeat(${viewDays}, minmax(0, 1fr))`,
              height: `${periodCount * ROW_HEIGHT}px`,
            }}
          >
            <div className="relative border-r border-line">
              {slots.map((slot, index) => (
                <div
                  key={slot.periodNo}
                  className="absolute inset-x-0 flex flex-col items-center justify-center gap-0.5 border-b border-line text-[11px] text-muted"
                  style={{ top: `${index * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }}
                >
                  <span className="tabular font-semibold text-ink">{slot.periodNo}</span>
                  <span className="tabular">{slot.startTime}</span>
                </div>
              ))}
            </div>

            {Array.from({ length: viewDays }, (_, index) => {
              const day = index + 1;
              const isToday = data.viewWeek === data.week && day === data.todayOfWeek;
              const dayLessons = lessons
                .filter((lesson) => lesson.dayOfWeek === day)
                .filter((lesson) => lesson.inWeek || showOtherWeeks);
              return (
                <div
                  key={`column-${day}`}
                  className="relative border-r border-line last:border-r-0"
                  style={
                    isToday
                      ? { backgroundColor: 'color-mix(in srgb, var(--dt-primary) 6%, transparent)' }
                      : undefined
                  }
                  data-today={isToday ? 'true' : undefined}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging === null) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const offset = event.clientY - bounds.top;
                    const period = Math.min(periodCount, Math.max(1, Math.floor(offset / ROW_HEIGHT) + 1));
                    onMoveLesson(dragging, day, period);
                    setDragging(null);
                  }}
                >
                  {Array.from({ length: periodCount }, (_, rowIndex) => (
                    <div
                      key={`line-${day}-${rowIndex}`}
                      className="absolute inset-x-0 border-b border-line"
                      style={{ top: `${rowIndex * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }}
                    />
                  ))}
                  {dayLessons.map((lesson) => (
                    <div
                      key={`${lesson.courseId}-${lesson.periodStart}`}
                      className="absolute inset-x-1 min-w-0"
                      style={{
                        top: `${(lesson.periodStart - 1) * ROW_HEIGHT + 2}px`,
                        height: `${(lesson.periodEnd - lesson.periodStart + 1) * ROW_HEIGHT - 4}px`,
                      }}
                      draggable={lesson.inWeek}
                      onDragStart={() => {
                        if (lesson.inWeek) setDragging(lesson);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <CourseCard
                        name={lesson.name}
                        color={lesson.color}
                        room={lesson.room}
                        teacher={lesson.teacher}
                        meta={`${lesson.startTime}-${lesson.endTime}`}
                        tone={!lesson.inWeek ? 'ghost' : lesson.holiday ? 'holiday' : 'solid'}
                        onClick={() => onSelectLesson(lesson)}
                        className="h-full"
                      />
                    </div>
                  ))}
                </div>
              );
            })}

            {ratio !== null && data.viewWeek === data.week && (
              <NowIndicator ratio={ratio} className="left-14" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
