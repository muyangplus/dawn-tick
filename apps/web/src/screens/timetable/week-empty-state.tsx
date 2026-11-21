import { BookOpen, CalendarClock, CalendarX } from 'lucide-react';
import type { AppData } from '../../data.ts';
import { Button } from '../../components/ui/button.tsx';
import { EmptyState } from '../../components/ui/empty-state.tsx';
import type { WeekEmptyKind } from '../../lib/week-empty.ts';
import { weekCopy } from '../../copy/timetable-week.ts';

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
          title={weekCopy.outsideTitle}
          description={weekCopy.outsideDescription}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={data.windowStart < (data.semester?.start_date ?? data.windowStart) ? onNextWindow : onPrevWindow}
            >
              {weekCopy.outsideAction}
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
          title={weekCopy.otherWeeksTitle}
          description={weekCopy.otherWeeksDescription}
          action={
            <Button size="sm" variant="secondary" onClick={() => onAddCourse()}>
              {weekCopy.otherWeeksAction}
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
        title={weekCopy.vacuumTitle}
        description={compact ? weekCopy.vacuumDescriptionCompact : weekCopy.vacuumDescription}
        action={
          <Button size="sm" variant="secondary" aria-label={weekCopy.importAction} onClick={onImport}>
            {weekCopy.importAction}
          </Button>
        }
      />
    </div>
  );
}
