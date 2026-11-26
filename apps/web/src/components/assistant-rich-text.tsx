import { useMemo } from 'react';
import { parseRichText, type RichInline } from '../assistant/rich-text.ts';

function Inlines({ inlines }: { inlines: readonly RichInline[] }) {
  return (
    <>
      {inlines.map((inline, index) =>
        inline.kind === 'bold' ? (
          <strong key={index} className="font-semibold">
            {inline.text}
          </strong>
        ) : inline.kind === 'code' ? (
          <code key={index} className="rounded bg-surface px-1 font-mono text-[0.9em]">
            {inline.text}
          </code>
        ) : (
          <span key={index}>{inline.text}</span>
        ),
      )}
    </>
  );
}

/** 助手回复：列表、粗体与行内代码排版，其余按原文。 */
export function AssistantRichText({ text }: { text: string }) {
  const blocks = useMemo(() => parseRichText(text), [text]);
  return (
    <div className="flex flex-col gap-1.5" data-role="assistant-rich-text">
      {blocks.map((block, index) =>
        block.kind === 'paragraph' ? (
          <p key={index} className="whitespace-pre-wrap">
            <Inlines inlines={block.inlines} />
          </p>
        ) : block.ordered ? (
          <ol key={index} className="list-decimal pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inlines inlines={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={index} className="list-disc pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inlines inlines={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
