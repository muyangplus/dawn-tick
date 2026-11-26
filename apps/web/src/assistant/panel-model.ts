/**
 * 助手面板的纯逻辑：动作清单、上下文说明、计划卡片的勾选与执行结果。界面只负责渲染与调度。
 */
import {
  AI_QUERY_ACTIONS,
  AI_TIMETABLE_ACTIONS,
  type AiAction,
  type AiPlanStep,
  type PlanExecution,
  type SemesterRow,
} from '@dawn-tick/core';
import { AI_ADJUST_ACTIONS } from './actions-adjust.ts';
import { AI_APP_ACTIONS } from './actions-app.ts';
import { AI_EVENT_ACTIONS } from './actions-events.ts';
import type { AssistantContext } from './host.ts';

/** 助手可用的全部动作：查询在前，写入随后，平台与界面动作最后。 */
export const ASSISTANT_ACTIONS: readonly AiAction<AssistantContext>[] = [
  ...AI_QUERY_ACTIONS,
  ...AI_TIMETABLE_ACTIONS,
  ...AI_EVENT_ACTIONS,
  ...AI_ADJUST_ACTIONS,
  ...AI_APP_ACTIONS,
];

const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日'];

export interface ContextNoteInput {
  today: string;
  /** 1-7，周一为 1 */
  todayOfWeek: number;
  timeZone: string;
  semester: Pick<SemesterRow, 'id' | 'name' | 'start_date' | 'total_weeks'> | null;
  week: number;
}

/** 拼在 system 提示后的当前状态：模型据此理解「今天」「这周」「下周三」。 */
export function contextNoteOf(input: ContextNoteInput): string {
  const lines = [`今天是 ${input.today}（星期${WEEKDAY[input.todayOfWeek - 1] ?? ''}），时区 ${input.timeZone}。`];
  if (input.semester === null) {
    lines.push('还没有学期。');
  } else {
    const { semester } = input;
    lines.push(
      `当前学期「${semester.name}」（id ${semester.id}），${semester.start_date} 开学，共 ${semester.total_weeks} 周，今天是第 ${input.week} 周。`,
    );
  }
  return lines.join('\n');
}

export type PlanCardStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** 对话里的一条：用户的话、助手回复或系统提示；`turn` 把计划卡片挂到对应的那一轮。 */
export interface ChatEntry {
  id: number;
  role: 'user' | 'assistant' | 'note';
  text: string;
  turn: number;
}

export interface PlanCard {
  step: AiPlanStep;
  /** 产出这一步的那一轮 */
  turn: number;
  checked: boolean;
  status: PlanCardStatus;
  /** 执行结果或失败原因 */
  message: string | null;
}

/** 新收到的计划：默认全选；高危项也勾上，执行前另行二次确认。 */
export function cardsOf(steps: readonly AiPlanStep[], turn: number): PlanCard[] {
  return steps.map((step) => ({ step, turn, checked: true, status: 'pending', message: null }));
}

/** 卡片挂在哪一条后面：那一轮的最后一条助手回复或提示；找不到时返回 null，放到对话末尾。 */
export function anchorOfTurn(entries: readonly ChatEntry[], turn: number): number | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as ChatEntry;
    if (entry.turn === turn && entry.role !== 'user') return entry.id;
  }
  return null;
}

export function toggleCard(cards: readonly PlanCard[], id: string): PlanCard[] {
  return cards.map((card) => (card.step.id === id && card.status === 'pending' ? { ...card, checked: !card.checked } : card));
}

/** 待执行的勾选项，按计划顺序。 */
export function selectedSteps(cards: readonly PlanCard[]): AiPlanStep[] {
  return cards.filter((card) => card.checked && card.status === 'pending').map((card) => card.step);
}

export function hasDanger(steps: readonly AiPlanStep[]): boolean {
  return steps.some((step) => step.risk === 'danger');
}

/** 执行开始：勾选项标为执行中。 */
export function markRunning(cards: readonly PlanCard[], steps: readonly AiPlanStep[]): PlanCard[] {
  const ids = new Set(steps.map((step) => step.id));
  return cards.map((card) => (ids.has(card.step.id) ? { ...card, status: 'running' } : card));
}

/** 把执行结果写回卡片：成功的记结果，失败的记原因，失败之后的勾选项标为未执行。 */
export function applyExecution(cards: readonly PlanCard[], steps: readonly AiPlanStep[], execution: PlanExecution): PlanCard[] {
  const done = new Map(execution.done.map((item) => [item.step.id, item.summary]));
  const ran = new Set(steps.map((step) => step.id));
  return cards.map((card) => {
    if (!ran.has(card.step.id)) return card;
    const summary = done.get(card.step.id);
    if (summary !== undefined) return { ...card, status: 'done', message: summary };
    if (execution.failed?.step.id === card.step.id) return { ...card, status: 'failed', message: execution.failed.message };
    return { ...card, status: 'skipped', message: null };
  });
}

/** 未执行的项可以再勾选执行。 */
export function resetSkipped(cards: readonly PlanCard[]): PlanCard[] {
  return cards.map((card) => (card.status === 'skipped' ? { ...card, status: 'pending', checked: false } : card));
}
