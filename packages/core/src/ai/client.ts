/**
 * AI 调用接口：业务只依赖 `AiClient`，具体服务可替换。
 * 内置一个 OpenAI 兼容的实现（`/chat/completions`），fetch 由调用方注入，
 * 桌面端走原生 HTTP 绕开跨域，安卓由 CapacitorHttp 接管，浏览器受跨域限制。
 */

export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AiRequest {
  messages: AiMessage[];
  /** 调用方取消用 */
  signal?: AbortSignal;
}

/** 交给模型的一个函数（OpenAI 的 tools）。 */
export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema，顶层为 object */
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  /** 模型给出的参数 JSON 文本，可能不合法 */
  arguments: string;
}

/** 多轮对话里的一条消息：含模型的函数调用与回传的结果。 */
export type AiChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface AiChatRequest {
  messages: AiChatMessage[];
  tools: AiToolSpec[];
  signal?: AbortSignal;
}

export interface AiChatReply {
  content: string;
  toolCalls: AiToolCall[];
}

/** 服务不接受函数调用（多为 400）：调用方据此退回 JSON 动作列表。 */
export class AiToolsUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiToolsUnsupportedError';
  }
}

export interface AiClient {
  /** 返回模型输出的原始文本；网络或服务出错时抛可读错误。 */
  complete(request: AiRequest): Promise<string>;
  /** 带函数调用的一轮；不支持函数调用的实现可以不提供 */
  chat?(request: AiChatRequest): Promise<AiChatReply>;
}

export interface AiConfig {
  /** 接口地址，如 `https://api.example.com/v1`；末尾的 `/` 与 `/chat/completions` 都可省略 */
  baseUrl: string;
  model: string;
  apiKey: string;
}

export type AiFetch = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** 配置缺哪一项；齐全返回 null。 */
export function aiConfigProblem(config: AiConfig): string | null {
  if (config.baseUrl.trim() === '') return '未填写 AI 接口地址';
  if (!/^https?:\/\//i.test(config.baseUrl.trim())) return 'AI 接口地址要以 http:// 或 https:// 开头';
  if (config.model.trim() === '') return '未填写模型名称';
  if (config.apiKey === '') return '未填写 API 密钥';
  return null;
}

/** 规范成完整的补全地址。 */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

function serviceError(status: number, body: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string };
    const error = parsed.error;
    if (typeof error === 'string') detail = error;
    else if (error !== undefined && typeof error.message === 'string') detail = error.message;
  } catch {
    // 非 JSON 响应只报状态码
  }
  if (status === 401 || status === 403) return `AI 服务拒绝访问（${status}），检查 API 密钥`;
  if (status === 404) return 'AI 服务找不到接口（404），检查接口地址与模型名称';
  if (status === 429) return 'AI 服务请求过多或额度不足（429）';
  return detail === '' ? `AI 服务返回错误（${status}）` : `AI 服务返回错误（${status}）：${detail.slice(0, 200)}`;
}

/** 从补全响应里取出文本。 */
export function completionText(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('AI 服务的响应不是 JSON');
  }
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('AI 服务没有返回内容');
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  if (typeof content !== 'string' || content.trim() === '') throw new Error('AI 服务没有返回内容');
  return content;
}

/** 对话消息转成 OpenAI 的线上格式。 */
export function wireMessages(messages: readonly AiChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    if (message.role === 'assistant' && message.toolCalls !== undefined && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content === '' ? null : message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

/** 从带函数调用的响应里取出文本与调用；两样都没有时报错。 */
export function chatReplyOf(body: string): AiChatReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('AI 服务的响应不是 JSON');
  }
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('AI 服务没有返回内容');
  const message = (choices[0] as { message?: { content?: unknown; tool_calls?: unknown } }).message ?? {};
  const content = typeof message.content === 'string' ? message.content : '';
  const toolCalls: AiToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    message.tool_calls.forEach((raw: unknown, index) => {
      const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      const name = call.function?.name;
      if (typeof name !== 'string' || name === '') return;
      const args = call.function?.arguments;
      toolCalls.push({
        id: typeof call.id === 'string' && call.id !== '' ? call.id : `call_${index}`,
        name,
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      });
    });
  }
  if (content.trim() === '' && toolCalls.length === 0) throw new Error('AI 服务没有返回内容');
  return { content, toolCalls };
}

export function createOpenAiCompatibleClient(config: AiConfig, fetchImpl: AiFetch): AiClient {
  const post = async (payload: Record<string, unknown>, signal: AbortSignal | undefined) => {
    const problem = aiConfigProblem(config);
    if (problem !== null) throw new Error(problem);
    const response = await fetchImpl(chatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model.trim(), temperature: 0, ...payload }),
      ...(signal === undefined ? {} : { signal }),
    });
    return { response, body: await response.text() };
  };
  return {
    async complete(request: AiRequest): Promise<string> {
      const { response, body } = await post({ messages: request.messages }, request.signal);
      if (!response.ok) throw new Error(serviceError(response.status, body));
      return completionText(body);
    },
    async chat(request: AiChatRequest): Promise<AiChatReply> {
      const { response, body } = await post(
        {
          messages: wireMessages(request.messages),
          ...(request.tools.length === 0
            ? {}
            : {
                tools: request.tools.map((tool) => ({
                  type: 'function',
                  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
                })),
              }),
        },
        request.signal,
      );
      // 400/422 且错误里提到 tools / function：模型或服务不认函数调用；超长的报错里也有 functions 字样，照常报错
      if ((response.status === 400 || response.status === 422) && request.tools.length > 0 && /tool|function/i.test(body) && !/context[ _]length|too long/i.test(body)) {
        throw new AiToolsUnsupportedError(serviceError(response.status, body));
      }
      if (!response.ok) throw new Error(serviceError(response.status, body));
      return chatReplyOf(body);
    },
  };
}
