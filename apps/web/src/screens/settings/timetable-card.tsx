import { VIEW_DAY_OPTIONS, type AppSettings } from '@dawn-tick/core';
import { Field } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SwitchField } from '../../components/ui/controls.tsx';
import { timetableSettingsCopy } from '../../copy/settings-timetable.ts';

export interface TimetableCardProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

/**
 * 课表显示卡：周视图天数、今天为第一天、始终不显示周末、「显示非本周课程」与「显示停课课程」。
 *
 * 只包含周视图排布相关的偏好，改完立即通过 `onPatch` 落库并让课表重排。
 */
export function TimetableCard({ settings, onPatch }: TimetableCardProps) {
  return (
    <>
      <Field label={timetableSettingsCopy.viewDaysLabel} hint={timetableSettingsCopy.viewDaysHint} help={timetableSettingsCopy.viewDaysHelp}>
        <Select value={String(settings.viewDays)} onValueChange={(value) => void onPatch({ viewDays: Number(value) })}>
          <SelectTrigger aria-label={timetableSettingsCopy.viewDaysLabel}>
            <span>{timetableSettingsCopy.days(settings.viewDays)}</span>
          </SelectTrigger>
          <SelectContent>
            {VIEW_DAY_OPTIONS.map((days) => (
              <SelectItem key={days} value={String(days)}>
                {timetableSettingsCopy.days(days)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <SwitchField
        label={timetableSettingsCopy.weekStartsTodayLabel}
        description={timetableSettingsCopy.weekStartsTodayDescription}
        checked={settings.weekStartsToday}
        onCheckedChange={(checked) => void onPatch({ weekStartsToday: checked })}
        ariaLabel={timetableSettingsCopy.weekStartsTodayLabel}
      />
      <SwitchField
        label={timetableSettingsCopy.hideWeekendsLabel}
        description={timetableSettingsCopy.hideWeekendsDescription}
        checked={settings.hideWeekends}
        onCheckedChange={(checked) => void onPatch({ hideWeekends: checked })}
        ariaLabel={timetableSettingsCopy.hideWeekendsLabel}
      />
      <SwitchField
        label={timetableSettingsCopy.showOtherWeeksLabel}
        description={timetableSettingsCopy.showOtherWeeksDescription}
        checked={settings.showOtherWeeks}
        onCheckedChange={(checked) => void onPatch({ showOtherWeeks: checked })}
        ariaLabel={timetableSettingsCopy.showOtherWeeksLabel}
      />
      <SwitchField
        label={timetableSettingsCopy.showCancelledLabel}
        description={timetableSettingsCopy.showCancelledDescription}
        checked={settings.showCancelled}
        onCheckedChange={(checked) => void onPatch({ showCancelled: checked })}
        ariaLabel={timetableSettingsCopy.showCancelledLabel}
      />
    </>
  );
}
