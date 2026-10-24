/**
 * 「近期更新」弹窗的数据：把仓库根目录的 CHANGELOG.md 解析成按版本倒序的条目。
 *
 * 边界：
 * - 只读仓库里的 CHANGELOG（构建时以 `?raw` 内联），不发网络请求，离线可用；
 * - 跳过「未发布」段（它不是已发布版本）；每条只保留 body，渲染交给 `Markdown` 组件；
 * - 详情链接指向对应 Release 标签；解析失败时返回空数组，调用方给空态而不是崩。
 */

export interface RecentUpdate {
  version: string;
  /** YYYY-MM-DD，CHANGELOG 标题里的日期 */
  date: string;
  /** 该版本段落的 Markdown 正文（`### 新增` 等小节） */
  body: string;
}

const HEADING = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\s*$/;

/**
 * 解析 CHANGELOG 文本，返回最近 `limit` 个已发布版本。
 *
 * 只认 `## [<版本>] - <日期>` 形式的标题；`[未发布]` 与其它自由标题跳过。
 */
export function parseRecentUpdates(changelog: string, limit = 5): RecentUpdate[] {
  const lines = changelog.split(/\r?\n/);
  const updates: RecentUpdate[] = [];
  let current: RecentUpdate | null = null;
  const body: string[] = [];

  const flush = (): void => {
    if (current === null) return;
    const text = body.join('\n').trim();
    updates.push({ ...current, body: text });
  };

  for (const line of lines) {
    const matched = HEADING.exec(line);
    if (matched !== null) {
      flush();
      body.length = 0;
      current = { version: matched[1] ?? '', date: matched[2] ?? '', body: '' };
      continue;
    }
    // 下一个二级标题（如「## 约定」「## [未发布]」）结束当前段
    if (/^## /.test(line)) {
      flush();
      current = null;
      body.length = 0;
      continue;
    }
    if (current !== null) body.push(line);
  }
  flush();

  return updates
    .filter((item) => item.version !== '' && !item.version.includes('未发布'))
    .slice(0, Math.max(0, limit));
}

/** 版本对应的 Release 页面；`v` 前缀统一补上。 */
export function releaseTagUrl(version: string, repository = 'muyangplus/dawn-tick'): string {
  const tag = version.startsWith('v') ? version : `v${version}`;
  return `https://github.com/${repository}/releases/tag/${tag}`;
}
