import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  ListChecks,
  MoreHorizontal,
  Plus,
  Trophy,
} from 'lucide-react';
import {
  addDays,
  createEvent,
  createReschedule,
  dateRange,
  formatDate,
  updateEvent,
  type EventRow,
} from '@dawn-tick/core';
import type { AdjustTarget } from '../../components/adjust-dialog.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../../components/ui/dialog.tsx';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { cn } from '../../lib/cn.ts';
import { formatDayCountdown } from '../../lib/format.ts';
import { ActionMenu } from './card-actions.tsx';
import { defineCard, type ScheduleCardContext } from './registry.ts';
import { buildTimeline, dateLabel, groupTimeline } from './timeline.ts';

/**
 * 打开课程详情的桥：日程卡片的渲染上下文（registry.ts）里没有这一项，
 * 由 App 用 Provider 注入（App 自己渲染课程详情）；没有 Provider 时点击不响应。
 */
export const LessonDetailOpener = createContext<((target: AdjustTarget) => void) | null>(null);

/** 顶部一行：日期选择器 + 加号菜单 + 溢出菜单 */
export const actionsCard = defineCard({
  id: 'actions',
  scope: 'schedule',
  title: '顶部操作栏',
  defaultZone: 'main',
  defaultOrder: 0,
  defaultVisible: true,
  render: (ctx) => <ScheduleActions {...ctx} />,
});

