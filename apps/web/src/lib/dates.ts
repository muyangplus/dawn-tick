/** 本地时区的日期戳：YYYY-MM-DD（备份文件名、按天分组用）。 */
export function dayStampLocal(at: number): string {
  const date = new Date(at);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** UTC 的日期戳：YYYY-MM-DD（存储口径的导出名、未指定时区的日期列）。 */
export function dayStampUtc(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * 月日区间文案：8/19、8/19–23、8/30–9/2。
 * `to` 省略或与 `from` 相同时只给一个日期；跨月才重复月份。
 */
export function formatMonthDayRange(from: string, to: string = from): string {
  const monthDay = (date: string): string => {
    const [, month, day] = date.split('-');
    return `${Number(month)}/${Number(day)}`;
  };
  if (from === to) return monthDay(from);
  const [fromYear, fromMonth] = from.split('-');
  const [toYear, toMonth] = to.split('-');
  if (fromYear === toYear && fromMonth === toMonth) return `${monthDay(from)}–${Number(to.split('-')[2])}`;
  return `${monthDay(from)}–${monthDay(to)}`;
}
