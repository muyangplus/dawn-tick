import { Markdown } from '../ui/markdown.tsx';

/**
 * 发布说明：可折叠、限高、自己滚动，不把弹窗撑长。
 * 折叠只影响展开态，Markdown 内容始终在 DOM 里（冒烟与搜索都能读到）。
 */
export function UpdateNotes({ source }: { source: string }) {
  if (source.trim() === '') return null;
  return (
    <details
      className="group flex flex-col gap-2 rounded-md border border-line bg-surface-muted p-3"
      open
      data-role="update-notes-section"
    >
      <summary
        className="cursor-pointer select-none text-xs font-medium text-muted"
        data-role="update-notes-summary"
      >
        发布说明
      </summary>
      <Markdown
        source={source}
        dataRole="update-notes"
        className="max-h-56 overflow-y-auto overscroll-contain pr-1"
      />
    </details>
  );
}
