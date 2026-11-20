import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { ChevronDown, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/cn.ts';
import {
  mappingText,
  SAMPLE_ROW_LIMIT,
  SAMPLE_ROW_MAX_CHARS,
  type ImportDiagnosticsSummary,
} from '../../lib/import-diagnostics.ts';
import { importDiagnosticsCopy } from '../../copy/import-diagnostics.ts';

export interface ImportDiagnosticsPanelProps {
  summary: ImportDiagnosticsSummary;
  /** 识别失败时默认展开；成功回到取材步骤时保持折叠 */
  defaultOpen: boolean;
  onCopy: () => Promise<void>;
  onExport: () => Promise<void>;
}

const METRICS = [
  { key: 'frames', label: importDiagnosticsCopy.metrics.frames },
  { key: 'tables', label: importDiagnosticsCopy.metrics.tables },
  { key: 'kbTables', label: importDiagnosticsCopy.metrics.kbTables },
  { key: 'gridCells', label: importDiagnosticsCopy.metrics.gridCells },
] as const;

/**
 * 识别诊断面板：识别失败时展开、成功时折叠在取材步骤底部。
 * 仍是导入表面里的单层折叠区（不套 Card），内容全部来自 `lib/import-diagnostics` 的结果。
 */
export function ImportDiagnosticsPanel({ summary, defaultOpen, onCopy, onExport }: ImportDiagnosticsPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  // 失败往往发生在面板已挂载之后：从折叠变成失败时自动展开，让用户马上看到为什么
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <CollapsiblePrimitive.Root
      open={open}
      onOpenChange={setOpen}
      data-role="import-diagnostics"
      className="rounded-md border border-line bg-surface-muted"
    >
      <CollapsiblePrimitive.Trigger
        data-role="import-diagnostics-toggle"
        className="dt-nav-item flex min-h-tap w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-surface"
      >
        <Stethoscope className="size-4 shrink-0 text-muted" aria-hidden />
        <span>{importDiagnosticsCopy.toggle}</span>
        <ChevronDown
          className={cn('dt-chevron ml-auto size-4 shrink-0 text-muted', open && 'rotate-180')}
          aria-hidden
        />
      </CollapsiblePrimitive.Trigger>

      <CollapsiblePrimitive.Content className="flex flex-col gap-2 border-t border-line px-3 py-2">
        <dl
          data-role="import-diagnostics-summary"
          className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs tablet:grid-cols-4"
        >
          {METRICS.map((metric) => (
            <div
              key={metric.key}
              className="flex items-baseline justify-between gap-2 rounded bg-surface px-2 py-1"
            >
              <dt className="text-muted">{metric.label}</dt>
              <dd className="tabular text-ink" data-metric={metric.key}>
                {summary[metric.key]}
              </dd>
            </div>
          ))}
        </dl>

        <p
          data-role="import-diagnostics-loading"
          className={cn('text-xs', summary.loading ? 'text-warning-strong' : 'text-muted')}
        >
          {importDiagnosticsCopy.loadingLine(summary.loading)}
        </p>

        {(summary.system !== null || summary.url !== null || summary.title !== null) && (
          <p className="break-words text-[11px] text-muted" data-role="import-diagnostics-page">
            {importDiagnosticsCopy.pageLine(summary.system, summary.url, summary.title)}
          </p>
        )}

        {!summary.fromPage && (
          <p className="text-[11px] text-muted">
            {importDiagnosticsCopy.estimatedNote}
          </p>
        )}

        <p className="break-words text-[11px] text-ink" data-role="import-diagnostics-mapping">
          {importDiagnosticsCopy.mappingLine(mappingText(summary.mapping))}
        </p>

        {summary.sampleRows.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">
              {importDiagnosticsCopy.samplesTitle(SAMPLE_ROW_LIMIT, SAMPLE_ROW_MAX_CHARS)}
            </span>
            <ol className="flex flex-col gap-1 text-[11px] text-ink">
              {summary.sampleRows.map((row, index) => (
                <li key={index} className="break-all rounded bg-surface px-2 py-1 font-mono">
                  {row}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="flex flex-col gap-2 tablet:flex-row">
          <Button
            size="sm"
            variant="secondary"
            className="w-full tablet:w-auto"
            onClick={() => void onCopy()}
          >
            {importDiagnosticsCopy.copyButton}
          </Button>
          <Button size="sm" variant="ghost" className="w-full tablet:w-auto" onClick={() => void onExport()}>
            {importDiagnosticsCopy.exportButton}
          </Button>
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
