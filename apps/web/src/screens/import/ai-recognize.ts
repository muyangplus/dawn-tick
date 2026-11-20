import {
  listTimeSlots,
  loadSemester,
  parseScheduleDrafts,
  schedulePromptMessages,
  stripPageMarkers,
  type AiClient,
  type ImportedSchedule,
  type Storage,
} from '@dawn-tick/core';
import { importPasteCopy } from '../../copy/import-paste.ts';

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  amp: '&',
};
const ENTITY_RE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-z]+));/g;

/** 一遍解码：解出来的 & 不再参与下一轮，`&#38;amp;` 得到字面的 `&amp;`。 */
function decodeEntity(entity: string, dec?: string, hex?: string, name?: string): string {
  if (name !== undefined) return Object.hasOwn(NAMED_ENTITIES, name) ? (NAMED_ENTITIES[name] as string) : entity;
  const code = dec === undefined ? Number.parseInt(hex ?? '', 16) : Number(dec);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
}

/** 网页文本里的标签对模型没用，只占上下文：去掉标签、合并空白。 */
export function aiInputOf(text: string): string {
  const stripped = stripPageMarkers(text);
  if (!/<[a-z!/][^>]*>/i.test(stripped)) return stripped.trim();
  return stripped
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(tr|p|div|li|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(ENTITY_RE, decodeEntity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** 用 AI 把粘贴的内容整理成导入草稿；结果仍走导入预览，不直接写入。 */
export async function recognizeWithAi(
  client: AiClient,
  storage: Storage,
  semesterId: string,
  text: string,
): Promise<{ schedules: ImportedSchedule[]; warnings: string[] }> {
  const semester = await loadSemester(storage, semesterId);
  if (semester === undefined) throw new Error(importPasteCopy.noSemester);
  const slots = await listTimeSlots(storage, semesterId);
  const output = await client.complete({
    messages: schedulePromptMessages(aiInputOf(text), {
      totalWeeks: semester.total_weeks,
      periods: slots.map((slot) => `${slot.period_no} ${slot.start_time}-${slot.end_time}`),
    }),
  });
  const parsed = parseScheduleDrafts(output, {
    totalWeeks: semester.total_weeks,
    periodCount: slots.length === 0 ? 20 : Math.max(...slots.map((slot) => slot.period_no)),
  });
  return { schedules: parsed.items, warnings: parsed.warnings };
}
