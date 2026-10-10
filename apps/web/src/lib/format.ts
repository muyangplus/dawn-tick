export function formatCountdown(milliseconds: number): string {
  if (milliseconds <= 0) return '即将开始';
  const totalSeconds = Math.floor(milliseconds / 1000);
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
