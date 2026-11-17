/**
 * 文案资源（小集中）：只收跨组件复用的句式与枚举，不做多语言。
 * 破坏性操作句式固定为 docs/04-界面与文案规范.md:108-109 的「将删除「X」及 …，不可撤销」。
 */

/**
 * 量词表：同一实体全仓只在这里定量词，调用点只传类别与数量。
 * 课程=门、排课=条、上课次数=节、节次=个、待办/日程/提醒=条、安排=项、时长=分钟。
 */
export const UNIT_LABEL = {
  course: '门',
  schedule: '条',
  lesson: '节',
  period: '个',
  event: '条',
  todo: '条',
  reminder: '条',
  plan: '项',
  semester: '个',
  minute: '分钟',
} as const;

export type CountType = keyof typeof UNIT_LABEL;

/** 计数句：COUNT('course', 3) → `3 门`；名词由调用点写在数字前（`课程 3 门`）。 */
export function COUNT(type: CountType, count: number): string {
  return `${count} ${UNIT_LABEL[type]}`;
}

/** 删除句：DELETE('数据结构', ['排课 3 条', '提醒 1 条']) → 将删除「数据结构」及排课 3 条、提醒 1 条，不可撤销 */
export function DELETE(object: string, parts: readonly string[] = []): string {
  const tail = parts.length > 0 ? `及${parts.join('、')}，不可撤销` : '，不可撤销';
  return `将删除「${object}」${tail}`;
}

/** 覆盖句：用于快照恢复、整库恢复这类不删除但会覆盖本机数据的动作。 */
export function OVERWRITE(object: string, detail: string): string {
  return `将用${object}覆盖本机数据${detail}，不可撤销`;
}

/**
 * 失败句式（P1-05）：`xx失败：原因。下一步`。
 * 没有原因时省略冒号段，例如 `重启失败。请手动重新打开应用`；下一步为空时只留句号。
 */
export function fail(what: string, reason?: string | null, next?: string): string {
  const detail = reason === undefined || reason === null || reason.trim() === '' ? '' : `：${reason.trim()}`;
  const step = next === undefined || next.trim() === '' ? '' : next.trim();
  return `${what}失败${detail}。${step}`;
}
