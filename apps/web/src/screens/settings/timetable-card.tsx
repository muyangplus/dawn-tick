import { VIEW_DAY_OPTIONS, type AppSettings } from '@dawn-tick/core';
import { Field } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SwitchField } from '../../components/ui/controls.tsx';

export interface TimetableCardProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

/**
 * 课表显示卡：周视图天数、今天为第一天、始终不显示周末与「显示非本周课程」。
 *
 * 只包含周视图排布相关的偏好，改完立即通过 `onPatch` 落库并让课表重排。
 */
export function TimetableCard({ settings, onPatch }: TimetableCardProps) {
  return (
    <>
      <Field label="周视图天数" hint="1–7 天" help="列宽按屏宽等分，不横向滚动">
        <Select value={String(settings.viewDays)} onValueChange={(value) => void onPatch({ viewDays: Number(value) })}>
          <SelectTrigger aria-label="周视图天数">
            <span>{settings.viewDays} 天</span>
          </SelectTrigger>
          <SelectContent>
            {VIEW_DAY_OPTIONS.map((days) => (
              <SelectItem key={days} value={String(days)}>
                {days} 天
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <SwitchField
        label="今天为第一天"
        description="关掉从本周周一开头"
        checked={settings.weekStartsToday}
        onCheckedChange={(checked) => void onPatch({ weekStartsToday: checked })}
        ariaLabel="今天为第一天"
      />
      <SwitchField
        label="始终不显示周末"
        description="跳过周六日，列数按天数"
        checked={settings.hideWeekends}
        onCheckedChange={(checked) => void onPatch({ hideWeekends: checked })}
        ariaLabel="始终不显示周末"
      />
      <SwitchField
        label="周视图显示非本周课程"
        description="这一周不上的课用虚线框标出"
        checked={settings.showOtherWeeks}
        onCheckedChange={(checked) => void onPatch({ showOtherWeeks: checked })}
        ariaLabel="周视图显示非本周课程"
      />
    </>
  );
}
