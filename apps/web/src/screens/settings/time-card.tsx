import { useMemo, useState } from 'react';
import type { AppSettings, TodoSort } from '@dawn-tick/core';
import { Combobox } from '../../components/ui/combobox.tsx';
import { Field } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/controls.tsx';
import { formatTimeZoneLabel, utcOffsetLabel } from '../../lib/tz-offset.ts';
import { isValidTimeZoneName, timeZoneCandidates } from '../../lib/timezones.ts';
import { timeCopy } from '../../copy/settings-time.ts';

export interface TimeCardProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

/**
 * 时间与日程卡：可按城市/地区搜索的时区与待办排序。
 *
 * 时区偏移按当前时刻计算：夏令时区在不同季节显示不同偏移，因此不缓存结果。
 */
export function TimeCard({ settings, onPatch }: TimeCardProps) {
  /** 时区搜索词：空着时显示当前时区（占位符），有输入时在全部 IANA 时区里筛 */
  const [zoneQuery, setZoneQuery] = useState('');
  const zoneCandidates = useMemo(() => timeZoneCandidates(zoneQuery), [zoneQuery]);
  /** 偏移按当前时刻算：夏令时区在不同季节显示不同偏移，不缓存结果 */
  const zoneNow = Date.now();
  const zoneInvalid = !isValidTimeZoneName(settings.timeZone);

  return (
    <>
      <Field
        label={timeCopy.timeZoneLabel}
        help={timeCopy.timeZoneHelp}
        error={zoneInvalid ? timeCopy.timeZoneInvalid : undefined}
      >
        <div
          className="flex flex-col"
          onBlur={(event) => {
            // 焦点离开这一块（含候选列表）时清空搜索词，重新显示当前时区
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setZoneQuery('');
          }}
        >
          <Combobox
            items={zoneCandidates}
            keyOf={(zone) => zone}
            value={zoneQuery}
            onValueChange={setZoneQuery}
            onSelect={(zone) => {
              setZoneQuery('');
              void onPatch({ timeZone: zone });
            }}
            renderItem={(zone) => {
              const offset = utcOffsetLabel(zone, zoneNow);
              return (
                <span className="flex w-full min-w-0 items-center justify-between gap-2">
                  <span className="truncate">{zone}</span>
                  {offset !== null && <span className="shrink-0 text-xs text-muted">{timeCopy.timeZoneOffset(offset)}</span>}
                </span>
              );
            }}
            placeholder={formatTimeZoneLabel(settings.timeZone, zoneNow)}
            ariaLabel={timeCopy.timeZoneLabel}
            emptyText={timeCopy.timeZoneEmpty}
          />
        </div>
      </Field>
      <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="size-4"
          checked={settings.autoTimeZone}
          onChange={(event) => void onPatch({ autoTimeZone: event.target.checked })}
        />
        {timeCopy.autoTimeZone}
      </label>
      <Field label={timeCopy.todoSortLabel}>
        <Select value={settings.todoSort} onValueChange={(value) => void onPatch({ todoSort: value as TodoSort })}>
          <SelectTrigger aria-label={timeCopy.todoSortLabel}>
            <span>{timeCopy.todoSort[settings.todoSort]}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="start">{timeCopy.todoSort.start}</SelectItem>
            <SelectItem value="type">{timeCopy.todoSortTypeOption}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}
