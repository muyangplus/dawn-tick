import { Button } from '../../components/ui/button.tsx';
import { InlineError } from '../../components/ui/inline-error.tsx';
import { ImportSurface } from './import-surface.tsx';
import { PreviewList } from './preview-list.tsx';
import { previewSummary } from './import-flow-model.ts';
import type { ImportFlowApi } from './use-import-flow.ts';

export interface PreviewStepProps {
  flow: ImportFlowApi;
}

/** 预览步骤：摘要 / 冲突筛选 / 批选 / 卡片行在同一张表面上，只有一个容器层级。 */
export function PreviewStep({ flow }: PreviewStepProps) {
  return (
    <section className="flex flex-col gap-3" data-role="import-preview">
      <ImportSurface>
        <div className="flex flex-col gap-2 tablet:flex-row tablet:items-center tablet:justify-between">
          <span className="text-sm text-ink">
            {previewSummary(
              flow.schedules.length,
              flow.selected.size,
              flow.conflictCount,
              flow.duplicatesKnown,
            )}
          </span>
          <label className="flex min-h-tap items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              className="size-4"
              data-role="import-conflict-only"
              checked={flow.conflictOnly}
              disabled={!flow.duplicatesKnown}
              onChange={(event) => flow.setConflictOnly(event.target.checked)}
            />
            只看冲突项{flow.conflictCount > 0 ? `（${flow.conflictCount}）` : ''}
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2 tablet:flex tablet:flex-wrap tablet:items-center" data-role="import-batch">
          <Button
            size="sm"
            variant="secondary"
            className="w-full tablet:w-auto"
            disabled={flow.visibleIndexes.length === 0 || flow.visibleSelectedCount === flow.visibleIndexes.length}
            onClick={() => flow.batchSelect('all')}
          >
            全选
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="w-full tablet:w-auto"
            disabled={flow.visibleSelectedCount === 0}
            onClick={() => flow.batchSelect('none')}
          >
            清空
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="w-full tablet:w-auto"
            disabled={flow.visibleIndexes.length === 0}
            onClick={() => flow.batchSelect('invert')}
          >
            反选
          </Button>
          {flow.filteringConflicts && (
            <span className="col-span-3 text-xs text-muted tablet:col-span-1">
              筛选态：批选只作用于可见行
            </span>
          )}
        </div>

        <PreviewList
          schedules={flow.schedules}
          duplicateRows={flow.duplicateRows}
          duplicatesKnown={flow.duplicatesKnown}
          visibleIndexes={flow.visibleIndexes}
          selected={flow.selected}
          onToggle={flow.toggleRow}
        />

        {flow.filteringConflicts && flow.visibleIndexes.length === 0 && (
          <p data-role="import-no-conflict" className="text-xs text-muted">
            没有冲突项
          </p>
        )}

        {flow.warnings.length > 0 && <InlineError>{flow.warnings.join('；')}</InlineError>}

        <div className="flex flex-col gap-2 tablet:flex-row">
          <Button
            variant="primary"
            className="w-full tablet:w-auto"
            loading={flow.busy}
            disabled={flow.selected.size === 0}
            onClick={() => void flow.confirm()}
          >
            确认导入
          </Button>
          <Button variant="ghost" className="w-full tablet:w-auto" onClick={flow.back}>
            返回
          </Button>
        </div>
      </ImportSurface>
    </section>
  );
}
