/**
 * 节次范围文案：单节「第 3 节」，连堂「第 3–5 节」。
 * 连接符固定为 en dash（U+2013）；倒序输入按小→大归一化，避免出现「第 5–3 节」。
 */
export function formatPeriodRange(start: number, end: number): string {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return from === to ? `第 ${from} 节` : `第 ${from}–${to} 节`;
}

export function formatCountdown(milliseconds: number): string {
  if (milliseconds <= 0) return '即将开始';
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
  if (milliseconds <= 0) return '即将开始';
  const totalMinutes = Math.floor(milliseconds / 60_000);
  if (totalMinutes < 60) return `${Math.max(1, totalMinutes)} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分`;
}

export function formatDayCountdown(targetEpochMs: number, nowEpochMs: number): string {
  const days = Math.ceil((targetEpochMs - nowEpochMs) / 86_400_000);
  if (days <= 0) return '今天';
  return `${days} 天`;
}
