import { Button } from '../../components/ui/button.tsx';
import type { LanPreviewResult } from '../../lan-sync-preview.ts';
import { lanSyncPanelCopy as copy } from '../../copy/sync-lan-panel.ts';

/** 预览文案：课表 / 待办 / 设置三个数量，与确认合并的面板共用。 */
export function lanPreviewText(result: LanPreviewResult): string {
  const stats = result.stats;
  return copy.previewSummary(stats.timetable, stats.todos, stats.settings);
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
        <Button size="sm" variant="secondary" aria-label={copy.confirmMerge} disabled={total === 0} onClick={onConfirm}>
          {copy.confirmMerge}
        </Button>
        <Button size="sm" variant="ghost" aria-label={copy.cancelPreviewLabel} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
      {total === 0 && <span className="text-xs text-muted">{copy.previewEmpty}</span>}
    </div>
  );
}
