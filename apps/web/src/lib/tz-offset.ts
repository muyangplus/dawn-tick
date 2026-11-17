import { zoneOffsetMs } from '@dawn-tick/core';

const MS_PER_MINUTE = 60_000;

/**
 * 把相对 UTC 的偏移毫秒格式化成 `UTC+8` / `UTC-5` / `UTC+5:30` / `UTC+5:45`。
 *
 * 偏移一律按分钟取整：IANA 历史数据里有带秒的偏移，但当代时区都是整分钟；
 * 半小时（印度 +05:30）与 45 分钟（尼泊尔 +05:45、查塔姆 +12:45）必须保留分钟位。
 */
export function formatUtcOffset(offsetMs: number): string {
  const totalMinutes = Math.round(offsetMs / MS_PER_MINUTE);
  const sign = totalMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(totalMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}

/**
 * 时区在 `at` 时刻的偏移文案，非法时区返回 null。
 *
 * 偏移随时刻变化：夏令时区（如纽约、悉尼）冬夏不同，所以只按「传入的当前时刻」算一次，
 * 不缓存结果；注释里的示例也用固定时刻写死，避免单测随运行日期漂移。
 */
export function utcOffsetLabel(timeZone: string, at: number): string | null {
  try {
    return formatUtcOffset(zoneOffsetMs(at, timeZone));
  } catch {
    return null;
  }
}

/** 下拉里的完整标签：`Asia/Shanghai (UTC+8)`；非法时区只回原名，交给字段错误提示。 */
export function formatTimeZoneLabel(timeZone: string, at: number): string {
  const offset = utcOffsetLabel(timeZone, at);
  return offset === null ? timeZone : `${timeZone} (${offset})`;
}
