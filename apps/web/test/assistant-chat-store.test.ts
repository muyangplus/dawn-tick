import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiPlanStep } from '@dawn-tick/core';
import { createStorage } from '@dawn-tick/core/testing';
import {
  EMPTY_CHAT,
  STORED_ENTRY_LIMIT,
  loadStoredChat,
  parseStoredChat,
  saveStoredChat,
  toStored,
  type StoredChat,
} from '../src/assistant/chat-store.ts';
import type { ChatEntry, PlanCard } from '../src/assistant/panel-model.ts';
import { ASSISTANT_CHAT_META_KEY } from '../src/lib/meta-keys.ts';

function step(id: string, risk: AiPlanStep['risk'] = 'write'): AiPlanStep {
  return { id, action: 'create_event', args: { title: id }, params: { title: id, parsed: true }, preview: `预览 ${id}`, risk };
}

function card(id: string, turn: number, overrides: Partial<PlanCard> = {}): PlanCard {
  return { step: step(id), turn, checked: true, status: 'pending', message: null, ...overrides };
}

function entry(id: number, role: ChatEntry['role'], turn: number): ChatEntry {
  return { id, role, text: `第 ${id} 条`, turn };
}

function sampleChat(): Omit<StoredChat, 'version'> {
  return {
    entries: [entry(1, 'user', 1), entry(2, 'assistant', 1), entry(3, 'user', 2), entry(4, 'note', 2)],
    cards: [card('s1', 1, { status: 'done', message: '已新建' }), card('s2', 2, { step: step('s2', 'danger'), checked: false })],
    history: [
      { role: 'user', content: '问' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_lessons', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', content: '{"result":[]}' },
      { role: 'assistant', content: '没有课' },
      { role: 'system', content: '系统' },
    ],
    mode: 'tools',
    turn: 2,
    snapshot: { id: 'backup:1', createdAt: 1_790_000_000_000, bytes: 1024, kind: 'json' },
  };
}

/** 序列化再解析：模拟写入 app_meta 后读回。 */
function roundTrip(value: unknown): StoredChat | null {
  return parseStoredChat(JSON.parse(JSON.stringify(value)));
}

// ---- toStored ----

test('toStored：去掉步骤的 params，其余原样，带 version 1', () => {
  const chat = sampleChat();
  const stored = toStored(chat);
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.entries, chat.entries);
  assert.deepEqual(stored.history, chat.history);
  assert.equal(stored.mode, 'tools');
  assert.equal(stored.turn, 2);
  assert.deepEqual(stored.snapshot, chat.snapshot);
  for (const item of stored.cards) assert.equal(item.step.params, null);
  assert.deepEqual(
    stored.cards.map((item) => ({ ...item, step: { ...item.step, params: 'x' } })),
    chat.cards.map((item) => ({ ...item, step: { ...item.step, params: 'x' } })),
  );
  assert.deepEqual(chat.cards[0]!.step.params, { title: 's1', parsed: true }, '不改传入的卡片');
});

test('toStored：对话条数封顶，丢掉的轮次上的卡片一起丢', () => {
  assert.equal(STORED_ENTRY_LIMIT, 200);
  // 每轮两条：共 150 轮 300 条，只留最后 200 条（第 51 轮起）
  const entries: ChatEntry[] = [];
  for (let turn = 1; turn <= 150; turn += 1) entries.push(entry(turn * 2 - 1, 'user', turn), entry(turn * 2, 'assistant', turn));
  const cards = [card('old', 1), card('edge-before', 50), card('edge', 51), card('last', 150)];
  const stored = toStored({ ...EMPTY_CHAT, entries, cards, turn: 150 });
  assert.equal(stored.entries.length, STORED_ENTRY_LIMIT);
  assert.equal(stored.entries[0]!.turn, 51);
  assert.equal(stored.entries.at(-1)!.id, 300);
  assert.deepEqual(stored.cards.map((item) => item.step.id), ['edge', 'last']);
});

