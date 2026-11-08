/**
 * Promise 超时工具：只负责「到点拒绝」，不取消底层操作。
 *
 * 局域网同步的启动与配对都要在用户可接受的等待内回到可重试状态；底层原生调用或
 * `fetch` 可能卡住不回调，这里统一给一句可展示的原因。调用方把超时当成普通失败处理。
 */
export function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}
