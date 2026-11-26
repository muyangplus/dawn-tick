/**
 * 助手回复的简单排版：只认列表、粗体与行内代码，其余按原文显示。
 * 产出结构化的块，由界面逐个渲染成元素，不拼 HTML。
 */

export type RichInline = { kind: 'text' | 'bold' | 'code'; text: string };

export type RichBlock =
  | { kind: 'paragraph'; inlines: RichInline[] }
  | { kind: 'list'; ordered: boolean; items: RichInline[][] };

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
/** 「1. 」「1) 」要带空格（免得把「2.5 小时」当列表）；中文「1、」后面常不带空格 */
const ORDERED_RE = /^\s*\d+(?:[.)]\s+|、\s*)(.*)$/;
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;

/** 行内：`**粗体**`、`` `代码` ``；没配对的标记按原文保留。 */
export function parseInlines(text: string): RichInline[] {
  const out: RichInline[] = [];
  const pattern = /\*\*([^*\n]+?)\*\*|`([^`\n]+?)`/g;
  let last = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ kind: 'bold', text: match[1] });
    else out.push({ kind: 'code', text: match[2] ?? '' });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** 按行切块：连续的列表行合成一个列表，其余连续行合成一个段落，空行分段。 */
export function parseRichText(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: RichInline[][] } | null = null;
  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', inlines: parseInlines(paragraph.join('\n')) });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list !== null) blocks.push({ kind: 'list', ...list });
    list = null;
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const bullet = BULLET_RE.exec(line);
    const ordered = bullet === null ? ORDERED_RE.exec(line) : null;
    const item = bullet ?? ordered;
    if (item !== null) {
      flushParagraph();
      const isOrdered = ordered !== null;
      if (list !== null && list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(parseInlines(item[1] ?? ''));
      continue;
    }
    flushList();
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      flushParagraph();
      blocks.push({ kind: 'paragraph', inlines: [{ kind: 'bold', text: heading[1] ?? '' }] });
      continue;
    }
    paragraph.push(line);
  }
  flushList();
  flushParagraph();
  return blocks;
}
