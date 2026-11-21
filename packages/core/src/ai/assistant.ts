/**
 * AI 助手的对话循环：模型通过函数调用查询与提出操作。
 * 查询类当场执行、结果回给模型继续推理；写入与高危类只收进计划，由用户勾选后执行。
 * 服务不支持函数调用时退回 JSON 动作列表，两种方式产出同样的计划。
 */
import {
  AiToolsUnsupportedError,
  type AiChatMessage,
  type AiClient,
  type AiToolCall,
} from './client.ts';
import { extractJson } from './drafts.ts';
import { AiArgError, actionTools, findAction, type AiAction, type AiActionRisk, type AiArgs } from './actions.ts';

/** 每轮最多几次模型调用 */
export const ASSISTANT_MAX_STEPS = 8;
/** 查询结果回给模型时的长度上限 */
export const ASSISTANT_RESULT_LIMIT = 8_000;

export type AssistantMode = 'tools' | 'json';

export interface AiPlanStep {
  id: string;
  action: string;
  args: AiArgs;
  /** 生成计划时 parse 的结果，只用于预览；执行时按 args 重新解析，读到当时的数据 */
  params: unknown;
  preview: string;
  risk: Exclude<AiActionRisk, 'query'>;
}

export interface AssistantTurnInput<C> {
  client: AiClient;
  actions: readonly AiAction<C>[];
  context: C;
  /** 之前几轮的对话（不含 system） */
  history: readonly AiChatMessage[];
  userText: string;
  /** 今天、时区、当前学期等，拼在 system 提示后面 */
  contextNote: string;
  /** 计划步骤 id 的前缀：多轮的计划放在一起时不重复，默认 `step` */
  stepIdPrefix?: string;
  /** 上一轮已退回 JSON 时沿用，不再试函数调用 */
  mode?: AssistantMode;
  maxSteps?: number;
  signal?: AbortSignal;
  /** 每执行一个查询回调一次，给界面显示进度 */
  onQuery?: (action: string) => void;
}

export interface AssistantTurnResult {
  /** 追加了本轮内容的对话，下一轮原样传回 */
  history: AiChatMessage[];
  reply: string;
  plan: AiPlanStep[];
  mode: AssistantMode;
  /** 用完步数仍没有结论 */
  exhausted: boolean;
}

const SYSTEM_RULES = [
  '你是「晓刻 DawnTick」课表与日程应用里的助手，用简洁的中文回答。',
  '需要数据时先调用查询类函数，不要编造课程、日期或设置。',
  '用户要求修改时调用对应的写入函数：写入不会立刻生效，会进入待执行计划，由用户在界面上确认。',
  '日期一律 YYYY-MM-DD，时刻 HH:MM；星期 1-7（周一为 1）；周次从 1 开始。',
  '函数返回 error 时按说明改正参数再试；做不到的事直接说明。',
  '最后用一两句话总结：查到了什么，或计划里有哪些待确认的操作。',
].join('\n');

function jsonRules<C>(actions: readonly AiAction<C>[]): string {
  const list = actionTools(actions)
    .map((tool) => `- ${tool.name}：${tool.description}\n  参数：${JSON.stringify(tool.parameters)}`)
    .join('\n');
  return [
    '这个服务不支持函数调用，改用 JSON：每次只输出一个 JSON 对象，不要输出别的文字。',
    '格式：{"calls": [{"name": 函数名, "arguments": {参数}}], "reply": 给用户的话}',
    '需要查询时只填 calls，等我把结果发回来；不再调用函数时 calls 为空数组并写 reply。',
    `可用函数：\n${list}`,
  ].join('\n');
}

