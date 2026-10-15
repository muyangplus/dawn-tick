import { CalendarRange, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import type { SemesterRow } from '@dawn-tick/core';
import { Button } from './ui/button.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/controls.tsx';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs.tsx';

export interface AppToolbarProps {
  semester: SemesterRow;
  semesters: readonly SemesterRow[];
  onSelectSemester: (id: string) => void;
  viewWeek: number;
  currentWeek: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  mode: 'week' | 'today';
  onModeChange: (mode: 'week' | 'today') => void;
  onSearch: () => void;
  onAdd: () => void;
  compact: boolean;
}

export function AppToolbar({
  semester,
  semesters,
  onSelectSemester,
  viewWeek,
  currentWeek,
  onPrevWeek,
  onNextWeek,
  onToday,
  mode,
  onModeChange,
  onSearch,
  onAdd,
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

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="上一屏" onClick={onPrevWeek}>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <span className="tabular min-w-16 text-center text-sm text-ink">
          第 {viewWeek} 周
          {viewWeek === currentWeek && <span className="text-xs text-muted"> · 本周</span>}
        </span>
        <Button variant="ghost" size="icon" aria-label="下一屏" onClick={onNextWeek}>
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>

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
        {!compact && (
          <Button variant="primary" size="sm" onClick={onAdd}>
            <Plus className="size-4" aria-hidden />
            添加课程
          </Button>
        )}
      </div>
    </header>
  );
}
