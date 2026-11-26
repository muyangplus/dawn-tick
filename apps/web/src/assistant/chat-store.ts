/**
 * 助手对话的本机保留：对话、计划卡片与模型历史存在 `app_meta`，不进备份与同步。
 * 存之前去掉计划步骤的 `params`（执行时按 args 重新解析，预览文字已在 `preview` 里）。
 */
import type { AiChatMessage, AiPlanStep, AssistantMode, Storage } from '@dawn-tick/core';
import type { SnapshotEntry } from '../backup.ts';
import { ASSISTANT_CHAT_META_KEY } from '../lib/meta-keys.ts';
import { readMetaJson, writeMetaJson } from '../lib/meta.ts';
import type { ChatEntry, PlanCard } from './panel-model.ts';

/** 最多保留的对话条数：更早的连同挂在上面的卡片一起丢掉 */
export const STORED_ENTRY_LIMIT = 200;

export interface StoredChat {
  version: 1;
  entries: ChatEntry[];
  cards: PlanCard[];
  history: AiChatMessage[];
  mode: AssistantMode | null;
  turn: number;
  snapshot: SnapshotEntry | null;
}

export const EMPTY_CHAT: StoredChat = {
  version: 1,
  entries: [],
  cards: [],
  history: [],
  mode: null,
  turn: 0,
  snapshot: null,
};

/** 存储用的形状：条数封顶，步骤去掉 params。 */
export function toStored(chat: Omit<StoredChat, 'version'>): StoredChat {
  const entries = chat.entries.slice(-STORED_ENTRY_LIMIT);
  const firstTurn = entries[0]?.turn ?? chat.turn;
  const cards = chat.cards
    .filter((card) => card.turn >= firstTurn)
    .map((card) => ({ ...card, step: { ...card.step, params: null } }));
  return { version: 1, entries, cards, history: chat.history, mode: chat.mode, turn: chat.turn, snapshot: chat.snapshot };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function entryOf(value: unknown): ChatEntry | null {
  if (!isRecord(value)) return null;
  const { id, role, text, turn } = value;
  if (typeof id !== 'number' || typeof text !== 'string' || typeof turn !== 'number') return null;
  if (role !== 'user' && role !== 'assistant' && role !== 'note') return null;
  return { id, role, text, turn };
}

function stepOf(value: unknown): AiPlanStep | null {
  if (!isRecord(value)) return null;
  const { id, action, args, preview, risk } = value;
  if (typeof id !== 'string' || typeof action !== 'string' || typeof preview !== 'string' || !isRecord(args)) return null;
  if (risk !== 'write' && risk !== 'danger') return null;
  return { id, action, args, params: null, preview, risk };
}

const CARD_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;

function cardOf(value: unknown): PlanCard | null {
  if (!isRecord(value)) return null;
  const step = stepOf(value['step']);
  const { turn, checked, status, message } = value;
  if (step === null || typeof turn !== 'number' || typeof checked !== 'boolean') return null;
  if (!CARD_STATUSES.includes(status as PlanCard['status'])) return null;
  if (message !== null && typeof message !== 'string') return null;
  // 存下时还在执行的项：结果不明，按未执行处理，可以重新勾选
  const resolved = status === 'running' ? 'skipped' : (status as PlanCard['status']);
  return { step, turn, checked: resolved === 'skipped' ? false : checked, status: resolved, message };
}

function messageOf(value: unknown): AiChatMessage | null {
  if (!isRecord(value) || typeof value['content'] !== 'string') return null;
  const content = value['content'];
  switch (value['role']) {
    case 'system':
    case 'user':
      return { role: value['role'], content };
    case 'tool':
      return typeof value['toolCallId'] === 'string' ? { role: 'tool', toolCallId: value['toolCallId'], content } : null;
    case 'assistant': {
      const calls = value['toolCalls'];
      if (calls === undefined) return { role: 'assistant', content };
      if (!Array.isArray(calls)) return null;
      const toolCalls = calls.flatMap((call: unknown) =>
        isRecord(call) && typeof call['id'] === 'string' && typeof call['name'] === 'string' && typeof call['arguments'] === 'string'
          ? [{ id: call['id'], name: call['name'], arguments: call['arguments'] }]
          : [],
      );
      return toolCalls.length === calls.length ? { role: 'assistant', content, toolCalls } : null;
    }
    default:
      return null;
  }
}

function snapshotOf(value: unknown): SnapshotEntry | null {
  if (!isRecord(value)) return null;
  const { id, createdAt, bytes, kind } = value;
  if (typeof id !== 'string' || typeof createdAt !== 'number' || typeof bytes !== 'number') return null;
  if (kind !== 'file' && kind !== 'json') return null;
  return { id, createdAt, bytes, kind };
}

/** 校验存储内容；任何一处不对整段作废（返回 null），不拼半截对话。 */
export function parseStoredChat(value: unknown): StoredChat | null {
  if (!isRecord(value) || value['version'] !== 1) return null;
  const { entries, cards, history, mode, turn, snapshot } = value;
  if (!Array.isArray(entries) || !Array.isArray(cards) || !Array.isArray(history) || typeof turn !== 'number') return null;
  if (mode !== null && mode !== 'tools' && mode !== 'json') return null;
  const parsedEntries = entries.map(entryOf);
  const parsedCards = cards.map(cardOf);
  const parsedHistory = history.map(messageOf);
  if (parsedEntries.includes(null) || parsedCards.includes(null) || parsedHistory.includes(null)) return null;
  const parsedSnapshot = snapshot === null || snapshot === undefined ? null : snapshotOf(snapshot);
  if (snapshot !== null && snapshot !== undefined && parsedSnapshot === null) return null;
  return {
    version: 1,
    entries: parsedEntries as ChatEntry[],
    cards: parsedCards as PlanCard[],
    history: parsedHistory as AiChatMessage[],
    mode,
    turn,
    snapshot: parsedSnapshot,
  };
}

export function loadStoredChat(storage: Storage): Promise<StoredChat> {
  return readMetaJson(storage, ASSISTANT_CHAT_META_KEY, { parse: parseStoredChat, fallback: EMPTY_CHAT, scope: 'app' });
}

export async function saveStoredChat(storage: Storage, chat: Omit<StoredChat, 'version'>): Promise<void> {
  await writeMetaJson(storage, ASSISTANT_CHAT_META_KEY, toStored(chat), { scope: 'app' });
}
