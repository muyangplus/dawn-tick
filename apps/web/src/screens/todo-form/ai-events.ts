import {
  dateWallClockToEpoch,
  dayOfWeek,
  eventPromptMessages,
  formatDate,
  parseEventDrafts,
  type AiClient,
  type AiEventDraft,
  type CreateEventInput,
} from '@dawn-tick/core';
import { eventTypeFor, kindDefaults } from '../todo-form-model.ts';

/** 没给时刻的草稿按表单默认的 09:00。 */
export const AI_DEFAULT_TIME = '09:00';

export interface AiEventContext {
  userId: string;
  semesterId: string;
  timeZone: string;
}

/**
 * 草稿 → 新建条目的输入，与手动新建（不关联课程）同一口径：
 * 有起止时刻按自定义时间写，作业的截止取结束（没有结束取开始），地点只给考试。
 */
export function eventInputOfDraft(draft: AiEventDraft, context: AiEventContext): CreateEventInput {
  const defaults = kindDefaults(draft.kind);
  const customTime = draft.startTime !== null && draft.endTime !== null;
  const startAt = dateWallClockToEpoch(draft.date, draft.startTime ?? AI_DEFAULT_TIME, context.timeZone);
  const endAt = customTime ? dateWallClockToEpoch(draft.date, draft.endTime as string, context.timeZone) : null;
  return {
    userId: context.userId,
    type: eventTypeFor(draft.kind, false),
    title: draft.title,
    semesterId: context.semesterId,
    onDate: draft.date,
    startAt,
    endAt,
    dueAt: draft.kind === 'homework' ? (endAt ?? startAt) : null,
    subject: null,
    location: draft.kind === 'exam' ? draft.location : null,
    seatNo: null,
    note: draft.note,
    countdown: defaults.countdown,
    manualDone: defaults.manualDone,
    startTime: customTime ? draft.startTime : null,
    endTime: customTime ? draft.endTime : null,
    showInTimetable: false,
  };
}

/** 让 AI 把描述整理成日程草稿。 */
export async function generateEventDrafts(
  client: AiClient,
  input: string,
  now: number,
  timeZone: string,
  signal?: AbortSignal,
): Promise<{ items: AiEventDraft[]; warnings: string[] }> {
  const today = formatDate(now, timeZone);
  const output = await client.complete({
    messages: eventPromptMessages(input, { today, weekday: dayOfWeek(today), timeZone }),
    ...(signal === undefined ? {} : { signal }),
  });
  return parseEventDrafts(output);
}
