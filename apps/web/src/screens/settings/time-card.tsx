import { useMemo, useState } from 'react';
import type { AppSettings, TodoSort } from '@dawn-tick/core';
import { Combobox } from '../../components/ui/combobox.tsx';
import { Field } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/controls.tsx';
import { formatTimeZoneLabel, utcOffsetLabel } from '../../lib/tz-offset.ts';
import { isValidTimeZoneName, timeZoneCandidates } from '../../lib/timezones.ts';

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
        label="时区"
        hint="默认上海；首次启动会按系统时区对齐一次"
        error={zoneInvalid ? '时区名无效' : undefined}
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
                  {offset !== null && <span className="shrink-0 text-xs text-muted">({offset})</span>}
                </span>
              );
            }}
            placeholder={formatTimeZoneLabel(settings.timeZone, zoneNow)}
            ariaLabel="时区"
            emptyText="没有匹配的时区，试试输入城市或地区名"
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
        时区跟随设备
      </label>
      <Field label="待办排序">
        <Select value={settings.todoSort} onValueChange={(value) => void onPatch({ todoSort: value as TodoSort })}>
          <SelectTrigger aria-label="待办排序">
            <span>{settings.todoSort === 'type' ? '按类型' : '按开始时间'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="start">按开始时间</SelectItem>
            <SelectItem value="type">按类型（作业 → 考试 → 实验 → 日程）</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}
