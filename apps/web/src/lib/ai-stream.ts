/**
 * Android 的 AI 流式请求：经 AiStream 插件发 POST，把 `aiStream` 事件拼回一个可逐段读取的响应。
 * CapacitorHttp 接管的全局 fetch 会整段缓冲响应，SSE 逐字输出只能走这条通道。
 */
import type { AiByteReader, AiFetch, AiFetchResponse } from '@dawn-tick/core';
import type { AiStreamEvent, AiStreamPlugin } from './plugins.ts';

type Handler = (event: AiStreamEvent) => void;

/** 函数调用读取：跨 await 再查时不被前一次判断收窄。 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

let counter = 0;

function nextStreamId(): string {
  counter += 1;
  return `ai-${Date.now().toString(36)}-${counter}`;
}

/** 一个请求的响应体：事件推进来的文本排成队，读取方按需取走。 */
class StreamBody {
  private readonly chunks: string[] = [];
  private finished = false;
  private failure: unknown = null;
  private wake: (() => void) | null = null;

  push(text: string): void {
    this.chunks.push(text);
    this.notify();
  }

  end(): void {
    this.finished = true;
    this.notify();
  }

  fail(error: unknown): void {
    if (this.finished) return;
    this.failure = error;
    this.finished = true;
    this.notify();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  /** 取下一段文本；读完返回 null，失败时抛出。 */
  async next(): Promise<string | null> {
    for (;;) {
      if (this.chunks.length > 0) return this.chunks.shift() as string;
      if (this.failure !== null) throw this.failure;
      if (this.finished) return null;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

/** 用 AiStream 插件实现 `AiFetch`；同一个插件实例只挂一个事件监听，按 `id` 分发。 */
export function pluginStreamFetch(plugin: AiStreamPlugin, idOf: () => string = nextStreamId): AiFetch {
  const handlers = new Map<string, Handler>();
  let listening: Promise<unknown> | null = null;
  const listen = (): Promise<unknown> => {
    listening ??= plugin.addListener('aiStream', (event) => {
      if (typeof event.id === 'string') handlers.get(event.id)?.(event);
    });
    return listening;
  };

  return async (input, init) => {
    const { signal } = init;
    if (isAborted(signal)) throw abortError(signal as AbortSignal);
    await listen();
    // 挂监听期间可能已经取消：此时还没发请求，直接按取消结束
    if (isAborted(signal)) throw abortError(signal as AbortSignal);
    const id = idOf();
    const body = new StreamBody();
    return new Promise<AiFetchResponse>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        handlers.delete(id);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        const error = abortError(signal as AbortSignal);
        cleanup();
        void plugin.cancel({ id }).catch(() => undefined);
        body.fail(error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      handlers.set(id, (event) => {
        switch (event.type) {
          case 'status': {
            if (settled) return;
            settled = true;
            const status = event.status ?? 0;
            resolve(responseOf(status, body));
            return;
          }
          case 'chunk':
            if (typeof event.text === 'string' && event.text !== '') body.push(event.text);
            return;
          case 'end':
            cleanup();
            body.end();
            if (!settled) {
              settled = true;
              reject(new Error(event.message ?? 'stream ended without status'));
            }
            return;
          case 'error': {
            cleanup();
            const error = new Error(event.message ?? 'stream failed');
            body.fail(error);
            if (!settled) {
              settled = true;
              reject(error);
            }
            return;
          }
          default:
            return;
        }
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      plugin.start({ id, url: input, headers: init.headers, body: init.body }).catch((error: unknown) => {
        cleanup();
        body.fail(error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  };
}

function responseOf(status: number, body: StreamBody): AiFetchResponse {
  let consumed = false;
  const claim = (): void => {
    if (consumed) throw new TypeError('body already used');
    consumed = true;
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader(): AiByteReader {
        claim();
        const encoder = new TextEncoder();
        return {
          async read() {
            const text = await body.next();
            return text === null ? { done: true } : { done: false, value: encoder.encode(text) };
          },
        };
      },
    },
    async text() {
      claim();
      let out = '';
      for (let text = await body.next(); text !== null; text = await body.next()) out += text;
      return out;
    },
  };
}
