import { Plus, Trash2 } from 'lucide-react';
import { QUIET_RULE_LIMIT, WEEKDAY_LABELS, type QuietHours } from '@dawn-tick/core';
import { Button } from '../../components/ui/button.tsx';
import { SwitchField } from '../../components/ui/controls.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import {
  NEW_QUIET_RULE,
  quietRuleText,
  removeQuietRule,
  replaceQuietRule,
  toggleQuietDay,
} from './quiet-hours-model.ts';

const MODE_LABEL: Record<QuietHours['mode'], string> = { defer: '顺延到结束', skip: '跳过' };
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 勿扰时段：按星期设多段，跨午夜写成结束早于开始；时段内的提醒顺延或跳过。 */
export function QuietHoursField({
  value,
  onChange,
}: {
  value: QuietHours;
  onChange: (next: QuietHours) => Promise<void>;
}) {
  const patch = (next: QuietHours): void => void onChange(next);
  return (
    <div className="flex flex-col gap-2" data-role="quiet-hours">
      <SwitchField
        label="勿扰时段"
        description="时段内不弹提醒；结束早于开始表示跨到次日"
        checked={value.enabled}
        onCheckedChange={(checked) => patch({ ...value, enabled: checked })}
        ariaLabel="勿扰时段"
        dataRole="quiet-hours-switch"
      />
      {value.enabled && (
        <>
          <Field label="时段内的提醒">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(MODE_LABEL) as QuietHours['mode'][]).map((mode) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={value.mode === mode ? 'primary' : 'secondary'}
                  aria-pressed={value.mode === mode}
                  onClick={() => patch({ ...value, mode })}
                >
                  {MODE_LABEL[mode]}
                </Button>
              ))}
            </div>
          </Field>
          <ul className="flex flex-col gap-2">
            {value.rules.map((rule, index) => (
              <li
                key={index}
                className="flex flex-col gap-2 rounded-md border border-line p-2"
                data-role="quiet-hours-rule"
                aria-label={quietRuleText(rule)}
              >
                <div className="flex flex-wrap gap-1" role="group" aria-label="星期">
                  {WEEKDAY_LABELS.map((label, at) => {
                    const day = at + 1;
                    const on = rule.days.includes(day);
                    return (
                      <Button
                        key={day}
                        size="sm"
                        variant={on ? 'primary' : 'secondary'}
                        aria-pressed={on}
                        aria-label={label}
                        onClick={() => patch(replaceQuietRule(value, index, toggleQuietDay(rule, day)))}
                      >
                        {label.slice(1)}
                      </Button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  <Input
                    type="time"
                    className="w-28"
                    aria-label="开始时间"
                    value={rule.start}
                    onChange={(event) => {
                      if (CLOCK.test(event.target.value)) patch(replaceQuietRule(value, index, { ...rule, start: event.target.value }));
                    }}
                  />
                  <span className="text-muted">至</span>
                  <Input
                    type="time"
                    className="w-28"
                    aria-label="结束时间"
                    value={rule.end}
                    onChange={(event) => {
                      if (CLOCK.test(event.target.value)) patch(replaceQuietRule(value, index, { ...rule, end: event.target.value }));
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`删除勿扰时段 ${quietRuleText(rule)}`}
                    onClick={() => patch(removeQuietRule(value, index))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
                <span className="text-xs text-muted">{quietRuleText(rule)}</span>
              </li>
            ))}
          </ul>
          {value.rules.length < QUIET_RULE_LIMIT && (
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              data-role="quiet-hours-add"
              onClick={() => patch({ ...value, rules: [...value.rules, NEW_QUIET_RULE] })}
            >
              <Plus className="size-4" aria-hidden />
              添加时段
            </Button>
          )}
          <span className="text-xs text-muted">顺延后课已开始的提醒不再弹出</span>
        </>
      )}
    </div>
  );
}
