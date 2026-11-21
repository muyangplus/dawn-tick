import type { AppData } from '../../data.ts';
import { Button } from '../ui/button.tsx';
import { Field, Input } from '../ui/input.tsx';
import type { AdjustSectionProps } from './section-props.ts';
import { adjustCopy } from '../../copy/timetable-adjust.ts';

const SCOPE_ITEMS = [
  { id: 'this', ...adjustCopy.scopes.this },
  { id: 'weekly', ...adjustCopy.scopes.weekly },
  { id: 'week', ...adjustCopy.scopes.week },
  { id: 'date', ...adjustCopy.scopes.date },
] as const;

/** 改期：生效范围 + 调整后的日期、节次与教室。 */
export function AdjustMoveFields({ form, update, data }: AdjustSectionProps & { data: AppData }) {
  const { scope, targetWeek, newDate, newStart, newEnd, newRoom } = form;
  const scopeItem = SCOPE_ITEMS.find((item) => item.id === scope) ?? SCOPE_ITEMS[0];
  const newDateHint = adjustCopy.newDateHint[scope];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1" role="group" aria-label={adjustCopy.scopesAria} data-role="adjust-scopes">
        <div className="flex flex-wrap gap-1">
          {SCOPE_ITEMS.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={scope === item.id ? 'primary' : 'secondary'}
              aria-pressed={scope === item.id}
              onClick={() => update({ scope: item.id })}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted">{scopeItem.hint}</span>
      </div>
      {scope === 'week' && (
        <Field label={adjustCopy.targetWeekLabel} hint={adjustCopy.targetWeekHint(data.semester?.total_weeks ?? 1)}>
          <Input
            type="number"
            min={1}
            max={data.semester?.total_weeks ?? 1}
            aria-label={adjustCopy.targetWeekLabel}
            className="w-24"
            value={targetWeek}
            onChange={(event) => update({ targetWeek: event.target.value })}
          />
        </Field>
      )}
      <Field label={adjustCopy.newDateLabel} hint={newDateHint}>
        <Input
          type="date"
          value={newDate}
          aria-label={adjustCopy.newDateLabel}
          onChange={(event) => update({ newDate: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label={adjustCopy.periodStartLabel}>
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label={adjustCopy.periodStartLabel}
            value={newStart}
            onChange={(event) => update({ newStart: event.target.value })}
          />
        </Field>
        <Field label={adjustCopy.periodEndLabel}>
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label={adjustCopy.periodEndLabel}
            value={newEnd}
            onChange={(event) => update({ newEnd: event.target.value })}
          />
        </Field>
        {scope !== 'weekly' && (
          <Field label={adjustCopy.roomLabel}>
            <Input
              value={newRoom}
              aria-label={adjustCopy.roomLabel}
              onChange={(event) => update({ newRoom: event.target.value })}
            />
          </Field>
        )}
      </div>
    </div>
  );
}
