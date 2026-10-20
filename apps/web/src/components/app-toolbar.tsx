import { CalendarRange, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { dayOfWeek, type SemesterRow } from '@dawn-tick/core';
import { AddMenuButton, type AddActionHandlers } from './add-menu.tsx';
import { Button } from './ui/button.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/controls.tsx';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs.tsx';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 周模式的翻页信息：第几周、本周是第几周、首/末周时翻不动。 */
export interface WeekNavProps {
  viewWeek: number;
  currentWeek: number;
  /** 第 1 周不能再往前、最后一周不能再往后（与日模式同一份边界判定） */
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/** 日模式的翻页信息：查看的日期与能否前后翻。 */
export interface DayNavProps {
  date: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export interface AppToolbarProps {
  semester: SemesterRow;
  semesters: readonly SemesterRow[];
  onSelectSemester: (id: string) => void;
  mode: 'week' | 'today';
  onModeChange: (mode: 'week' | 'today') => void;
  week: WeekNavProps;
  day: DayNavProps;
  /** 回到今天：周模式回默认起点，日模式回今天 */
  onToday: () => void;
  onSearch: () => void;
  /** 统一「＋」菜单的四类动作：桌面端是主按钮 + 下拉 */
  addActions: AddActionHandlers;
  compact: boolean;
}

/** 日模式的日期文案：10/19 周一。 */
function dayLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)} ${WEEKDAYS[dayOfWeek(date) - 1] ?? ''}`;
}

export function AppToolbar({
  semester,
  semesters,
  onSelectSemester,
  mode,
  onModeChange,
  week,
  day,
  onToday,
  onSearch,
  addActions,
  compact,
}: AppToolbarProps) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 tablet:px-4">
      <Select value={semester.id} onValueChange={onSelectSemester}>
        <SelectTrigger aria-label="选择学期" className="w-44">
          <span className="truncate">{semester.name}</span>
        </SelectTrigger>
        <SelectContent>
          {semesters.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {mode === 'week' ? (
        <div className="flex items-center gap-1" data-role="week-nav">
          <Button variant="ghost" size="icon" aria-label="上一屏" disabled={!week.canPrev} onClick={week.onPrev}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="tabular min-w-16 text-center text-sm text-ink">
            第 {week.viewWeek} 周
            {week.viewWeek === week.currentWeek && <span className="text-xs text-muted"> · 本周</span>}
          </span>
          <Button variant="ghost" size="icon" aria-label="下一屏" disabled={!week.canNext} onClick={week.onNext}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1" data-role="day-nav">
          <Button variant="ghost" size="icon" aria-label="前一天" disabled={!day.canPrev} onClick={day.onPrev}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="tabular min-w-24 text-center text-sm text-ink" data-role="day-date">
            {dayLabel(day.date)}
          </span>
          <Button variant="ghost" size="icon" aria-label="后一天" disabled={!day.canNext} onClick={day.onNext}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      )}

      <Button variant="secondary" size="sm" aria-label="回到今天" onClick={onToday}>
        <CalendarRange className="size-4" aria-hidden />
        今天
      </Button>

      <Tabs value={mode} onValueChange={(value) => onModeChange(value as 'week' | 'today')}>
        <TabsList>
          <TabsTrigger value="week">周</TabsTrigger>
          <TabsTrigger value="today">日</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="搜索" onClick={onSearch} title="/">
          <Search className="size-4" aria-hidden />
        </Button>
        {!compact && <AddMenuButton actions={addActions} />}
      </div>
    </header>
  );
}
