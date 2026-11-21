import type { AiMessage } from './client.ts';

/** 输入太长时截断：粘贴整页 HTML 很容易超出模型上下文。 */
export const AI_INPUT_LIMIT = 60_000;

function clip(text: string): string {
  return text.length > AI_INPUT_LIMIT ? text.slice(0, AI_INPUT_LIMIT) : text;
}

export interface SchedulePromptContext {
  totalWeeks: number;
  /** 节次与时间，如 `1 08:00-08:45` */
  periods: readonly string[];
}

export function schedulePromptMessages(input: string, context: SchedulePromptContext): AiMessage[] {
  const periods = context.periods.length === 0 ? '（未提供）' : context.periods.join('；');
  return [
    {
      role: 'system',
      content: [
        '你把用户给出的课表内容（网页文本、表格或描述）整理成 JSON 数组，只输出 JSON，不要解释。',
        '每个元素：{"courseName": 课程名, "dayOfWeek": 1-7（周一为 1）, "periodStart": 开始节次, "periodEnd": 结束节次, "weeks": 上课周次数组如 [1,2,3] 或文本 "1-16"、"1-16单"、"2-16双", "room": 教室或 null, "teacher": 教师或 null}。',
        `本学期共 ${context.totalWeeks} 周。节次对照：${periods}。只有时间没有节次时按对照换算。`,
        '同一门课每个上课时段一项；不确定的字段填 null，不要编造。',
      ].join('\n'),
    },
    { role: 'user', content: clip(input) },
  ];
}

export interface EventPromptContext {
  /** 今天，YYYY-MM-DD */
  today: string;
  /** 今天星期几，1-7 */
  weekday: number;
  timeZone: string;
}

export function eventPromptMessages(input: string, context: EventPromptContext): AiMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你把用户的描述整理成日程 JSON 数组，只输出 JSON，不要解释。',
        '每个元素：{"kind": "todo" | "homework" | "exam", "title": 标题, "date": "YYYY-MM-DD", "startTime": "HH:MM" 或 null, "endTime": "HH:MM" 或 null, "location": 地点或 null, "note": 备注或 null}。',
        'homework 是作业，date 与 startTime 填截止时间；exam 是考试；其余都是 todo。',
        `今天是 ${context.today}，星期 ${context.weekday}，时区 ${context.timeZone}。「明天」「下周三」等按今天换算成具体日期。`,
        '描述里没有的字段填 null，不要编造。',
      ].join('\n'),
    },
    { role: 'user', content: clip(input) },
  ];
}