/** 查询结果回给模型：超长时把结果文本截断后再包一层，保证整体仍是合法 JSON。 */
function resultMessage(result: unknown): string {
  const text = JSON.stringify(result ?? null);
  if (text.length <= ASSISTANT_RESULT_LIMIT) return `{"result":${text}}`;
  return JSON.stringify({ result: `${text.slice(0, ASSISTANT_RESULT_LIMIT)}…`, truncated: '结果过长已截断，缩小查询范围再试' });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 处理一次函数调用：查询就执行，写入就进计划；返回回给模型的文本。 */
async function handleCall<C>(
  call: { name: string; args: unknown },
  input: AssistantTurnInput<C>,
  plan: AiPlanStep[],
): Promise<string> {
  const action = findAction(input.actions, call.name);
  if (action === undefined) return JSON.stringify({ error: `没有名为 ${call.name} 的函数` });
  if (call.args === null || typeof call.args !== 'object' || Array.isArray(call.args)) {
    return JSON.stringify({ error: '参数应为 JSON 对象' });
  }
  const args = call.args as AiArgs;
  try {
    const params = await action.parse(args, input.context);
    if (action.risk === 'query') {
      input.onQuery?.(action.name);
      const result = await action.run(params, input.context);
      return resultMessage(result);
    }
    const preview = await action.preview(params, input.context);
    const step: AiPlanStep = { id: `${input.stepIdPrefix ?? 'step'}-${plan.length + 1}`, action: action.name, args, params, preview, risk: action.risk };
    plan.push(step);
    return JSON.stringify({ status: '已加入待执行计划，等用户确认', preview });
  } catch (error) {
    if (error instanceof AiArgError) return JSON.stringify({ error: error.message });
    return JSON.stringify({ error: `执行失败：${errorText(error)}` });
  }
}

function parseArgs(text: string): unknown {
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function toolsTurn<C>(
  input: AssistantTurnInput<C>,
  messages: AiChatMessage[],
  plan: AiPlanStep[],
  maxSteps: number,
): Promise<{ reply: string; exhausted: boolean }> {
  const chat = input.client.chat;
  if (chat === undefined) throw new AiToolsUnsupportedError('客户端不支持函数调用');
  const tools = actionTools(input.actions);
  for (let step = 0; step < maxSteps; step += 1) {
    const system: AiChatMessage = { role: 'system', content: `${SYSTEM_RULES}\n${input.contextNote}` };
    const reply = await chat.call(input.client, {
      messages: [system, ...messages],
      tools,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (reply.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: reply.content });
      return { reply: reply.content.trim(), exhausted: false };
    }
    messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });
    for (const call of reply.toolCalls as AiToolCall[]) {
      const content = await handleCall({ name: call.name, args: parseArgs(call.arguments) }, input, plan);
      messages.push({ role: 'tool', toolCallId: call.id, content });
    }
  }
  return { reply: '', exhausted: true };
}

/** 函数调用方式留下的对话换成纯文本：调用与结果都还在，模型不会丢掉已查到的数据。 */
function plainMessage(message: AiChatMessage): Array<{ role: 'system' | 'user'; content: string }> {
  if (message.role === 'tool') return [{ role: 'user', content: `函数结果：${message.content}` }];
  if (message.role === 'assistant') {
    const calls = (message.toolCalls ?? []).map((call) => `${call.name}(${call.arguments})`);
    const text = [message.content.trim(), ...(calls.length === 0 ? [] : [`调用：${calls.join('；')}`])].filter((part) => part !== '');
    return [{ role: 'user', content: `（你上一次的输出）${text.join('\n')}` }];
  }
  return [{ role: message.role, content: message.content }];
}

interface JsonTurn {
  calls: Array<{ name: string; args: unknown }>;
  reply: string;
}

function jsonTurnOf(output: string): JsonTurn {
  let parsed: unknown;
  try {
    parsed = extractJson(output);
  } catch {
    // 模型没按格式输出：整段当作回复
    return { calls: [], reply: output.trim() };
  }
  // 只认带 calls 或 reply 的对象；正文里碰巧有 `[1, 3]` 之类时整段仍是回复
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !('calls' in parsed || 'reply' in parsed)) {
    return { calls: [], reply: output.trim() };
  }
  const record = parsed as { calls?: unknown; reply?: unknown };
  const calls = Array.isArray(record.calls)
    ? record.calls.flatMap((raw: unknown) => {
        const call = raw as { name?: unknown; arguments?: unknown };
        if (typeof call.name !== 'string') return [];
        // 仿 OpenAI 格式的模型常把 arguments 写成 JSON 字符串
        const args = typeof call.arguments === 'string' ? parseArgs(call.arguments) : (call.arguments ?? {});
        return [{ name: call.name, args }];
      })
    : [];
  return { calls, reply: typeof record.reply === 'string' ? record.reply : '' };
}

