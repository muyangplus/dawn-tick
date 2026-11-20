import type { AppData } from '../../data.ts';
import { Button } from '../ui/button.tsx';
import { Field, Input } from '../ui/input.tsx';
import type { AdjustSectionProps } from './section-props.ts';

const SCOPE_ITEMS = [
  { id: 'this', label: '这一次', hint: '只改原日期所在周的这一次课' },
  { id: 'weekly', label: '每周', hint: '直接改课表本身，之后每周都在新时间' },
  { id: 'week', label: '指定周', hint: '把这节课调到一个指定周次' },
  { id: 'date', label: '指定日期', hint: '把这节课调到某一天，可跨周、可换星期' },
] as const;

/** 改期：生效范围 + 调整后的日期、节次与教室。 */
export function AdjustMoveFields({ form, update, data }: AdjustSectionProps & { data: AppData }) {
  const { scope, targetWeek, newDate, newStart, newEnd, newRoom } = form;
  const scopeItem = SCOPE_ITEMS.find((item) => item.id === scope) ?? SCOPE_ITEMS[0];
  const newDateHint =
    scope === 'weekly'
      ? '用它所在的星期几作为每周上课日'
      : scope === 'week'
        ? '用它所在的星期几落在「目标周」'
        : scope === 'this'
          ? '与原日期同一周内'
          : '可跨周、可换星期';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1" role="group" aria-label="生效范围" data-role="adjust-scopes">
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
        <Field label="目标周" hint={`第几周 · 1–${data.semester?.total_weeks ?? 1}`}>
          <Input
            type="number"
            min={1}
            max={data.semester?.total_weeks ?? 1}
            aria-label="目标周"
            className="w-24"
            value={targetWeek}
            onChange={(event) => update({ targetWeek: event.target.value })}
          />
        </Field>
      )}
      <Field label="调整后日期" hint={newDateHint}>
        <Input
          type="date"
          value={newDate}
          aria-label="调整后日期"
          onChange={(event) => update({ newDate: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="起始节">
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label="起始节"
            value={newStart}
            onChange={(event) => update({ newStart: event.target.value })}
          />
        </Field>
        <Field label="结束节">
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label="结束节"
            value={newEnd}
            onChange={(event) => update({ newEnd: event.target.value })}
          />
        </Field>
        {scope !== 'weekly' && (
          <Field label="教室（可选）">
            <Input
              value={newRoom}
              aria-label="教室（可选）"
              onChange={(event) => update({ newRoom: event.target.value })}
            />
          </Field>
        )}
      </div>
    </div>
  );
}