test('toStored：没有对话时卡片按当前轮次过滤', () => {
  const stored = toStored({ ...EMPTY_CHAT, cards: [card('old', 1), card('now', 3)], turn: 3 });
  assert.deepEqual(stored.cards.map((item) => item.step.id), ['now']);
});

// ---- parseStoredChat ----

test('parseStoredChat：toStored 的结果序列化后能原样读回', () => {
  const stored = toStored(sampleChat());
  assert.deepEqual(roundTrip(stored), stored);
  assert.deepEqual(roundTrip(toStored({ ...sampleChat(), snapshot: null, mode: null })), toStored({ ...sampleChat(), snapshot: null, mode: null }));
  assert.deepEqual(roundTrip(EMPTY_CHAT), EMPTY_CHAT);
});

test('parseStoredChat：缺 snapshot 字段按 null', () => {
  const { snapshot: _snapshot, ...rest } = toStored(sampleChat());
  assert.equal(roundTrip(rest)?.snapshot, null);
});

test('parseStoredChat：读回时一律去掉 params', () => {
  const raw = JSON.parse(JSON.stringify({ ...toStored(sampleChat()) })) as { cards: Array<{ step: Record<string, unknown> }> };
  raw.cards[0]!.step['params'] = { injected: true };
  const parsed = parseStoredChat(raw);
  assert.equal(parsed?.cards[0]?.step.params, null);
});

test('parseStoredChat：执行中的卡变成未执行且不勾选，其余状态与勾选不变', () => {
  const chat = sampleChat();
  chat.cards = [
    card('a', 1, { status: 'running' }),
    card('b', 1, { status: 'running', checked: false }),
    card('c', 1, { status: 'skipped', checked: true }),
    card('d', 1, { status: 'failed', message: '坏了' }),
    card('e', 2, { status: 'pending', checked: false }),
  ];
  const parsed = roundTrip(toStored(chat));
  assert.deepEqual(
    parsed?.cards.map((item) => [item.step.id, item.status, item.checked, item.message]),
    [
      ['a', 'skipped', false, null],
      ['b', 'skipped', false, null],
      ['c', 'skipped', false, null],
      ['d', 'failed', true, '坏了'],
      ['e', 'pending', false, null],
    ],
  );
});

test('parseStoredChat：顶层不对整段作废', () => {
  const good = JSON.parse(JSON.stringify(toStored(sampleChat()))) as Record<string, unknown>;
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['数组', []],
    ['字符串', 'x'],
    ['缺 version', { ...good, version: undefined }],
    ['version 2', { ...good, version: 2 }],
    ['entries 不是数组', { ...good, entries: {} }],
    ['cards 缺失', { ...good, cards: undefined }],
    ['history 不是数组', { ...good, history: 'x' }],
    ['turn 不是数字', { ...good, turn: '2' }],
    ['mode 未知', { ...good, mode: 'stream' }],
    ['mode 缺失', { ...good, mode: undefined }],
  ];
  for (const [name, value] of cases) assert.equal(parseStoredChat(value), null, name);
});

