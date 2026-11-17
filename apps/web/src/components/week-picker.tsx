import { maskToWeeks, parityMask } from '@dawn-tick/core';
import { Button } from './ui/button.tsx';
import { Field } from './ui/input.tsx';
import { cn } from '../lib/cn.ts';

/** 总周次内的全部周次。 */
function allWeeks(total: number): number[] {
  return Array.from({ length: total }, (_, index) => index + 1);
}

/** 单周/双周：位图口径交给 core 的 `parityMask`，这里只负责还原成周次集合。 */
function parityWeeks(total: number, parity: 'odd' | 'even'): number[] {
  return maskToWeeks(parityMask(total, parity), total);
}

export interface WeekPickerProps {
  /** 学期总周次（决定可选周次范围与「已选 N/M 周」的分母） */
  totalWeeks: number;
  /** 已选周次；受控值，组件内部不持有状态 */
  value: readonly number[];
  /** 选中集合变化时回传新集合（升序、去重） */
  onValueChange: (weeks: number[]) => void;
  /** 是否显示「全部 / 单周 / 双周 / 清空」快捷按钮；默认显示 */
  showShortcuts?: boolean;
  /** 周次按钮组的 `data-role`，供外部定位；不传则不带该属性 */
  dataRole?: string;
}

/** 周次选择：受控的周次集合选择器，两处表单共用同一份 DOM 与无障碍写法。 */
export function WeekPicker({
  totalWeeks,
  value,
  onValueChange,
  showShortcuts = true,
  dataRole,
}: WeekPickerProps) {
  // 快捷按钮只在显示且周次范围有效时计算：`parityMask` 对 0 周次会抛 RangeError
  const shortcuts =
    showShortcuts && totalWeeks > 0
      ? ([
          { id: 'all', label: '全部', weeks: allWeeks(totalWeeks) },
          { id: 'odd', label: '单周', weeks: parityWeeks(totalWeeks, 'odd') },
          { id: 'even', label: '双周', weeks: parityWeeks(totalWeeks, 'even') },
          { id: 'none', label: '清空', weeks: [] },
        ] as const)
      : [];

  function toggle(week: number): void {
    const selected = value.includes(week);
    onValueChange(
      selected ? value.filter((item) => item !== week) : [...value, week].sort((left, right) => left - right),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {showShortcuts && (
          <Field label="周次">
            <div className="flex flex-wrap gap-1">
              {shortcuts.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant="secondary"
                  aria-label={`周次${item.label}`}
                  onClick={() => onValueChange([...item.weeks])}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </Field>
        )}
        <span className="text-xs text-muted">
          已选 {value.length}/{totalWeeks} 周
        </span>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="周次选择" data-role={dataRole}>
        {allWeeks(totalWeeks).map((week) => {
          const selected = value.includes(week);
          return (
            <button
              key={week}
              type="button"
              aria-label={`第 ${week} 周`}
              aria-pressed={selected}
              onClick={() => toggle(week)}
              className={cn(
                'dt-btn-motion tabular size-tap rounded-sm border text-xs',
                selected ? 'border-primary-strong bg-primary text-on-primary' : 'border-line text-muted',
              )}
            >
              {week}
            </button>
          );
        })}
      </div>
    </div>
  );
}
