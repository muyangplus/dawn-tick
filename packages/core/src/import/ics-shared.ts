/** ICS 导出与解析共用：学期与节次的输入形状、星期代码、文本转义。 */

export interface IcsSemester {
  id: string;
  start_date: string;
  total_weeks: number;
  time_zone: string;
}

export interface IcsTimeSlot {
  period_no: number;
  start_time: string;
  end_time: string;
}

export const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 单遍反转义：`\\n` 是反斜杠加 n，不能先换成换行再处理反斜杠。 */
export function unescapeIcsText(text: string): string {
  return text.replace(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));
}
