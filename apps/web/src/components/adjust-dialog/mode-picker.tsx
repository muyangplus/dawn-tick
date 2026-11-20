import { Button } from '../ui/button.tsx';
import type { AdjustSectionProps } from './section-props.ts';
import { adjustCopy } from '../../copy/timetable-adjust.ts';

const MODE_ITEMS = [
  { id: 'move', label: adjustCopy.modes.move },
  { id: 'cancel', label: adjustCopy.modes.cancel },
  { id: 'swap', label: adjustCopy.modes.swap },
  { id: 'extra', label: adjustCopy.modes.extra },
  { id: 'exam', label: adjustCopy.modes.exam },
] as const;

/** 五种调课操作的切换按钮组。 */
export function AdjustModePicker({ form, update }: AdjustSectionProps) {
  const { mode } = form;
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={adjustCopy.modesAria} data-role="adjust-modes">
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
