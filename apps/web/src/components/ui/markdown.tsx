import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { ExternalLink } from './external-link.tsx';
import { parseInline, parseMarkdown, type MarkdownBlock, type MarkdownInline } from './markdown-model.ts';

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'text-base',
  2: 'text-sm',
  3: 'text-sm',
};

function renderInline(tokens: MarkdownInline[]): ReactNode[] {
  return tokens.map((token, index) => {
    switch (token.kind) {
      case 'text':
        return token.text;
      case 'strong':
        return (
          <strong key={index} className="font-semibold text-ink">
            {token.text}
          </strong>
        );
      case 'code':
        return (
          <code key={index} className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.9em]">
            {token.text}
          </code>
        );
      case 'link':
        return token.external ? (
          <ExternalLink key={index} href={token.href} className="break-all text-primary-strong underline">
            {token.text}
          </ExternalLink>
        ) : (
          <a key={index} href={token.href} className="break-all text-primary-strong underline">
            {token.text}
          </a>
        );
    }
  });
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
      return (
        <Tag key={index} className={cn('font-semibold text-ink', HEADING_CLASS[block.level])}>
          {renderInline(parseInline(block.text))}
        </Tag>
      );
    }
    case 'list': {
      const items = block.items.map((item, itemIndex) => (
        <li key={itemIndex} className="break-words">
          {renderInline(parseInline(item))}
        </li>
      ));
      return block.ordered ? (
        <ol key={index} className="flex list-decimal flex-col gap-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={index} className="flex list-disc flex-col gap-1 pl-5">
          {items}
        </ul>
      );
    }
    case 'paragraph':
      return (
        <p key={index} className="break-words">
          {renderInline(parseInline(block.text))}
        </p>
      );
  }
}

export interface MarkdownProps {
  source: string;
  className?: string;
  /** 容器上的 data-role：冒烟与样式选择器用，默认 `markdown` */
  dataRole?: string;
}

/**
 * 发布说明等受控 Markdown 的渲染器：只渲染解析出的纯文本/链接节点，
 * 全程不使用 `dangerouslySetInnerHTML`，原文里的 HTML 标签只会显示成文字。
 */
export function Markdown({ source, className, dataRole = 'markdown' }: MarkdownProps) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) return null;
  return (
    <div data-role={dataRole} className={cn('flex flex-col gap-2 text-xs leading-relaxed text-ink', className)}>
      {blocks.map(renderBlock)}
    </div>
  );
}
