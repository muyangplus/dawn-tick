/** 无依赖：vite.config 构建时也用它从 CHANGELOG.md 取当前版本那一段。 */

/** 只比较 `X.Y.Z`：测试版后缀、开发构建时间戳都去掉。 */
export function baseVersion(version: string): string | null {
  const match = /^v?(\d+\.\d+\.\d+)/.exec(version.trim());
  return match === null ? null : (match[1] ?? null);
}

/** CHANGELOG 里 `## [版本] - 日期` 那一段的正文（不含标题）；找不到或为空返回空串。 */
export function changelogSection(markdown: string, version: string): string {
  const base = baseVersion(version);
  if (base === null) return '';
  const lines = markdown.split(/\r?\n/);
  const heading = `## [${base}]`;
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start < 0) return '';
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // 下一个版本标题，或文件尾部的链接定义
    if (line.startsWith('## ') || /^\[[^\]]+\]:\s/.test(line)) break;
    body.push(line);
  }
  return body.join('\n').trim();
}
