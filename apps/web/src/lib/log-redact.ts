/**
 * 进日志前的脱敏：链接只留协议与主机，路径把用户主目录折成 `~`。
 * 日志会被导出发给开发者，查询串、userinfo 与系统用户名（常是真名）都不能原样落盘。
 */

/** 链接只保留 `协议//主机[:端口]`；解析不了时只记长度。 */
export function urlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host.length > 0 ? `${parsed.protocol}//${parsed.host}` : parsed.protocol;
  } catch {
    return `<invalid url, ${url.length} chars>`;
  }
}

const HOME_PATTERNS: readonly RegExp[] = [
  /^([A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/])[^\\/]+/i,
  /^(\/Users\/)[^/]+/,
  /^(\/home\/)[^/]+/,
];

/** 路径里的用户主目录换成 `~`，其余部分保留以便排查。 */
export function pathForLog(path: string | null | undefined): string | null {
  if (path === null || path === undefined) return null;
  for (const pattern of HOME_PATTERNS) {
    if (pattern.test(path)) return path.replace(pattern, '~');
  }
  return path;
}

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s()<>"'，。）]+/gi;

/** 报错文本里夹带的链接（如 `error sending request for url (…)`）逐个折成协议与主机。 */
export function textForLog(text: string): string {
  return text.replace(URL_IN_TEXT, (match) => urlForLog(match));
}
