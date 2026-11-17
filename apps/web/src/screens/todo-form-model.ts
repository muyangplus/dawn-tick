import { deleteReminder, setReminder, type EventRow, type Storage } from '@dawn-tick/core';

export type EventFormKind = 'todo' | 'homework' | 'exam' | 'lab';

export const ADVANCE_OPTIONS: ReadonlyArray<{ id: string; label: string; minutes: number }> = [
  { id: 'none', label: '不提醒', minutes: -1 },
  { id: 'same', label: '当天提醒', minutes: 0 },
  { id: 'half', label: '提前 30 分钟', minutes: 30 },
  { id: 'day', label: '提前 1 天', minutes: 24 * 60 },
  { id: 'three', label: '提前 3 天', minutes: 3 * 24 * 60 },
  { id: 'week', label: '提前 1 周', minutes: 7 * 24 * 60 },
];

/** 表单类型 + 是否关联课程 → 写入的条目类型；新建与编辑共用，避免两处各算一遍。 */
export function eventTypeFor(kind: EventFormKind, linked: boolean): EventRow['type'] {
  if (kind === 'lab') return 'lab';
  if (kind === 'exam') return 'exam';
  if (kind === 'homework') return 'homework';
  return linked ? 'todo' : 'temp';
}

/** 条目已有提醒的提前分钟 → 下拉选项；没有提醒为「不提醒」，不在选项里的取最接近的一项。 */
export function advanceIdFor(minutes: number | null): string {
  if (minutes === null) return 'none';
  let best = ADVANCE_OPTIONS[1]!;
  for (const option of ADVANCE_OPTIONS) {
    if (option.minutes < 0) continue;
    if (Math.abs(option.minutes - minutes) < Math.abs(best.minutes - minutes)) best = option;
  }
  return best.id;
}

export function advanceMinutesOf(id: string): number {
  return ADVANCE_OPTIONS.find((item) => item.id === id)?.minutes ?? -1;
}

/** 条目当前生效的提醒提前分钟；没有提醒返回 null。 */
export async function loadEventAdvance(storage: Storage, eventId: string): Promise<number | null> {
  const rows = await storage.collection<Record<string, unknown>>('reminders').getAll();
  const rule = rows.find(
    (row) =>
      row['deleted_at'] === null &&
      row['enabled'] === 1 &&
      row['target_type'] === 'event' &&
      row['target_id'] === eventId,
  );
  return rule === undefined ? null : Number(rule['advance_minutes']);
}

/** 按所选提前量写入或删除条目的提醒：编辑与新建共用。 */
export async function syncEventReminder(
  storage: Storage,
  userId: string,
  eventId: string,
  minutes: number,
): Promise<void> {
  if (minutes >= 0) {
    await setReminder(storage, { userId, targetType: 'event', targetId: eventId, advanceMinutes: minutes, skipHolidays: true });
    return;
  }
  const rows = await storage.collection<Record<string, unknown>>('reminders').getAll();
  for (const row of rows) {
    if (row['deleted_at'] !== null || row['target_type'] !== 'event' || row['target_id'] !== eventId) continue;
    await deleteReminder(storage, String(row['id']));
  }
}
