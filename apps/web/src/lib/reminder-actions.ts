import { DEFAULT_TIME_ZONE, addDays, dateWallClockToEpoch, formatDate } from '@dawn-tick/core';

/**
 * 提醒动作（R-07）的纯逻辑：动作集合、动作后的计划变更、静音/完成抑制。
 *
 * 边界：
 * - 只做纯计算，不碰存储、原生桥与界面；`useReminders.ts` 负责落库与排定；
 * - 动作集合是跨语言契约的一部分：Android `ReminderActionTable` 与 Rust
 *   `reminder_actions::actions_for_kind` 必须给出同一组动作；
 * - 课前提醒（课程）没有「完成」，日程提醒（待办/作业/考试/实验）才有。
 */

/** 通知/托盘上的动作标识。 */
export type ReminderActionId = 'snooze' | 'done' | 'mute';

/** 提醒类别：课前（课程）与四类日程。 */
export type ReminderKind = 'class' | 'todo' | 'homework' | 'exam' | 'lab';

export const SNOOZE_MINUTES = 10;
export const MUTE_MINUTES = 60;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** 托盘/通知保留已触发提醒的时长：动作仍可在一段时间内被点。 */
export const ACTION_KEEP_MS = 2 * HOUR_MS;

/** 动作文案：Android 通知按钮、Windows 托盘菜单与设置页说明共用。 */
export const ACTION_LABEL: Record<ReminderActionId, string> = {
  snooze: `贪睡 ${SNOOZE_MINUTES} 分钟`,
  done: '完成',
  mute: `勿扰 ${MUTE_MINUTES} 分钟`,
};

/** 全部动作，顺序即界面顺序。 */
export const ACTION_IDS: readonly ReminderActionId[] = ['snooze', 'done', 'mute'];

const ACTIONS_BY_KIND: Record<ReminderKind, readonly ReminderActionId[]> = {
  class: ['snooze', 'mute'],
  todo: ACTION_IDS,
  homework: ACTION_IDS,
  exam: ACTION_IDS,
  lab: ACTION_IDS,
};

export interface ReminderAction {
  id: ReminderActionId;
  label: string;
}

const KIND_VALUES: readonly ReminderKind[] = ['class', 'todo', 'homework', 'exam', 'lab'];

/** 把原生/持久化里的字符串归一成已知的提醒类别；未知返回 null。 */
export function normalizeReminderKind(value: unknown): ReminderKind | null {
  return typeof value === 'string' && (KIND_VALUES as readonly string[]).includes(value)
    ? (value as ReminderKind)
    : null;
}

/** 把原生/持久化里的字符串归一成已知动作；未知返回 null。 */
export function parseReminderAction(value: unknown): ReminderActionId | null {
  return typeof value === 'string' && (ACTION_IDS as readonly string[]).includes(value)
    ? (value as ReminderActionId)
    : null;
}

/**
 * 由提醒来源与日程类型推出类别：
 * 课表（课程/排课）一律是课前提醒；日程里 temp 与 todo 归为「日程」，
 * 作业/考试/实验保留各自类型（动作集合相同，文案与后续扩展用得到）。
 */
export function reminderKindOf(
  source: 'schedule' | 'course' | 'event',
  eventType?: string | null,
): ReminderKind {
  if (source !== 'event') return 'class';
  if (eventType === 'homework' || eventType === 'exam' || eventType === 'lab') return eventType;
  return 'todo';
}

/** 某类提醒可见的动作 id；课前提醒没有「完成」。 */
export function reminderActionIds(kind: ReminderKind): readonly ReminderActionId[] {
  return ACTIONS_BY_KIND[kind];
}

/** 某类提醒可见的动作（含文案）；界面直接消费。 */
export function actionsFor(kind: ReminderKind): readonly ReminderAction[] {
  return reminderActionIds(kind).map((id) => ({ id, label: ACTION_LABEL[id] }));
}

/** 该动作是否适用于该类别（例如课前提醒的「完成」不可见）。 */
export function supportsReminderAction(kind: ReminderKind, action: ReminderActionId): boolean {
  return reminderActionIds(kind).includes(action);
}

/** 动作作用的目标：一次投递的稳定 id、类别与条目 id。 */
export interface ReminderActionTarget {
  /** 通知/托盘的稳定 id（字符串） */
  id: string;
  kind: ReminderKind;
  /** 静音与完成的目标：课程 id 或 `events.id` */
  targetId: string;
  /** 本次提醒原定触发时刻 */
  triggerAt: number;
}