test('parseStoredChat：任一条目、卡片、消息或快照不对，整段作废', () => {
  const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(toStored(sampleChat()))) as Record<string, unknown>;
  const mutate = (name: string, change: (value: Record<string, unknown>) => void): void => {
    const value = base();
    change(value);
    assert.equal(parseStoredChat(value), null, name);
  };
  const entries = (value: Record<string, unknown>) => value['entries'] as Array<Record<string, unknown>>;
  const cards = (value: Record<string, unknown>) => value['cards'] as Array<Record<string, unknown>>;
  const history = (value: Record<string, unknown>) => value['history'] as Array<Record<string, unknown>>;
  const stepOf = (value: Record<string, unknown>) => cards(value)[0]!['step'] as Record<string, unknown>;

  mutate('条目角色未知', (value) => (entries(value)[1]!['role'] = 'system'));
  mutate('条目 id 不是数字', (value) => (entries(value)[0]!['id'] = '1'));
  mutate('条目缺 turn', (value) => delete entries(value)[0]!['turn']);
  mutate('条目文字不是字符串', (value) => (entries(value)[0]!['text'] = null));
  mutate('条目是 null', (value) => ((entries(value) as unknown[])[2] = null));

  mutate('卡片状态未知', (value) => (cards(value)[0]!['status'] = 'queued'));
  mutate('卡片 checked 不是布尔', (value) => (cards(value)[0]!['checked'] = 1));
  mutate('卡片缺 turn', (value) => delete cards(value)[0]!['turn']);
  mutate('卡片 message 是数字', (value) => (cards(value)[0]!['message'] = 3));
  mutate('步骤风险是查询', (value) => (stepOf(value)['risk'] = 'query'));
  mutate('步骤 args 是数组', (value) => (stepOf(value)['args'] = []));
  mutate('步骤缺 preview', (value) => delete stepOf(value)['preview']);
  mutate('步骤缺 id', (value) => delete stepOf(value)['id']);

  mutate('消息角色未知', (value) => (history(value)[0]!['role'] = 'function'));
  mutate('消息内容不是字符串', (value) => (history(value)[0]!['content'] = null));
  mutate('tool 消息缺 toolCallId', (value) => delete history(value)[2]!['toolCallId']);
  mutate('toolCalls 不是数组', (value) => (history(value)[1]!['toolCalls'] = {}));
  mutate('toolCalls 里有坏项', (value) => ((history(value)[1]!['toolCalls'] as unknown[]).push({ id: 'x', name: 'y' })));

  mutate('快照 kind 未知', (value) => ((value['snapshot'] as Record<string, unknown>)['kind'] = 'zip'));
  mutate('快照缺 createdAt', (value) => delete (value['snapshot'] as Record<string, unknown>)['createdAt']);
  mutate('快照是字符串', (value) => (value['snapshot'] = 'backup:1'));
});

test('parseStoredChat：多余字段忽略', () => {
  const raw = JSON.parse(JSON.stringify(toStored(sampleChat()))) as Record<string, unknown>;
  raw['extra'] = 1;
  (raw['entries'] as Array<Record<string, unknown>>)[0]!['extra'] = 'x';
  const parsed = parseStoredChat(raw);
  assert.ok(parsed !== null);
  assert.equal('extra' in parsed, false);
  assert.deepEqual(parsed.entries[0], entry(1, 'user', 1));
});

// ---- 读写 app_meta ----

test('保存再读取：经 app_meta 往返，params 去掉', async () => {
  const storage = createStorage();
  const chat = sampleChat();
  await saveStoredChat(storage, chat);
  const raw = await storage.readMeta(ASSISTANT_CHAT_META_KEY);
  assert.ok(raw !== undefined);
  assert.equal(raw.includes('"parsed"'), false, '落盘内容不含 params');
  const loaded = await loadStoredChat(storage);
  assert.deepEqual(loaded, toStored(chat));
});

test('读取：没存过、JSON 损坏或结构不对时回落为空对话', async () => {
  const storage = createStorage();
  assert.deepEqual(await loadStoredChat(storage), EMPTY_CHAT);
  await storage.writeMeta(ASSISTANT_CHAT_META_KEY, '{ 不是 JSON');
  assert.deepEqual(await loadStoredChat(storage), EMPTY_CHAT);
  await storage.writeMeta(ASSISTANT_CHAT_META_KEY, JSON.stringify({ ...toStored(sampleChat()), version: 9 }));
  assert.deepEqual(await loadStoredChat(storage), EMPTY_CHAT);
});

test('保存空对话后读回为空对话（「新对话」）', async () => {
  const storage = createStorage();
  await saveStoredChat(storage, sampleChat());
  await saveStoredChat(storage, EMPTY_CHAT);
  assert.deepEqual(await loadStoredChat(storage), EMPTY_CHAT);
});
