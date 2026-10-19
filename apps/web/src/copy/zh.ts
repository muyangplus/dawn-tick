/**
 * 文案资源（小集中）：只收跨组件复用的句式与枚举，不做多语言。
 * 破坏性操作句式固定为 docs/04-界面与文案规范.md:108-109 的「将删除「X」及 …，不可撤销」。
 */

/** 删除句：DELETE('数据结构', ['3 条排课', '1 条提醒']) → 将删除「数据结构」及3 条排课、1 条提醒，不可撤销 */
export function DELETE(object: string, parts: readonly string[] = []): string {
  const tail = parts.length > 0 ? `及${parts.join('、')}，不可撤销` : '，不可撤销';
  return `将删除「${object}」${tail}`;
}

/** 覆盖句：用于快照恢复、整库恢复这类不删除但会覆盖本机数据的动作。 */
export function OVERWRITE(object: string, detail: string): string {
  return `将用${object}覆盖本机数据${detail}，不可撤销`;
}
