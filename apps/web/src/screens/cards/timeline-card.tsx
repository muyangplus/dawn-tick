import { useContext, useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, CircleCheck, ListChecks, MapPin } from 'lucide-react';
import { addDays, type EventRow } from '@dawn-tick/core';
import type { AdjustTarget } from '../../components/adjust-dialog.tsx';
import { ScheduleFocusContext } from '../../components/schedule-focus.ts';
import { Button } from '../../components/ui/button.tsx';
import { confirmAction } from '../../components/ui/confirm-dialog.tsx';
import { timelineCopy } from '../../copy/home-timeline.ts';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import { cn } from '../../lib/cn.ts';
import { useNowTick } from '../../lib/use-now.ts';
import { defineCard, type ScheduleCardContext } from './registry.ts';
import {
  buildTimeline,
  dateLabel,
  groupTimeline,
  splitTimeline,
  type TimelineItem,
  type TimelineNature,
} from './timeline.ts';
import { LessonDetailOpener } from './lesson-detail-opener.ts';

/** 主列：按日期切换的日程时间线 */
export const timelineCard = defineCard({
  id: 'timeline',
  scope: 'schedule',
  title: timelineCopy.cardTitle,
  defaultZone: 'main',
  defaultOrder: 1,
  defaultVisible: true,
  render: (ctx) => (ctx.scope === 'schedule' ? <ScheduleTimeline {...ctx} /> : null),
});

