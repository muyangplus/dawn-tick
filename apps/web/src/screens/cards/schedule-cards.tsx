import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  GraduationCap,
  ListChecks,
  MapPin,
  MoreHorizontal,
  Plus,
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
import { logInfo } from '../../log.ts';
import { Card } from '../../components/ui/card.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../../components/ui/dialog.tsx';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { cn } from '../../lib/cn.ts';
import { formatDayCountdown } from '../../lib/format.ts';
import { useNowTick } from '../../lib/use-now.ts';
import { ActionMenu } from './card-actions.tsx';
import { defineCard, type ScheduleCardContext } from './registry.ts';
import { buildTimeline, dateLabel, groupTimeline, splitTimeline, type TimelineItem, type TimelineNature } from './timeline.ts';

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
          { label: '加待办', onSelect: onAddTodo },
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
        <DialogContent title="连续假期" description="把一段连续日期设为假日，最多 60 天">
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
  onOpenEvent,
}: ScheduleCardContext) {
  // 时刻每秒走一格：正在上的课、到点自动完成的条目不用等下一次数据加载
  const now = useNowTick(1000);
  const timeline = buildTimeline(data, viewDate, now);
  // 已完成（手动勾选 或 到点自动完成）的条目从主时间线移出，单独成组置顶
  const { main, completed } = splitTimeline(timeline);
  const groups = groupTimeline(main);
  const openLessonDetail = useContext(LessonDetailOpener);
  const tomorrow = addDays(viewDate, 1);
  const tomorrowItems = buildTimeline(data, tomorrow, now).length;
  /**
   * 已完成分组的展开状态：
   * 默认「主列表还有未完成条目 → 收起；全部条目都已完成 → 展开」；
   * 手动点过标题之后以手动为准（按日期记住，切到别的日期再回到默认），
   * 这样自动判定与手动操作不会互相打架。
   */
  const [manualCompleted, setManualCompleted] = useState<{ date: string; open: boolean } | null>(null);
  const completedOpen =
    manualCompleted !== null && manualCompleted.date === viewDate ? manualCompleted.open : main.length === 0;

  async function toggleDone(event: EventRow): Promise<void> {
    await updateEvent(storage, event.id, { done: event.done === 1 ? 0 : 1 });
    onChanged();
  }

  /** 删除一条调课/调休（沿用原来的软删除方式）。 */
  async function deleteAdjust(event: EventRow): Promise<void> {
    await updateEvent(storage, event.id, { deleted_at: Date.now() });
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      {timeline.length === 0 ? (
        <EmptyState icon={ListChecks} title="这一天没有安排" description="可切换日期查看其他日期" />
      ) : (
        <>
          {completed.length > 0 && (
            <section
              className="flex flex-col gap-1 rounded-lg border border-line/70 bg-surface-muted/50 p-2"
              data-role="timeline-completed"
              data-count={completed.length}
              aria-label={`已完成 ${completed.length} 项`}
            >
              <button
                type="button"
                className="flex min-h-tap items-center gap-2 rounded-md px-2 text-left hover:bg-surface-muted"
                data-role="timeline-completed-toggle"
                aria-expanded={completedOpen}
                aria-label={`已完成 ${completed.length}：${completedOpen ? '收起' : '展开'}`}
                onClick={() => setManualCompleted({ date: viewDate, open: !completedOpen })}
              >
                <ChevronDown
                  className={cn('size-4 shrink-0 text-muted transition-transform', completedOpen && 'rotate-180')}
                  aria-hidden
                />
                <span className="text-sm font-semibold text-muted">已完成 {completed.length}</span>
              </button>
              <ul className="flex flex-col gap-2 px-1 pb-1" data-role="timeline-completed-list" hidden={!completedOpen}>
                {completed.map((item) => (
                  <TimelineRow
                    key={item.key}
                    item={item}
                    onToggleDone={toggleDone}
                    onDeleteAdjust={deleteAdjust}
                    onOpenLesson={openLessonDetail}
                    onOpenEvent={onOpenEvent}
                  />
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-col gap-2" data-role="timeline-main">
            {groups.map((group) => (
              <div key={group.date ?? 'undated'} className="flex flex-col gap-1">
                <span className="text-xs text-muted">{dateLabel(group.date, data.timeZone)}</span>
                <ul className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <TimelineRow
                      key={item.key}
                      item={item}
                      onToggleDone={toggleDone}
                      onDeleteAdjust={deleteAdjust}
                      onOpenLesson={openLessonDetail}
                      onOpenEvent={onOpenEvent}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {main.length === 0 && <span className="text-xs text-muted">这一天的安排都已完成</span>}
          </div>
        </>
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

/** 条目性质角标配色：课程用主题主色、调整用强调色、考试用危险色、作业与实验各有自己的色。 */
const NATURE_CLASS: Record<TimelineNature, string> = {
  课程: 'border-primary/40 bg-primary/10 text-primary-strong',
  调整: 'border-accent/40 bg-accent/10 text-accent-strong',
  考试: 'border-danger/40 bg-danger/10 text-danger-strong',
  作业: 'border-primary/40 bg-primary/5 text-primary-strong',
  实验: 'border-accent/40 bg-accent/5 text-accent-strong',
  其他: 'border-line bg-surface-muted text-muted',
};

interface TimelineRowProps {
  item: TimelineItem;
  /** 手动勾选：可选功能，只有带事件行且还没自动完成的待办/考试才有勾选框 */
  onToggleDone: (event: EventRow) => void;
  /** 删除一条调课/调休 */
  onDeleteAdjust: (event: EventRow) => void;
  /** 打开课程详情；没有 Provider 时课程行不可点 */
  onOpenLesson: ((target: AdjustTarget) => void) | null;
  /** 单击日程条目进入详情编辑 */
  onOpenEvent: (event: EventRow) => void;
}

/**
 * 一条时间线，格式固定为：
 * 左侧竖排时间列（开始 / – / 结束）+ 颜色竖条 + 右侧两行（标题、地点）。
 * 已完成的条目整行更灰（opacity-40），并去掉勾选框改成「到点自动完成」标记。
 */
function TimelineRow({ item, onToggleDone, onDeleteAdjust, onOpenLesson, onOpenEvent }: TimelineRowProps) {
  const lessonTarget = item.lessonTarget ?? null;
  const marker =
    item.autoDone ? (
      <span className="flex shrink-0 items-center" data-role="timeline-auto-check">
        <CircleCheck className="size-4 text-muted" role="img" aria-label={`已到时间自动完成：${item.title}`} />
      </span>
    ) : item.checkable && item.event !== undefined ? (
      <input
        type="checkbox"
        className="size-4 shrink-0"
        checked={item.done}
        aria-label={`标记完成：${item.title}`}
        onChange={() => onToggleDone(item.event as EventRow)}
      />
    ) : null;

  const body = (
    <>
      <span
        className="tabular flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 text-xs font-medium leading-tight text-ink"
        data-role={item.kind === 'lesson' ? 'lesson-time' : 'timeline-time'}
      >
        {item.startText === null && item.endText !== null && (
          <span className="text-[10px] font-normal text-muted">截止</span>
        )}
        {item.startText !== null && <span>{item.startText}</span>}
        {item.startText !== null && item.endText !== null && <span aria-hidden>–</span>}
        {item.endText !== null && <span>{item.endText}</span>}
      </span>
      {/* 颜色竖条：把左侧时间与右侧内容隔开；课程用课程色，其余用主题主色 */}
      <span
        aria-hidden
        className="w-1.5 shrink-0 self-stretch rounded-full"
        data-role="timeline-color"
        data-color={item.color ?? 'var(--dt-primary)'}
        style={{ backgroundColor: item.color ?? 'var(--dt-primary)' }}
      />
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] leading-none',
              NATURE_CLASS[item.nature],
            )}
            data-role="timeline-nature"
          >
            {item.nature}
          </span>
          <span className={cn('truncate text-base font-medium text-ink', item.completed && 'line-through')}>
            {item.title}
          </span>
          {item.running && (
            <span
              className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[11px] leading-none text-on-primary"
              data-role="timeline-running"
            >
              进行中
            </span>
          )}
          {item.countdownText !== undefined && item.countdownText !== null && (
            <span className="tabular shrink-0 text-[11px] font-semibold text-danger-strong" data-role="countdown-left">
              {item.countdownText}
            </span>
          )}
          {item.date === null && <span className="shrink-0 text-[11px] text-muted">未排期</span>}
        </span>
        {item.location !== null && item.location.length > 0 && (
          <span className="flex min-w-0 items-center gap-1 text-sm text-muted" data-role="timeline-location">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{item.location}</span>
          </span>
        )}
        {item.detail.length > 0 && <span className="truncate text-xs text-muted">{item.detail}</span>}
      </span>
    </>
  );

  /** 日程条目：整行（含已完成）都能点开编辑；勾选框与删除按钮各自处理，不冒泡 */
  const openEvent = (): void => {
    if (item.event !== undefined && item.kind !== 'adjust') onOpenEvent(item.event as EventRow);
  };
  return (
    <li
      className={cn(
        'flex min-h-tap items-stretch gap-3 rounded-lg border border-line bg-surface px-3 py-3',
        item.completed && 'border-line/60 bg-surface-muted/40 text-muted opacity-40',
      )}
      data-role="timeline-row"
      data-kind={item.kind}
      data-nature={item.nature}
      data-completed={item.completed ? 'true' : undefined}
      data-auto={item.autoDone ? 'true' : undefined}
      data-done={item.done ? 'true' : undefined}
      data-running={item.running ? 'true' : undefined}
      onClick={openEvent}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openEvent();
      }}
      role={item.event !== undefined && item.kind !== 'adjust' && lessonTarget === null ? 'button' : undefined}
      tabIndex={item.event !== undefined && item.kind !== 'adjust' && lessonTarget === null ? 0 : undefined}
    >
      {lessonTarget === null && item.event !== undefined && item.kind !== 'adjust' ? (
        // 日程条目整行可点：进详情编辑
        <button
          type="button"
          data-role="timeline-event"
          aria-label={`编辑日程：${item.title}`}
          className="flex min-w-0 flex-1 items-stretch gap-3 rounded-sm text-left hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong"
          onClick={(event) => {
            event.stopPropagation();
            openEvent();
          }}
        >
          {body}
        </button>
      ) : lessonTarget === null ? (
        body
      ) : (
        // 课程行整体可点：进课程详情，调课在详情里操作
        <button
          type="button"
          data-role="timeline-lesson"
          aria-label={`查看课程详情：${item.title}`}
          className="flex min-w-0 flex-1 items-stretch gap-3 rounded-sm text-left hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong"
          onClick={() => onOpenLesson?.(lessonTarget)}
        >
          {body}
        </button>
      )}
      {marker !== null && <span onClick={(event) => event.stopPropagation()}>{marker}</span>}
      {item.kind === 'adjust' && item.event !== undefined && (
        <span
          className="flex shrink-0 items-center"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Button
            size="sm"
            variant="ghost"
            aria-label={`删除调整：${item.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onDeleteAdjust(item.event as EventRow);
            }}
          >
            删除
          </Button>
        </span>
      )}
    </li>
  );
}

/** 侧列：倒计时（上半开学/假期徽标，下半逐条作业与考试倒计时） */
export const examsCard = defineCard({
  id: 'exams',
  scope: 'schedule',
  title: '倒计时',
  defaultZone: 'side',
  defaultOrder: 2,
  defaultVisible: true,
  render: (ctx) => {
    if (ctx.scope !== 'schedule') return null;
    const { data, onAddExam, onOpenEvent, semesterCountdown, holidayCountdown } = ctx;
    const now = Date.now();
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
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink">倒计时</span>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2" data-role="countdown-badges">
            {badges}
          </div>
        )}
        {rows.length === 0 ? (
          badges.length === 0 && (
            <EmptyState
              icon={GraduationCap}
              title="暂无倒计时条目"
              description="在「加待办」里打开「开启倒计时」，作业与考试会显示剩余天数"
              action={
                <Button size="sm" variant="secondary" onClick={onAddExam}>
                  加待办
                </Button>
              }
            />
          )
        ) : (
          <div className="grid gap-2">
            {rows.map((row) => (
              <Card key={row.id} className="flex items-center justify-between gap-3 p-0">
                <button
                  type="button"
                  data-role="countdown-row"
                  aria-label={`编辑日程：${row.title}`}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md p-3 text-left hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong"
                  onClick={() => onOpenEvent(row)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="shrink-0 rounded-full border border-line bg-surface-muted px-1.5 py-0.5 text-[10px] leading-none text-muted"
                        data-role="countdown-type"
                      >
                        {COUNTDOWN_TYPE_LABEL[row.type] ?? '日程'}
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
                        row.seat_no === null ? null : `座位 ${row.seat_no}`,
                      ]
                        .filter((item) => item !== null && item !== undefined && item !== '')
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold text-danger-strong">
                    {formatDayCountdown(countdownTarget(row), now)}
                  </span>
                </button>
                {/* 倒计时条目也能直接勾完成，不必进详情 */}
                <span className="flex shrink-0 items-center pr-3">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={row.done === 1}
                    aria-label={`标记完成：${row.title}`}
                    onChange={(event) => {
                      event.stopPropagation();
                      void toggleCountdownDone(ctx, row, event.target.checked);
                    }}
                  />
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  },
});

/** 倒计时条目的类型文案。 */
const COUNTDOWN_TYPE_LABEL: Record<string, string> = {
  homework: '作业',
  exam: '考试',
  lab: '实验',
  todo: '日程',
  temp: '日程',
};

/** 条目关联的课程名。 */
function courseNameOf(data: ScheduleCardContext['data'], courseId: string): string | null {
  return data.courses.find((course) => course.id === courseId)?.name ?? null;
}

/** 倒计时条目勾完成：写回同一条并刷新。 */
async function toggleCountdownDone(
  ctx: Extract<ScheduleCardContext, { scope: 'schedule' }>,
  row: EventRow,
  done: boolean,
): Promise<void> {
  await updateEvent(ctx.storage, row.id, { done: done ? 1 : 0 });
  logInfo('schedule', done ? '倒计时条目标记完成' : '倒计时条目取消完成', { id: row.id, title: row.title });
  ctx.onChanged();
}

/** 倒计时条目的目标时刻：开考时间优先，其次截止时间，再退到当天 00:00。 */
function countdownTarget(row: EventRow): number {
  if (row.start_at !== null && row.start_at !== undefined) return row.start_at;
  if (row.due_at !== null && row.due_at !== undefined) return row.due_at;
  if (row.on_date !== null && row.on_date !== undefined) return Date.parse(`${row.on_date}T00:00:00Z`);
  return 0;
}

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
