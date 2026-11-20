import { CalendarClock } from 'lucide-react';
import { addDays } from '@dawn-tick/core';
import { Button } from '../../components/ui/button.tsx';
import { defineCard } from './registry.ts';
import { buildTimeline } from './timeline.ts';
import { scheduleCopy } from '../../copy/home-schedule.ts';

/** 侧列：明日预告 */
export const tomorrowCard = defineCard({
  id: 'tomorrow',
  scope: 'schedule',
  title: scheduleCopy.tomorrowCardTitle,
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
        <span className="text-xs text-muted">{scheduleCopy.tomorrowPreview(count)}</span>
        <Button size="sm" variant="secondary" onClick={() => onViewDateChange(tomorrow)}>
          {scheduleCopy.tomorrowButton}
        </Button>
      </div>
    );
  },
});
