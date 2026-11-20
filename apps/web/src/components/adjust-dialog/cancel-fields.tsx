import { Button } from '../ui/button.tsx';
import { Field, Input } from '../ui/input.tsx';
import type { AdjustSectionProps } from './section-props.ts';
import { adjustCopy } from '../../copy/timetable-adjust.ts';

const RANGE_ITEMS = [
  { id: 'this', ...adjustCopy.cancelRanges.this },
  { id: 'range', ...adjustCopy.cancelRanges.range },
  { id: 'from', ...adjustCopy.cancelRanges.from },
] as const;

const TARGET_ITEMS = [
  { id: 'schedule', label: adjustCopy.cancelTargets.schedule },
  { id: 'course', label: adjustCopy.cancelTargets.course },
] as const;

/** 停课：范围（这一次 / 一段日期 / 结课）与对象（这个时段 / 整门课）；开始日沿用「原日期」。 */
export function AdjustCancelFields({ form, update }: AdjustSectionProps) {
  const { cancelRange, cancelTarget, cancelTo } = form;
  const rangeItem = RANGE_ITEMS.find((item) => item.id === cancelRange) ?? RANGE_ITEMS[0];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1" role="group" aria-label={adjustCopy.cancelRangesAria} data-role="cancel-ranges">
        <div className="flex flex-wrap gap-1">
          {RANGE_ITEMS.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={cancelRange === item.id ? 'primary' : 'secondary'}
              aria-pressed={cancelRange === item.id}
              onClick={() => update({ cancelRange: item.id })}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted">{rangeItem.hint}</span>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={adjustCopy.cancelTargetsAria} data-role="cancel-targets">
        {TARGET_ITEMS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={cancelTarget === item.id ? 'primary' : 'secondary'}
            aria-pressed={cancelTarget === item.id}
            onClick={() => update({ cancelTarget: item.id })}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {cancelRange === 'range' && (
        <Field label={adjustCopy.cancelToLabel}>
          <Input
            type="date"
            value={cancelTo}
            aria-label={adjustCopy.cancelToLabel}
            onChange={(event) => update({ cancelTo: event.target.value })}
          />
        </Field>
      )}
    </div>
  );
}
