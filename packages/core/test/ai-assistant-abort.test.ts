import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defineAction,
  objectSchema,
  reqString,
  runAssistantTurn,
  schema,
  type AiAction,
  type AiChatMessage,
  type AiChatReply,
  type AiClient,
  type AiToolCall,
} from '../src/ai/index.ts';

interface Ctx {
  log: string[];
  /** 查询执行到一半时调用：模拟用户在这一步里点了停止或清空 */
  duringQuery?: () => void;
}

const lookup = defineAction<Ctx, { q: string }>({
  name: 'lookup',
  description: '查询',
  parameters: objectSchema({ q: schema.string('关键词') }, ['q']),
  risk: 'query',
  parse: (args) => ({ q: reqString(args, 'q') }),
  preview: () => '',
  run: async ({ q }, context) => {
    context.log.push(`lookup:${q}`);
    context.duringQuery?.();
    return [q];
  },
});

const addThing = defineAction<Ctx, { name: string }>({
  name: 'add_thing',
  description: '添加',
  parameters: objectSchema({ name: schema.string('名称') }, ['name']),
  risk: 'write',
  parse: (args) => ({ name: reqString(args, 'name') }),
  preview: ({ name }) => `添加 ${name}`,
  run: async ({ name }, context) => {
    context.log.push(`add:${name}`);
    return `已添加 ${name}`;
  },
});

const ACTIONS: AiAction<Ctx>[] = [lookup, addThing];

function call(id: string, name: string, args: unknown): AiToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

/** 按脚本应答，记下调用次数；不理会 signal（Android 原生请求就是这样）。 */
function scripted(options: { chat?: AiChatReply[]; complete?: string[] }): { client: AiClient; calls: { chat: number; complete: number } } {
  const calls = { chat: 0, complete: 0 };
  const chatQueue = [...(options.chat ?? [])];
  const completeQueue = [...(options.complete ?? [])];
  const client: AiClient = {
    async complete() {
      calls.complete += 1;
      const next = completeQueue.shift();
      if (next === undefined) throw new Error('complete 脚本已用完');
      return next;
    },
  };
  if (options.chat !== undefined) {
    client.chat = async () => {
      calls.chat += 1;
      const next = chatQueue.shift();
      if (next === undefined) throw new Error('chat 脚本已用完');
      return next;
    };
  }
  return { client, calls };
}

function input(client: AiClient, context: Ctx, signal: AbortSignal) {
  return { client, actions: ACTIONS, context, history: [] as AiChatMessage[], userText: '查一下', contextNote: '今天 2026-11-21', signal };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

test('助手中止：函数调用方式，查询步骤里中止后不再请求模型、不再执行后续查询', async () => {
  const controller = new AbortController();
  const context: Ctx = { log: [], duringQuery: () => controller.abort() };
  const { client, calls } = scripted({
    chat: [
      { content: '', toolCalls: [call('c1', 'lookup', { q: '一' })] },
      { content: '', toolCalls: [call('c2', 'lookup', { q: '二' })] },
      { content: '完成', toolCalls: [] },
    ],
  });
  await assert.rejects(runAssistantTurn(input(client, context, controller.signal)), isAbort);
  assert.equal(calls.chat, 1, '中止后不再发下一次请求');
  assert.deepEqual(context.log, ['lookup:一']);
});

test('助手中止：JSON 退回方式同样在下一步之前停下', async () => {
  const controller = new AbortController();
  const context: Ctx = { log: [], duringQuery: () => controller.abort() };
  const { client, calls } = scripted({
    complete: [
      JSON.stringify({ calls: [{ name: 'lookup', arguments: { q: '一' } }] }),
      JSON.stringify({ calls: [{ name: 'lookup', arguments: { q: '二' } }] }),
      JSON.stringify({ calls: [], reply: '完成' }),
    ],
  });
  await assert.rejects(runAssistantTurn({ ...input(client, context, controller.signal), mode: 'json' as const }), isAbort);
  assert.equal(calls.complete, 1);
  assert.deepEqual(context.log, ['lookup:一']);
});

test('助手中止：开始前已中止就一次模型都不请求', async () => {
  const controller = new AbortController();
  controller.abort();
  const context: Ctx = { log: [] };
  const { client, calls } = scripted({ chat: [{ content: '完成', toolCalls: [] }], complete: ['完成'] });
  await assert.rejects(runAssistantTurn(input(client, context, controller.signal)), isAbort);
  await assert.rejects(runAssistantTurn({ ...input(client, context, controller.signal), mode: 'json' as const }), isAbort);
  assert.deepEqual(calls, { chat: 0, complete: 0 });
  assert.deepEqual(context.log, []);
});

test('助手中止：中止后的写入不会进计划，也不执行', async () => {
  const controller = new AbortController();
  const context: Ctx = { log: [], duringQuery: () => controller.abort() };
  const { client } = scripted({
    chat: [
      { content: '', toolCalls: [call('c1', 'lookup', { q: '一' })] },
      { content: '', toolCalls: [call('c2', 'add_thing', { name: '甲' })] },
      { content: '完成', toolCalls: [] },
    ],
  });
  await assert.rejects(runAssistantTurn(input(client, context, controller.signal)), isAbort);
  assert.deepEqual(context.log, ['lookup:一']);
});

test(
  '助手中止：请求不认 signal 时，中止后迟到的回复里带的查询不再执行',
  async () => {
    const controller = new AbortController();
    const context: Ctx = { log: [] };
    const client: AiClient = {
      complete: async () => '完成',
      chat: async () => {
        // 请求进行中用户点了停止，底层请求照样返回
        controller.abort();
        return { content: '', toolCalls: [call('c1', 'lookup', { q: '一' }), call('c2', 'lookup', { q: '二' })] };
      },
    };
    await assert.rejects(runAssistantTurn(input(client, context, controller.signal)), isAbort);
    assert.deepEqual(context.log, []);
  },
);
