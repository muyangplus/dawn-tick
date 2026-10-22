import { Button } from '../../components/ui/button.tsx';
import type { LanPreviewResult } from '../../lan-sync-preview.ts';

/** 预览文案：课表 / 待办 / 设置三个数量，与确认合并的面板共用。 */
export function lanPreviewText(result: LanPreviewResult): string {
  const stats = result.stats;
  return `同步前预览：对方将带来 课表 ${stats.timetable} 项 / 待办 ${stats.todos} 项 / 设置 ${stats.settings} 项`;
}

export interface LanPreviewPanelProps {
  result: LanPreviewResult;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 拉取前的确认面板：只展示统计与两个出口，合并动作由调用方执行。 */
export function LanPreviewPanel({ result, onConfirm, onCancel }: LanPreviewPanelProps) {
  const total = result.stats.total;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line p-2" data-role="lan-sync-preview">
      <span className="text-sm text-ink">{lanPreviewText(result)}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" aria-label="确认合并" disabled={total === 0} onClick={onConfirm}>
          确认合并
        </Button>
        <Button size="sm" variant="ghost" aria-label="取消预览" onClick={onCancel}>
          取消
        </Button>
      </div>
      {total === 0 && <span className="text-xs text-muted">没有需要合并的变更。</span>}
    </div>
  );
}
