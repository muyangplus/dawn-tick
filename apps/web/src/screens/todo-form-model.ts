import { deleteReminder, formatDate, formatTime, maskToWeeks, setReminder, type EventRow, type Storage } from '@dawn-tick/core';
import { todoFormCopy } from '../copy/todo-form.ts';

export type EventFormKind = 'todo' | 'homework' | 'exam' | 'lab';

export const ADVANCE_OPTIONS: ReadonlyArray<{ id: string; label: string; minutes: number }> = [
  { id: 'none', label: todoFormCopy.advance.none, minutes: -1 },
  { id: 'same', label: todoFormCopy.advance.same, minutes: 0 },
  { id: 'half', label: todoFormCopy.advance.half, minutes: 30 },
  { id: 'day', label: todoFormCopy.advance.day, minutes: 24 * 60 },
  { id: 'three', label: todoFormCopy.advance.three, minutes: 3 * 24 * 60 },
  { id: 'week', label: todoFormCopy.advance.week, minutes: 7 * 24 * 60 },
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

/** 待办表单的全部输入。 */
export interface TodoFormState {
  kind: EventFormKind;
  title: string;
  courseId: string;
  dueDate: string;
  dueTime: string;
  advance: string;
  location: string;
  seatNo: string;
  note: string;
  countdown: boolean;
  manualDone: boolean;
  // 实验：只这一次 / 每周重复
  labRepeat: boolean;
  labWeekday: number;
  labPeriodStart: string;
  labPeriodEnd: string;
  labWeeks: number[];
  // 自定义时间：不按节次，直接给开始与结束时间
  customTime: boolean;
  startTime: string;
  endTime: string;
  /** 显示在课表上：实验默认开，日程/作业/考试默认关 */
  showInTimetable: boolean;
}

const allWeeks = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);

/** 某类型的开关默认值：作业与考试默认开倒计时，作业默认手动确认完成。 */
export function kindDefaults(kind: EventFormKind): Pick<TodoFormState, 'kind' | 'countdown' | 'manualDone'> {
  return { kind, countdown: kind === 'homework' || kind === 'exam', manualDone: kind === 'homework' };
}

export function blankTodoForm(kind: EventFormKind, today: string): TodoFormState {
  return {
    ...kindDefaults(kind),
    title: '',
    courseId: '',
    dueDate: today,
    dueTime: '09:00',
    advance: 'half',
    location: '',
    seatNo: '',
    note: '',
    labRepeat: false,
    labWeekday: 1,
    labPeriodStart: '1',
    labPeriodEnd: '2',
    labWeeks: allWeeks(16),
    customTime: false,
    startTime: '19:00',
    endTime: '21:00',
    showInTimetable: kind === 'lab',
  };
}

/** 新建打开时重置的字段：类型、开关、时刻与提前量回到默认，已填的标题等保留。 */
export function todoFormForCreate(kind: EventFormKind): Partial<TodoFormState> {
  return { ...kindDefaults(kind), dueTime: '09:00', advance: 'half', customTime: false, showInTimetable: kind === 'lab' };
}

export function kindOfEvent(row: EventRow): EventFormKind {
  return row.type === 'exam' ? 'exam' : row.type === 'lab' ? 'lab' : row.type === 'homework' ? 'homework' : 'todo';
}

/**
 * 编辑时按该条回填全部字段。提前量先给 none，真实值由调用方异步读提醒后补上。
 * 时刻回填原值：否则只改标题保存也会把时间写成默认的 09:00。
 */
export function todoFormFromEvent(
  row: EventRow,
  context: { timeZone: string; totalWeeks: number | null; now: number },
): TodoFormState {
  const anchor = row.start_at ?? row.due_at;
  return {
    kind: kindOfEvent(row),
    countdown: row.countdown === 1,
    manualDone: row.manual_done === 1,
    title: row.title,
    courseId: row.subject ?? '',
    dueDate: row.on_date ?? formatDate(anchor ?? context.now, context.timeZone),
    dueTime: anchor === null ? '09:00' : formatTime(anchor, context.timeZone),
    advance: 'none',
    location: row.location ?? '',
    seatNo: row.seat_no ?? '',
    note: row.note ?? '',
    customTime: row.start_time !== null && row.end_time !== null,
    startTime: row.start_time ?? '19:00',
    endTime: row.end_time ?? '21:00',
    labWeekday: row.as_day_of_week ?? 1,
    labRepeat: row.weeks_mask !== null,
    labWeeks:
      row.weeks_mask === null ? allWeeks(context.totalWeeks ?? 16) : maskToWeeks(row.weeks_mask, context.totalWeeks ?? 20),
    labPeriodStart: String(row.period_start ?? 1),
    labPeriodEnd: String(row.period_end ?? row.period_start ?? 2),
    showInTimetable: row.show_in_timetable === 1,
  };
}
