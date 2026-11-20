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

export interface AiClient {
  /** 返回模型输出的原始文本；网络或服务出错时抛可读错误。 */
  complete(request: AiRequest): Promise<string>;
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

export function createOpenAiCompatibleClient(config: AiConfig, fetchImpl: AiFetch): AiClient {
  return {
    async complete(request: AiRequest): Promise<string> {
      const problem = aiConfigProblem(config);
      if (problem !== null) throw new Error(problem);
      const response = await fetchImpl(chatCompletionsUrl(config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: config.model.trim(), messages: request.messages, temperature: 0 }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(serviceError(response.status, body));
      return completionText(body);
    },
  };
}