function ScheduleActions(ctx: ScheduleCardContext) {
  const { data, storage, viewDate, onViewDateChange, onAddTodo, onAddExam, onOpenAdjust, onChanged } = ctx;
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeFrom, setRangeFrom] = useState(viewDate);
  const [rangeTo, setRangeTo] = useState(viewDate);
  const holidayName = data.holidayLabels.get(viewDate);

  async function setHoliday(): Promise<void> {
    if (data.semester === null) return;
    await createEvent(storage, {
      userId: 'u1',
      semesterId: data.semester.id,
      type: 'holiday',
      title: holidayName ?? '放假',
      onDate: viewDate,
    });
    toast.success('已设为假日');
    onChanged();
  }

  async function clearHoliday(): Promise<void> {
    if (data.semester === null) return;
    await createEvent(storage, {
      userId: 'u1',
      semesterId: data.semester.id,
      type: 'workday',
      title: '非假日',
      onDate: viewDate,
    });
    toast.success('已设为非假日');
    onChanged();
  }

  /** 一次性把一段日期设为假日（最多 60 天）。 */
  async function setHolidayRange(): Promise<void> {
    if (data.semester === null) return;
    const from = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
    const to = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
    const dates = dateRange(from, to);
    if (dates.length === 0 || dates.length > 60) {
      toast.error('请选择不超过 60 天的连续日期');
      return;
    }
    for (const date of dates) {
      await createEvent(storage, {
        userId: 'u1',
        semesterId: data.semester.id,
        type: 'holiday',
        title: '连续假期',
        onDate: date,
      });
    }
    setRangeOpen(false);
    toast.success(`已把 ${dates.length} 天设为假日`);
    onChanged();
  }

  /** 把所选日期的课全部停掉。 */
  async function cancelDayLessons(): Promise<void> {
    if (data.semester === null) return;
    const lessons = data.lessonsByDate.get(viewDate) ?? [];
    if (lessons.length === 0) {
      toast.error('这一天没有课');
      return;
    }
    for (const lesson of lessons) {
      await createReschedule(storage, {
        userId: 'u1',
        semesterId: data.semester.id,
        refScheduleId: lesson.scheduleId,
        onDate: viewDate,
        action: 'cancel',
        title: `停课：${lesson.courseName}`,
      });
    }
    toast.success(`已停掉当天 ${lessons.length} 节课`);
    onChanged();
  }

  /** 把所选日期的课顺延到次日同节次。 */
  async function moveDayLessons(): Promise<void> {
    if (data.semester === null) return;
    const lessons = data.lessonsByDate.get(viewDate) ?? [];
    if (lessons.length === 0) {
      toast.error('这一天没有课');
      return;
    }
    const target = addDays(viewDate, 1);
    for (const lesson of lessons) {
      await createReschedule(storage, {
        userId: 'u1',
        semesterId: data.semester.id,
        refScheduleId: lesson.scheduleId,
        onDate: viewDate,
        action: 'move',
        title: `调课：${lesson.courseName}`,
        newDate: target,
        newPeriodStart: lesson.periodStart,
        newPeriodEnd: lesson.periodEnd,
      });
    }
    toast.success(`已把当天 ${lessons.length} 节课顺延到 ${target}`);
    onChanged();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon" variant="ghost" aria-label="前一天" onClick={() => onViewDateChange(addDays(viewDate, -1))}>
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      <Input
        type="date"
        className="w-40"
        aria-label="查看日期"
        value={viewDate}
        onChange={(event) => onViewDateChange(event.target.value)}
      />
      <Button size="sm" variant="secondary" onClick={() => onViewDateChange(data.today)}>
        今天
      </Button>
      <Button size="icon" variant="ghost" aria-label="后一天" onClick={() => onViewDateChange(addDays(viewDate, 1))}>
        <ChevronRight className="size-4" aria-hidden />
      </Button>

      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-ink">
        <CalendarClock className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{dateLabel(viewDate, data.timeZone)}</span>
        {holidayName !== undefined && (
          <span className="shrink-0 text-xs font-normal text-muted">放假：{holidayName}</span>
        )}
      </span>

      <ActionMenu
        label="添加"
        icon={Plus}
        items={[
          { label: '加日程', onSelect: onAddTodo },
          { label: '加考试', onSelect: onAddExam },
          { label: '课程调整', onSelect: () => onOpenAdjust(null) },
        ]}
      />

      <ActionMenu
        label="更多操作"
        icon={MoreHorizontal}
        items={[
          holidayName === undefined
            ? { label: '设为假日', onSelect: () => void setHoliday() }
            : { label: '设为非假日', onSelect: () => void clearHoliday() },
          { label: '连续假期', onSelect: () => setRangeOpen(true) },
          { label: '当天全部停课', onSelect: () => void cancelDayLessons() },
          { label: '当天顺延到次日', onSelect: () => void moveDayLessons() },
        ]}
      />

      <Dialog open={rangeOpen} onOpenChange={setRangeOpen}>
        <DialogContent title="连续假期" description="一次把一段连续日期设为假日，最多 60 天">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="开始日期">
              <Input
                type="date"
                className="w-40"
                aria-label="假期开始"
                value={rangeFrom}
                onChange={(event) => setRangeFrom(event.target.value)}
              />
            </Field>
            <span className="pb-3 text-sm text-muted">至</span>
            <Field label="结束日期">
              <Input
                type="date"
                className="w-40"
                aria-label="假期结束"
                value={rangeTo}
                onChange={(event) => setRangeTo(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRangeOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void setHolidayRange()}>
              设为连续假日
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 主列：按日期切换的日程时间线 */
export const timelineCard = defineCard({
  id: 'timeline',
  scope: 'schedule',
  title: '日程时间线',
  defaultZone: 'main',
  defaultOrder: 1,
  defaultVisible: true,
  render: (ctx) => (ctx.scope === 'schedule' ? <ScheduleTimeline {...ctx} /> : null),
});

function ScheduleTimeline({
  data,
  storage,
  viewDate,
  onViewDateChange,
  onChanged,
  tomorrowPreview,
}: ScheduleCardContext) {
  const timeline = buildTimeline(data, viewDate);
  const groups = groupTimeline(timeline);
  const openLessonDetail = useContext(LessonDetailOpener);
  const tomorrow = addDays(viewDate, 1);
  const tomorrowItems = buildTimeline(data, tomorrow).length;

  async function toggleDone(event: EventRow): Promise<void> {
    await updateEvent(storage, event.id, { done: event.done === 1 ? 0 : 1 });
    onChanged();
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.length === 0 ? (
        <EmptyState icon={ListChecks} title="这一天没有安排" description="可切换日期看过去或未来" />
      ) : (
        groups.map((group) => (
          <div key={group.date ?? 'undated'} className="flex flex-col gap-1">
            <span className="text-xs text-muted">{dateLabel(group.date, data.timeZone)}</span>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => {
                const lessonTarget = item.lessonTarget ?? null;
                const marker =
                  item.kind === 'todo' && item.event !== undefined ? (
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
                  );
                const body = (
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
                );
                return (
                  <li
                    key={item.key}
                    className={cn(
                      'flex min-h-tap items-center gap-3 rounded-md border border-line bg-surface px-3',
                      item.done === true && 'border-line-strong/50 bg-surface-muted/40 text-muted opacity-45',
                    )}
                    style={item.color === undefined ? undefined : { borderLeft: `4px solid ${item.color}` }}
                    data-kind={item.kind}
                    data-done={item.done === true ? 'true' : undefined}
                  >
                    {lessonTarget === null ? (
                      <>
                        {marker}
                        {body}
                      </>
                    ) : (
                      // 课程行整体可点：进课程详情，调课在详情里操作
                      <button
                        type="button"
                        data-role="timeline-lesson"
                        aria-label={`查看课程详情：${item.title}`}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong"
                        onClick={() => openLessonDetail?.(lessonTarget)}
                      >
                        {marker}
                        {body}
                      </button>
                    )}
                    {item.kind === 'lesson' && item.timeRange !== undefined && (
                      <span className="tabular shrink-0 text-xs text-muted" data-role="lesson-time">
                        {item.timeRange}
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
                );
              })}
            </ul>
          </div>
        ))
      )}
      {tomorrowPreview && tomorrowItems > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted">明日预告：还有 {tomorrowItems} 项安排</span>
          <Button size="sm" variant="secondary" onClick={() => onViewDateChange(tomorrow)}>
            看明天
          </Button>
        </div>
      )}
    </div>
  );
}

