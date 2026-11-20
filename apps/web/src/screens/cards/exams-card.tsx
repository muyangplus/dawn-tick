import { type ReactNode } from 'react';
import { GraduationCap } from 'lucide-react';
import { formatDate, type EventRow } from '@dawn-tick/core';
import { Card } from '../../components/ui/card.tsx';
import { Button } from '../../components/ui/button.tsx';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import { cn } from '../../lib/cn.ts';
import { formatDayCountdown } from '../../lib/format.ts';
import { useNowTick } from '../../lib/use-now.ts';
import { defineCard, type ScheduleCardContext } from './registry.ts';
import { countdownCopy } from '../../copy/home-countdown.ts';

/** 侧列：倒计时（上半开学/假期徽标，下半逐条作业与考试倒计时） */
export const examsCard = defineCard({
  id: 'exams',
  scope: 'schedule',
  title: countdownCopy.cardTitle,
  defaultZone: 'side',
  defaultOrder: 2,
  defaultVisible: true,
  render: (ctx) => (ctx.scope === 'schedule' ? <CountdownCardBody ctx={ctx} /> : null),
});

/** 倒计时卡片正文：自带节拍，剩余天数与进度不依赖别处的数据刷新。 */
function CountdownCardBody({ ctx }: { ctx: Extract<ScheduleCardContext, { scope: 'schedule' }> }) {
  const now = useNowTick(15_000);
  const { data, onAddExam, onOpenEvent, semesterCountdown, holidayCountdown } = ctx;
  const rows = data.countdowns;
  const daysUntil = (date: string): number =>
    Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${data.today}T00:00:00Z`)) / 86_400_000);
  const semesterStart = data.semester?.start_date ?? null;
  const semesterDays = semesterStart === null ? null : daysUntil(semesterStart);
  const nextHolidayDate =
    holidayCountdown
      ? [...data.holidayLabels.keys()].filter((date) => date > data.today).sort()[0] ?? null
      : null;
  const badges: ReactNode[] = [];
  if (semesterCountdown && semesterDays !== null && semesterDays > 0) {
    badges.push(
      <span
        key="semester"
        className="flex min-h-tap items-center rounded-md border border-line bg-surface px-3 text-xs text-ink"
      >
        {countdownCopy.untilSemester(semesterDays)}
      </span>,
    );
  }
  if (nextHolidayDate !== null) {
    badges.push(
      <span
        key="holiday"
        className="flex min-h-tap items-center rounded-md border border-line bg-surface px-3 text-xs text-ink"
      >
        {countdownCopy.untilHoliday(data.holidayLabels.get(nextHolidayDate) ?? '', daysUntil(nextHolidayDate))}
      </span>,
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-ink">{countdownCopy.cardTitle}</span>
      {/* 徽标区与条目区固定分区：徽标有没有都不影响条目区，空条目区始终给主行动 */}
      <div className="flex flex-wrap gap-2" data-role="countdown-badges">
        {badges}
      </div>
      <div className="flex flex-col gap-2" data-role="countdown-entries">
        {rows.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title={countdownCopy.emptyTitle}
            description={countdownCopy.emptyDescription}
            action={
              <Button size="sm" variant="secondary" aria-label={countdownCopy.addExamButton} onClick={onAddExam}>
                {countdownCopy.addExamButton}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-2">
            {rows.map((row) => (
              <Card key={row.id} className="flex items-center justify-between gap-3 p-0">
                <button
                  type="button"
                  data-role="countdown-row"
                  aria-label={countdownCopy.editEvent(row.title)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md p-3 text-left hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong"
                  onClick={() => onOpenEvent(row)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="shrink-0 rounded-full border border-line bg-surface-muted px-1.5 py-0.5 text-[10px] leading-none text-muted"
                        data-role="countdown-type"
                      >
                        {COUNTDOWN_TYPE_LABEL[row.type] ?? countdownCopy.typeFallback}
                      </span>
                      <span className={cn('truncate text-sm font-medium text-ink', row.done === 1 && 'line-through opacity-60')}>
                        {row.title}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted" data-role="countdown-course">
                      {[
                        row.subject === null ? null : courseNameOf(data, row.subject),
                        row.on_date ?? (row.start_at === null ? null : formatDate(row.start_at, data.timeZone)),
                        row.location,
                        row.seat_no === null ? null : countdownCopy.seat(row.seat_no),
                      ]
                        .filter((item) => item !== null && item !== undefined && item !== '')
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold text-danger-strong">
                    {formatDayCountdown(countdownTarget(row), now)}
                  </span>
                </button>
                {/* 倒计时条目也能直接勾完成，不必进详情；label 给 16px 勾选框补足 44px 命中区 */}
                <label
                  className="flex min-h-tap min-w-tap shrink-0 cursor-pointer items-center justify-center pr-3"
                  data-role="done-tap"
                >
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={row.done === 1}
                    aria-label={countdownCopy.markDone(row.title)}
                    onChange={(event) => {
                      event.stopPropagation();
                      void ctx.actions.setDone(row, event.target.checked);
                    }}
                  />
                </label>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 倒计时条目的类型文案。 */
const COUNTDOWN_TYPE_LABEL: Record<string, string> = countdownCopy.type;

/** 条目关联的课程名。 */
function courseNameOf(data: ScheduleCardContext['data'], courseId: string): string | null {
  return data.courses.find((course) => course.id === courseId)?.name ?? null;
}

/** 倒计时条目的目标时刻：开考时间优先，其次截止时间，再退到当天 00:00。 */
function countdownTarget(row: EventRow): number {
  if (row.start_at !== null && row.start_at !== undefined) return row.start_at;
  if (row.due_at !== null && row.due_at !== undefined) return row.due_at;
  if (row.on_date !== null && row.on_date !== undefined) return Date.parse(`${row.on_date}T00:00:00Z`);
  return 0;
}
