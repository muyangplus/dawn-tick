import { BookOpen, CalendarClock, CalendarX } from 'lucide-react';
import type { AppData } from '../../data.ts';
import { Button } from '../../components/ui/button.tsx';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import type { WeekEmptyKind } from '../../lib/week-empty.ts';

export interface WeekEmptyStateProps {
  kind: Exclude<WeekEmptyKind, 'none'>;
  data: AppData;
  compact: boolean;
  onPrevWindow: () => void;
  onNextWindow: () => void;
  onImport: () => void;
  /** 「只有非本周课程」时的添加课程入口 */
  onAddCourse: () => void;
}

/** 周视图空态：学期外 / 只有非本周课程 / 真空课表三种分开说。 */
export function WeekEmptyState({
  kind,
  data,
  compact,
  onPrevWindow,
  onNextWindow,
  onImport,
  onAddCourse,
}: WeekEmptyStateProps) {
  if (kind === 'outside-semester') {
    return (
      <div data-role="week-empty" data-empty-state="outside-semester">
        <EmptyState
          icon={CalendarX}
          title="学期外没有课程"
          description="当前窗口不在学期内，回到学期内可看安排"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={data.windowStart < (data.semester?.start_date ?? data.windowStart) ? onNextWindow : onPrevWindow}
            >
              回到学期内
            </Button>
          }
        />
      </div>
    );
  }
  if (kind === 'other-weeks') {
    return (
      <div data-role="week-empty" data-empty-state="other-weeks">
        <EmptyState
          icon={CalendarClock}
          title="这段时间只有非本周课程"
          description="打开「显示非本周课程」可看到虚线课卡，也可以直接添加一门课"
          action={
            <Button size="sm" variant="secondary" onClick={() => onAddCourse()}>
              添加课程
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div data-role="week-empty" data-empty-state="vacuum">
      <EmptyState
        icon={BookOpen}
        title="这段时间没有课程"
        description={compact ? '点右下角「＋」添加，或在设置里导入课表' : '从右上角「＋」添加，或在设置里导入课表'}
        action={
          <Button size="sm" variant="secondary" aria-label="导入课表" onClick={onImport}>
            导入课表
          </Button>
        }
      />
    </div>
  );
}
