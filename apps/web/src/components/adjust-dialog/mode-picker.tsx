import { Button } from '../ui/button.tsx';
import type { AdjustSectionProps } from './section-props.ts';

const MODE_ITEMS = [
  { id: 'move', label: '改期' },
  { id: 'cancel', label: '停课' },
  { id: 'swap', label: '调休' },
  { id: 'extra', label: '临时加课' },
  { id: 'exam', label: '改为考试' },
] as const;

/** 五种调课操作的切换按钮组。 */
export function AdjustModePicker({ form, update }: AdjustSectionProps) {
  const { mode } = form;
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="调课操作" data-role="adjust-modes">
      {MODE_ITEMS.map((item) => (
        <Button
          key={item.id}
          size="sm"
          variant={mode === item.id ? 'primary' : 'secondary'}
          aria-pressed={mode === item.id}
          onClick={() => update({ mode: item.id })}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