export interface SnoozePlan {
  action: 'snooze';
  id: string;
  kind: ReminderKind;
  targetId: string;
  /** 同一提醒下一次投递时刻 */
  triggerAt: number;
  minutes: number;
}

export interface MutePlan {
  action: 'mute';
  id: string;
  kind: ReminderKind;
  targetId: string;
  /** 该目标在此时刻前的提醒全部跳过 */
  until: number;
  minutes: number;
}

export interface DonePlan {
  action: 'done';
  id: string;
  kind: ReminderKind;
  targetId: string;
  /** 要写回 `events` 的字段：复用既有条目完成逻辑 */
  write: { eventId: string; fields: { done: 1 } };
  /** 当天结束时刻：此时刻前同一目标不再提醒 */
  suppressUntil: number;
}

/** 动作应用后的计划变更，只描述「要改什么」，不改任何状态。 */
export type ReminderPlan = SnoozePlan | MutePlan | DonePlan;

/** 某时区当天的结束时刻（次日 00:00 的 epoch 毫秒）。 */
export function endOfLocalDay(now: number, timeZone: string = DEFAULT_TIME_ZONE): number {
  return dateWallClockToEpoch(addDays(formatDate(now, timeZone), 1), '00:00', timeZone);
}

/**
 * 计算动作后的计划变更；动作不适用于该类别时返回 null。
 * 纯函数：`now` 由调用方传入，测试可完全固定。
 */
export function planReminderAction(
  target: ReminderActionTarget,
  action: ReminderActionId,
  now: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): ReminderPlan | null {
  if (!supportsReminderAction(target.kind, action)) return null;

  if (action === 'snooze') {
    return {
      action: 'snooze',
      id: target.id,
      kind: target.kind,
      targetId: target.targetId,
      triggerAt: now + SNOOZE_MINUTES * MINUTE_MS,
      minutes: SNOOZE_MINUTES,
    };
  }

  if (action === 'mute') {
    return {
      action: 'mute',
      id: target.id,
      kind: target.kind,
      targetId: target.targetId,
      until: now + MUTE_MINUTES * MINUTE_MS,
      minutes: MUTE_MINUTES,
    };
  }

  return {
    action: 'done',
    id: target.id,
    kind: target.kind,
    targetId: target.targetId,
    write: { eventId: target.targetId, fields: { done: 1 } },
    suppressUntil: endOfLocalDay(now, timeZone),
  };
}

/** 一次「勿扰」记录：该条目的提醒在 `until` 前跳过。 */
export interface MuteRecord {
  targetId: string;
  until: number;
}

/** 一次「完成」记录：条目当天剩余的提醒跳过。 */
export interface DoneRecord {
  targetId: string;
  until: number;
}

export interface Suppression {
  mutes: readonly MuteRecord[];
  done: readonly DoneRecord[];
}

export const NO_SUPPRESSION: Suppression = { mutes: [], done: [] };

/**
 * 这次提醒是否被「勿扰」或「完成」抑制。
 * 按目标 id + 触发时刻判断：静音窗口/当天只影响落在区间内的提醒，
 * 其它条目与窗口外的提醒照常投递。
 */
export function isReminderSuppressed(
  target: Pick<ReminderActionTarget, 'targetId' | 'triggerAt'>,
  suppression: Suppression,
): boolean {
  const hit = (record: MuteRecord | DoneRecord): boolean =>
    record.targetId === target.targetId && target.triggerAt < record.until;
  return suppression.mutes.some(hit) || suppression.done.some(hit);
}

/** 丢掉已经过期的抑制记录，避免窗口越积越长。 */
export function pruneSuppression(suppression: Suppression, now: number): Suppression {
  return {
    mutes: suppression.mutes.filter((record) => record.until > now),
    done: suppression.done.filter((record) => record.until > now),
  };
}

/** 带触发时刻的待投递项（贪睡队列、扫描结果都满足）。 */
export interface ScheduledDelivery {
  triggerAt: number;
}

/** 取出已到点与未到点的条目：贪睡队列每次扫描都过一遍这个函数。 */
export function takeDue<T extends ScheduledDelivery>(
  items: readonly T[],
  now: number,
): { due: T[]; rest: T[] } {
  const due: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (item.triggerAt <= now) due.push(item);
    else rest.push(item);
  }
  return { due, rest };
}
