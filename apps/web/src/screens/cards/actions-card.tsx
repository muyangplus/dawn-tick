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
  const { data, viewDate, onViewDateChange, onOpenAdjust, actions } = ctx;
  // 「添加」菜单与桌面工具栏、移动 FAB 同源：只派发动作，表单仍由 App 打开
  const addActions = useAddActions();
  const addItems =
    addActions === null
      ? [{ label: '添加待办', onSelect: ctx.onAddTodo }]
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

      {/* 统计并入顶部日期行：不再放页脚，也不提供手动刷新（数据变化本来就会自动刷新） */}
      <span className="text-xs text-muted" data-role="schedule-stats">
        今天第 {data.week} 周 · 共 {data.todayLessons.length} 节课 · {data.todos.length} 条待办
      </span>

      <ActionMenu label="添加" icon={Plus} items={addItems} />

      <ActionMenu
        label="更多操作"
        icon={MoreHorizontal}
        items={[
          // 调课不属于新增动作：留在「⋯」里，四个新增动作统一在「＋」
          { label: '调课', onSelect: () => onOpenAdjust(null) },
          holidayName === undefined
            ? { label: '设为假日', onSelect: () => void actions.setHoliday(viewDate) }
            : { label: '设为非假日', onSelect: () => void actions.setWorkday(viewDate) },
          { label: '连续假期', onSelect: () => setRangeOpen(true) },
          { label: '当天全部停课', onSelect: () => void actions.cancelDayLessons(viewDate) },
          { label: '当天顺延到次日', onSelect: () => void actions.moveDayLessons(viewDate) },
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
