import { formatCopy } from '../copy/format.ts';

/**
 * 节次范围文案：单节「第 3 节」，连堂「第 3–5 节」。
 * 连接符固定为 en dash（U+2013）；倒序输入按小→大归一化，避免出现「第 5–3 节」。
 */
export function formatPeriodRange(start: number, end: number): string {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return from === to ? formatCopy.periodSingle(from) : formatCopy.periodRange(from, to);
}

export function formatCountdown(milliseconds: number): string {
  if (milliseconds <= 0) return formatCopy.startingSoon;
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** 距结束还剩多久：mm:ss（超一小时带小时位）；到点给 00:00，不是「即将开始」。 */
export function formatRemaining(targetEpochMs: number, nowEpochMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((targetEpochMs - nowEpochMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatShortCountdown(milliseconds: number): string {
  if (milliseconds <= 0) return formatCopy.startingSoon;
  const totalMinutes = Math.floor(milliseconds / 60_000);
  if (totalMinutes < 60) return formatCopy.minutes(Math.max(1, totalMinutes));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? formatCopy.hours(hours) : formatCopy.hoursMinutes(hours, minutes);
}

export function formatDayCountdown(targetEpochMs: number, nowEpochMs: number): string {
  const days = Math.ceil((targetEpochMs - nowEpochMs) / 86_400_000);
  if (days <= 0) return formatCopy.today;
  return formatCopy.days(days);
}
