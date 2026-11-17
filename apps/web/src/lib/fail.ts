/**
 * 统一失败文案：`fail(what, reason, next)` 把「发生了什么、为什么、下一步」拼成一句话。
 * 错误页、卡片级提示与 toast 共用这句式；原始异常只进日志（见 log.ts 的 describeError）。
 */
export interface Failure {
  /** 用户看到的标题，例如「载入失败」 */
  title: string;
  /** 原因 + 下一步，给页面正文使用 */
  body: string;
  /** 标题 + 原因 + 下一步，给 toast 或单行提示使用 */
  text: string;
}

/** 去掉首尾空白与句末标点：拼接时统一补句号，避免出现「。。」或「；。」。 */
function tidy(value: string): string {
  return value.trim().replace(/[。；;，,.\s]+$/u, '');
}

export function fail(what: string, reason: string, next: string): Failure {
  const title = tidy(what) || '操作没有完成';
  const why = tidy(reason);
  const then = tidy(next);
  const sentences = [why, then].filter((part) => part !== '');
  const body = sentences.length === 0 ? '' : `${sentences.join('。')}。`;
  return { title, body, text: body === '' ? title : `${title}：${body}` };
}

/** 只取单行文案的便捷入口。 */
export function failureText(what: string, reason: string, next: string): string {
  return fail(what, reason, next).text;
}