function ScheduleTimeline({
  data,
  viewDate,
  onViewDateChange,
  tomorrowPreview,
  onOpenEvent,
  onAddTodo,
  actions,
}: ScheduleCardContext) {
  // 时刻每秒走一格：正在上的课、到点自动完成的条目不用等下一次数据加载
  const now = useNowTick(1000);
  const timeline = buildTimeline(data, viewDate, now);
  // 已完成（手动勾选 或 到点自动完成）的条目从主时间线移出，单独成组置顶
  const { main, completed } = splitTimeline(timeline);
  const groups = groupTimeline(main);
  const openLessonDetail = useContext(LessonDetailOpener);
  /** 搜索命中的那一行：切到该日期后滚进视野并高亮 */
  const focusEventId = useContext(ScheduleFocusContext);
  const focusedRow = useRef<HTMLLIElement | null>(null);
  const focused = (item: TimelineItem): boolean => focusEventId !== null && item.event?.id === focusEventId;
  useEffect(() => {
    if (focusEventId === null) return;
    focusedRow.current?.scrollIntoView({ block: 'center' });
  }, [focusEventId, viewDate]);
  const tomorrow = addDays(viewDate, 1);
  const tomorrowItems = buildTimeline(data, tomorrow, now).length;
  /** 已完成分组的展开状态：默认主列表为空才展开；手动点过标题后按日期以手动为准。 */
  const [manualCompleted, setManualCompleted] = useState<{ date: string; open: boolean } | null>(null);
  const completedOpen =
    manualCompleted !== null && manualCompleted.date === viewDate ? manualCompleted.open : main.length === 0;

  function toggleDone(event: EventRow): void {
    void actions.setDone(event, event.done !== 1);
  }

  /** 删除一条调课/调休（沿用原来的软删除方式）：确认留在卡片，写库交给 actions。 */
  async function deleteAdjust(event: EventRow): Promise<void> {
    const ok = await confirmAction({
      title: timelineCopy.deleteAdjustTitle,
      description: timelineCopy.deleteAdjustDescription,
      confirmLabel: timelineCopy.deleteConfirmButton,
    });
    if (!ok) return;
    await actions.deleteAdjust(event);
  }

  /** 长按时间线行删除待办/作业/考试/实验：与详情页同一确认口径。 */
  async function deleteTimelineEvent(event: EventRow): Promise<void> {
    const ok = await confirmAction({
      title: timelineCopy.deleteEventTitle,
      description: timelineCopy.deleteEventDescription(event.title),
      confirmLabel: timelineCopy.deleteConfirmButton,
    });
    if (!ok) return;
    await actions.removeEvent(event);
  }

  return (
    <div className="flex flex-col gap-3">
      {timeline.length === 0 ? (
        <div data-role="timeline-empty">
          <EmptyState
            icon={ListChecks}
            title={timelineCopy.emptyTitle}
            action={
              <Button size="sm" variant="secondary" aria-label={timelineCopy.addTodoButton} onClick={onAddTodo}>
                {timelineCopy.addTodoButton}
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {completed.length > 0 && (
            <section
              className="flex flex-col gap-1 rounded-lg border border-line/70 bg-surface-muted/50 p-2"
              data-role="timeline-completed"
              data-count={completed.length}
              aria-label={timelineCopy.completedGroup(completed.length)}
            >
              <button
                type="button"
                className="flex min-h-tap items-center gap-2 rounded-md px-2 text-left hover:bg-surface-muted"
                data-role="timeline-completed-toggle"
                aria-expanded={completedOpen}
                aria-label={timelineCopy.completedToggle(completed.length, completedOpen)}
                onClick={() => setManualCompleted({ date: viewDate, open: !completedOpen })}
              >
                <ChevronDown
                  className={cn('size-4 shrink-0 text-muted transition-transform', completedOpen && 'rotate-180')}
                  aria-hidden
                />
                <span className="text-sm font-semibold text-muted">{timelineCopy.completedGroup(completed.length)}</span>
              </button>
              <ul className="flex flex-col gap-2 px-1 pb-1" data-role="timeline-completed-list" hidden={!completedOpen}>
                {completed.map((item) => (
                  <TimelineRow
                    key={item.key}
                    item={item}
                    focused={focused(item)}
                    rowRef={focused(item) ? focusedRow : undefined}
                    onToggleDone={toggleDone}
                    onDeleteAdjust={deleteAdjust}
                    onDeleteEvent={deleteTimelineEvent}
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
                      focused={focused(item)}
                      rowRef={focused(item) ? focusedRow : undefined}
                      onToggleDone={toggleDone}
                      onDeleteAdjust={deleteAdjust}
                      onDeleteEvent={deleteTimelineEvent}
                      onOpenLesson={openLessonDetail}
                      onOpenEvent={onOpenEvent}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {main.length === 0 && <span className="text-xs text-muted">{timelineCopy.allDone}</span>}
          </div>
        </>
      )}
      {tomorrowPreview && tomorrowItems > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted">{timelineCopy.tomorrowPreview(tomorrowItems)}</span>
          <Button size="sm" variant="secondary" onClick={() => onViewDateChange(tomorrow)}>
            {timelineCopy.tomorrowButton}
          </Button>
        </div>
      )}
    </div>
  );
}

/** 条目性质角标配色：课程用主题主色、调整用强调色、考试用危险色、作业与实验各有自己的色。 */
const NATURE_CLASS: Record<TimelineNature, string> = {
  [timelineCopy.nature.lesson]: 'border-primary/40 bg-primary/10 text-primary-strong',
  [timelineCopy.nature.adjust]: 'border-accent/40 bg-accent/10 text-accent-strong',
  [timelineCopy.nature.exam]: 'border-danger/40 bg-danger/10 text-danger-strong',
  [timelineCopy.nature.homework]: 'border-primary/40 bg-primary/5 text-primary-strong',
  [timelineCopy.nature.lab]: 'border-accent/40 bg-accent/5 text-accent-strong',
  [timelineCopy.nature.todo]: 'border-line bg-surface-muted text-muted',
};

interface TimelineRowProps {
  item: TimelineItem;
  /** 搜索命中的那一行：加高亮环并滚进视野 */
  focused: boolean;
  /** 高亮行挂的 ref：滚动定位用 */
  rowRef?: RefObject<HTMLLIElement | null> | undefined;
  /** 手动勾选：可选功能，只有带事件行且还没自动完成的待办/考试才有勾选框 */
  onToggleDone: (event: EventRow) => void;
  /** 删除一条调课/调休 */
  onDeleteAdjust: (event: EventRow) => void;
  /** 长按删除一条待办/作业/考试/实验 */
  onDeleteEvent: (event: EventRow) => void;
  /** 打开课程详情；没有 Provider 时课程行不可点 */
  onOpenLesson: ((target: AdjustTarget) => void) | null;
  /** 单击日程条目进入详情编辑 */
  onOpenEvent: (event: EventRow) => void;
}

/** 一条时间线：左侧竖排时间列（开始 / – / 结束）+ 颜色竖条 + 右侧标题与地点；自动完成的整行更灰。 */
function TimelineRow({
  item,
  focused,
  rowRef,
  onToggleDone,
  onDeleteAdjust,
  onDeleteEvent,
  onOpenLesson,
  onOpenEvent,
}: TimelineRowProps) {
  const lessonTarget = item.lessonTarget ?? null;
  // 长按删除：只对待办/作业/考试/实验；课次走课程详情，调课记录走行尾删除按钮
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const canLongPress = item.kind !== 'adjust' && item.kind !== 'lesson' && item.event !== undefined;
  const cancelLongPress = (): void => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const startLongPress = (): void => {
    if (!canLongPress) return;
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      suppressClick.current = true;
      onDeleteEvent(item.event as EventRow);
    }, 600);
  };
  const marker =
    item.autoDone ? (
      <span className="flex shrink-0 items-center" data-role="timeline-auto-check">
        <CircleCheck className="size-4 text-muted" role="img" aria-label={timelineCopy.autoDone(item.title)} />
      </span>
    ) : item.checkable && item.event !== undefined ? (
      // 勾选框本体只有 16px：外面套一层 44px 的 label 命中区，视觉尺寸不变（触控可达）
      <label className="flex min-h-tap min-w-tap shrink-0 cursor-pointer items-center justify-center" data-role="done-tap">
        <input
          type="checkbox"
          className="size-4 shrink-0"
          checked={item.done}
          aria-label={timelineCopy.markDone(item.title)}
          onChange={() => onToggleDone(item.event as EventRow)}
        />
      </label>
    ) : null;

  const body = (
    <>
      <span
        className="tabular flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 text-xs font-medium leading-tight text-ink"
        data-role={item.kind === 'lesson' ? 'lesson-time' : 'timeline-time'}
      >
        {item.startText === null && item.endText !== null && (
          <span className="text-[10px] font-normal text-muted">{timelineCopy.dueLabel}</span>
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
              {timelineCopy.running}
            </span>
          )}
          {item.countdownText !== undefined && item.countdownText !== null && (
            <span className="tabular shrink-0 text-[11px] font-semibold text-danger-strong" data-role="countdown-left">
              {item.countdownText}
            </span>
          )}
          {item.date === null && <span className="shrink-0 text-[11px] text-muted">{timelineCopy.undated}</span>}
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
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (item.event !== undefined && item.kind !== 'adjust') onOpenEvent(item.event as EventRow);
  };
  return (
    <li
      ref={rowRef}
      className={cn(
        'flex min-h-tap items-stretch gap-3 rounded-lg border border-line bg-surface px-3 py-3',
        item.completed && 'border-line/60 bg-surface-muted/40 text-muted opacity-40',
        focused && 'border-primary-strong ring-2 ring-primary-strong ring-offset-2 ring-offset-page',
      )}
      data-role="timeline-row"
      data-focused={focused ? 'true' : undefined}
      data-kind={item.kind}
      data-nature={item.nature}
      data-completed={item.completed ? 'true' : undefined}
      data-auto={item.autoDone ? 'true' : undefined}
      data-done={item.done ? 'true' : undefined}
      data-running={item.running ? 'true' : undefined}
      onClick={openEvent}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
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
          aria-label={timelineCopy.editEvent(item.title)}
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
          aria-label={timelineCopy.openLesson(item.title)}
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
            aria-label={timelineCopy.deleteAdjustLabel(item.title)}
            onClick={(event) => {
              event.stopPropagation();
              onDeleteAdjust(item.event as EventRow);
            }}
          >
            {timelineCopy.deleteButton}
          </Button>
        </span>
      )}
    </li>
  );
}
