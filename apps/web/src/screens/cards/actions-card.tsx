import { useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { addDays } from '@dawn-tick/core';
import { ADD_ACTIONS, useAddActions } from '../../components/add-menu.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../../components/ui/dialog.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { ActionMenu } from './card-actions.tsx';
import { defineCard, type ScheduleCardContext } from './registry.ts';
import { dateLabel } from './timeline.ts';
import { MAX_HOLIDAY_RANGE_DAYS } from './use-schedule-actions.ts';
import { scheduleCopy } from '../../copy/home-schedule.ts';

/** 顶部一行：日期选择器 + 加号菜单 + 溢出菜单 */
export const actionsCard = defineCard({
  id: 'actions',
  scope: 'schedule',
  title: scheduleCopy.actionsCardTitle,
  defaultZone: 'main',
  defaultOrder: 0,
  defaultVisible: true,
  render: (ctx) => <ScheduleActions {...ctx} />,
});

function ScheduleActions(ctx: ScheduleCardContext) {
  const { data, viewDate, onViewDateChange, onOpenAdjust, actions } = ctx;
  // 「添加」菜单与桌面工具栏、移动 FAB 同源：只派发动作，表单仍由 App 打开
  const addActions = useAddActions();
  const addItems =
    addActions === null
      ? [{ label: scheduleCopy.addTodoFallback, onSelect: ctx.onAddTodo }]
      : ADD_ACTIONS.map((item) => ({ label: item.label, onSelect: () => addActions[item.id]() }));
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeFrom, setRangeFrom] = useState(viewDate);
  const [rangeTo, setRangeTo] = useState(viewDate);
  const holidayName = data.holidayLabels.get(viewDate);

  /** 一次性把一段日期设为假日（最多 60 天；校验与写库在 actions 里）。 */
  async function setHolidayRange(): Promise<void> {
    const saved = await actions.setHolidayRange(rangeFrom, rangeTo);
    if (saved) setRangeOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon" variant="ghost" aria-label={scheduleCopy.prevDay} onClick={() => onViewDateChange(addDays(viewDate, -1))}>
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      <Input
        type="date"
        className="w-40"
        aria-label={scheduleCopy.viewDateLabel}
        value={viewDate}
        onChange={(event) => onViewDateChange(event.target.value)}
      />
      <Button size="sm" variant="secondary" onClick={() => onViewDateChange(data.today)}>
        {scheduleCopy.todayButton}
      </Button>
      <Button size="icon" variant="ghost" aria-label={scheduleCopy.nextDay} onClick={() => onViewDateChange(addDays(viewDate, 1))}>
        <ChevronRight className="size-4" aria-hidden />
      </Button>

      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-ink">
        <CalendarClock className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{dateLabel(viewDate, data.timeZone)}</span>
        {holidayName !== undefined && (
          <span className="shrink-0 text-xs font-normal text-muted">{scheduleCopy.holidayBadge(holidayName)}</span>
        )}
      </span>

      {/* 统计并入顶部日期行：不再放页脚，也不提供手动刷新（数据变化本来就会自动刷新） */}
      <span className="text-xs text-muted" data-role="schedule-stats">
        {scheduleCopy.stats(data.week, data.todayLessons.length, data.todos.length)}
      </span>

      <ActionMenu label={scheduleCopy.addMenu} icon={Plus} items={addItems} />

      <ActionMenu
        label={scheduleCopy.moreMenu}
        icon={MoreHorizontal}
        items={[
          // 调课不属于新增动作：留在「⋯」里，四个新增动作统一在「＋」
          { label: scheduleCopy.adjust, onSelect: () => onOpenAdjust(null) },
          holidayName === undefined
            ? { label: scheduleCopy.setHoliday, onSelect: () => void actions.setHoliday(viewDate) }
            : { label: scheduleCopy.setWorkday, onSelect: () => void actions.setWorkday(viewDate) },
          { label: scheduleCopy.holidayRange, onSelect: () => setRangeOpen(true) },
          { label: scheduleCopy.cancelDay, onSelect: () => void actions.cancelDayLessons(viewDate) },
          { label: scheduleCopy.moveDay, onSelect: () => void actions.moveDayLessons(viewDate) },
        ]}
      />

      <Dialog open={rangeOpen} onOpenChange={setRangeOpen}>
        <DialogContent title={scheduleCopy.rangeTitle} description={scheduleCopy.rangeDescription(MAX_HOLIDAY_RANGE_DAYS)}>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={scheduleCopy.rangeStart}>
              <Input
                type="date"
                className="w-40"
                aria-label={scheduleCopy.rangeStartLabel}
                value={rangeFrom}
                onChange={(event) => setRangeFrom(event.target.value)}
              />
            </Field>
            <span className="pb-3 text-sm text-muted">{scheduleCopy.rangeTo}</span>
            <Field label={scheduleCopy.rangeEnd}>
              <Input
                type="date"
                className="w-40"
                aria-label={scheduleCopy.rangeEndLabel}
                value={rangeTo}
                onChange={(event) => setRangeTo(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRangeOpen(false)}>
              {scheduleCopy.cancel}
            </Button>
            <Button variant="primary" onClick={() => void setHolidayRange()}>
              {scheduleCopy.rangeSubmit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