async function jsonTurn<C>(
  input: AssistantTurnInput<C>,
  messages: AiChatMessage[],
  plan: AiPlanStep[],
  maxSteps: number,
): Promise<{ reply: string; exhausted: boolean }> {
  const system = `${SYSTEM_RULES}\n${input.contextNote}\n${jsonRules(input.actions)}`;
  for (let step = 0; step < maxSteps; step += 1) {
    // 退回模式的接口只认 system / user：模型自己的输出与函数结果都以 user 消息回传
    const output = await input.client.complete({
      messages: [
        { role: 'system', content: system },
        ...messages.flatMap(plainMessage),
      ],
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const turn = jsonTurnOf(output);
    messages.push({ role: 'assistant', content: output });
    if (turn.calls.length === 0) return { reply: turn.reply, exhausted: false };
    const results: string[] = [];
    for (const call of turn.calls) {
      results.push(`${call.name}：${await handleCall(call, input, plan)}`);
    }
    messages.push({ role: 'user', content: `函数结果：\n${results.join('\n')}` });
  }
  return { reply: '', exhausted: true };
}

/** 跑一轮对话：直到模型给出回复或用完步数。 */
export async function runAssistantTurn<C>(input: AssistantTurnInput<C>): Promise<AssistantTurnResult> {
  const maxSteps = input.maxSteps ?? ASSISTANT_MAX_STEPS;
  const plan: AiPlanStep[] = [];
  const messages: AiChatMessage[] = [...input.history, { role: 'user', content: input.userText }];
  let mode: AssistantMode = input.mode ?? (input.client.chat === undefined ? 'json' : 'tools');
  let outcome: { reply: string; exhausted: boolean };
  if (mode === 'tools') {
    const start = messages.length;
    try {
      outcome = await toolsTurn(input, messages, plan, maxSteps);
    } catch (error) {
      // 已经查过东西再退回会重复执行查询：只在第一次调用就被拒时换方式
      if (!(error instanceof AiToolsUnsupportedError) || messages.length > start) throw error;
      // 换成 JSON 方式重来：丢掉这一轮已收的计划与消息
      messages.length = start;
      plan.length = 0;
      mode = 'json';
      outcome = await jsonTurn(input, messages, plan, maxSteps);
    }
  } else {
    outcome = await jsonTurn(input, messages, plan, maxSteps);
  }
  return { history: messages, reply: outcome.reply, plan, mode, exhausted: outcome.exhausted };
}

export interface PlanStepResult {
  step: AiPlanStep;
  summary: string;
}

export interface PlanExecution {
  done: PlanStepResult[];
  /** 失败即停：失败的那一步与原因 */
  failed: { step: AiPlanStep; message: string } | null;
}

/** 按顺序执行用户勾选的步骤，遇到失败即停。 */
export async function executePlan<C>(
  steps: readonly AiPlanStep[],
  actions: readonly AiAction<C>[],
  context: C,
  onProgress?: (done: number) => void,
): Promise<PlanExecution> {
  const done: PlanStepResult[] = [];
  for (const step of steps) {
    const action = findAction(actions, step.action);
    if (action === undefined) return { done, failed: { step, message: `没有名为 ${step.action} 的操作` } };
    try {
      // 计划可能隔了几步或几轮才执行，前面的步骤和用户的手动修改都可能改了数据，按执行时的数据重新解析
      const params = await action.parse(step.args, context);
      const result = await action.run(params, context);
      done.push({ step, summary: typeof result === 'string' && result !== '' ? result : step.preview });
      onProgress?.(done.length);
    } catch (error) {
      return { done, failed: { step, message: errorText(error) } };
    }
  }
  return { done, failed: null };
}