/** 侧列：考试倒计时 */
export const examsCard = defineCard({
  id: 'exams',
  scope: 'schedule',
  title: '考试倒计时',
  defaultZone: 'side',
  defaultOrder: 2,
  defaultVisible: true,
  render: (ctx) => {
    if (ctx.scope !== 'schedule') return null;
    const { data, onAddExam } = ctx;
    const now = Date.now();
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink">考试倒计时</span>
        {data.exams.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="暂无考试安排"
            description="用顶部「＋」里的加考试录入考试时间"
            action={
              <Button size="sm" variant="secondary" onClick={onAddExam}>
                加考试
              </Button>
            }
          />
        ) : (
          <div className="grid gap-2">
            {data.exams.map((exam) => (
              <Card key={exam.id} className="flex items-center justify-between gap-3 p-3">
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
    );
  },
});

/** 侧列：开学与假期倒计时 */
export const countdownsCard = defineCard({
  id: 'countdowns',
  scope: 'schedule',
  title: '日期与倒计时',
  defaultZone: 'side',
  defaultOrder: 3,
  defaultVisible: true,
  render: (ctx) => {
    if (ctx.scope !== 'schedule') return null;
    const { data, semesterCountdown, holidayCountdown } = ctx;
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
          距开学还有 {semesterDays} 天
        </span>,
      );
    }
    if (nextHolidayDate !== null) {
      badges.push(
        <span
          key="holiday"
          className="flex min-h-tap items-center rounded-md border border-line bg-surface px-3 text-xs text-ink"
        >
          距{data.holidayLabels.get(nextHolidayDate)}还有 {daysUntil(nextHolidayDate)} 天
        </span>,
      );
    }
    if (badges.length === 0) return null;
    return (
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarDays className="size-4" aria-hidden />
          日期与倒计时
        </span>
        <div className="flex flex-wrap gap-2">{badges}</div>
      </div>
    );
  },
});

/** 侧列：明日预告 */
export const tomorrowCard = defineCard({
  id: 'tomorrow',
  scope: 'schedule',
  title: '明日预告',
  defaultZone: 'side',
  defaultOrder: 4,
  defaultVisible: true,
  render: (ctx) => {
    if (ctx.scope !== 'schedule') return null;
    const { data, viewDate, tomorrowPreview, onViewDateChange } = ctx;
    const tomorrow = addDays(viewDate, 1);
    const count = buildTimeline(data, tomorrow).length;
    if (!tomorrowPreview || count === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
        <CalendarClock className="size-4 text-muted" aria-hidden />
        <span className="text-xs text-muted">明日预告：还有 {count} 项安排</span>
        <Button size="sm" variant="secondary" onClick={() => onViewDateChange(tomorrow)}>
          看明天
        </Button>
      </div>
    );
  },
});
