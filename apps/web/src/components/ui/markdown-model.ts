/**
 * 发布说明用的 Markdown 子集解析：只认标题、列表、粗体、行内代码、链接。
 *
 * 解析结果只包含纯文本与链接信息，**不拼 HTML**；渲染时由 React 自动转义，
 * 因此发布说明里出现的 `<script>` 等一律按字面文本显示。
 */

export type MarkdownHeadingLevel = 1 | 2 | 3;

export type MarkdownBlock =
  | { kind: 'heading'; level: MarkdownHeadingLevel; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] };

export type MarkdownInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string; external: boolean };

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const BULLET_ITEM = /^[-*+]\s+(.+)$/;
const ORDERED_ITEM = /^\d+[.)]\s+(.+)$/;
/** 行内语法按顺序尝试：粗体 → 行内代码 → 显式链接 → 裸链接。 */
const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>"']+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/**
 * 链接只放行 http(s)、站内绝对路径与锚点。
 * 其余协议（javascript:、data: 等）按纯文本展示，避免点开危险地址。
 */
export function classifyHref(url: string): { href: string; external: boolean } | null {
  const href = url.trim();
  if (href === '') return null;
  if (/^https?:\/\//i.test(href)) return { href, external: true };
  if (href.startsWith('/') || href.startsWith('#')) return { href, external: false };
  return null;
}

/** 按行解析块级结构：空行分隔段落，连续同类列表项合成一个列表。 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list === null) return;
    blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = (heading[1] ?? '').length;
      blocks.push({
        kind: 'heading',
        level: level === 1 || level === 2 ? level : 3,
        text: (heading[2] ?? '').trim(),
      });
      continue;
    }
    const orderedMatch = ORDERED_ITEM.exec(line);
    const bulletMatch = orderedMatch === null ? BULLET_ITEM.exec(line) : null;
    if (orderedMatch !== null || bulletMatch !== null) {
      flushParagraph();
      const ordered = orderedMatch !== null;
      if (list !== null && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((orderedMatch?.[1] ?? bulletMatch?.[1] ?? '').trim());
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** 把一行文本切成行内 token；未匹配的部分原样作为文本。 */
export function parseInline(text: string): MarkdownInline[] {
  const tokens: MarkdownInline[] = [];
  let cursor = 0;
  const pushText = (value: string): void => {
    if (value !== '') tokens.push({ kind: 'text', text: value });
  };

  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    pushText(text.slice(cursor, start));
    const strong = match[1];
    const code = match[2];
    const label = match[3];
    const hrefText = match[4];
    const bareUrl = match[5];

    if (strong !== undefined) {
      tokens.push({ kind: 'strong', text: strong });
    } else if (code !== undefined) {
      tokens.push({ kind: 'code', text: code });
    } else if (label !== undefined && hrefText !== undefined) {
      const link = classifyHref(hrefText);
      if (link === null) pushText(label);
      else tokens.push({ kind: 'link', text: label, href: link.href, external: link.external });
    } else if (bareUrl !== undefined) {
      const stripped = bareUrl.replace(TRAILING_PUNCTUATION, '');
      const link = classifyHref(stripped);
      if (link === null) pushText(bareUrl);
      else {
        tokens.push({ kind: 'link', text: stripped, href: link.href, external: link.external });
        pushText(bareUrl.slice(stripped.length));
      }
    }
    cursor = start + match[0].length;
  }
  pushText(text.slice(cursor));
  return tokens;
}
