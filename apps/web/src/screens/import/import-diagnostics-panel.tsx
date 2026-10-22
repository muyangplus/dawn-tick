import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { ChevronDown, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/cn.ts';
import { mappingText, type ImportDiagnosticsSummary } from '../../lib/import-diagnostics.ts';

export interface ImportDiagnosticsPanelProps {
  summary: ImportDiagnosticsSummary;
  /** 识别失败时默认展开；成功回到取材步骤时保持折叠 */
  defaultOpen: boolean;
  onCopy: () => Promise<void>;
  onExport: () => Promise<void>;
}

const METRICS = [
  { key: 'frames', label: '帧数' },
  { key: 'tables', label: '表格数' },
  { key: 'kbTables', label: '疑似课表数' },
  { key: 'gridCells', label: '网格单元数' },
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
        <span>查看识别诊断</span>
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
          是否仍在加载：{summary.loading ? '是' : '否'}
          {summary.loading ? ' · 请等课表显示完整后重新识别' : ''}
        </p>

        {(summary.system !== null || summary.url !== null || summary.title !== null) && (
          <p className="break-words text-[11px] text-muted" data-role="import-diagnostics-page">
            {summary.system ?? '通用识别'} · {summary.url ?? '页面地址未知'} · {summary.title ?? '标题未知'}
          </p>
        )}

        {!summary.fromPage && (
          <p className="text-[11px] text-muted">
            当前内容没有携带书签 / 窗口诊断，表格数按粘贴内容估算；重新安装书签后再复制可获得完整诊断。
          </p>
        )}

        <p className="break-words text-[11px] text-ink" data-role="import-diagnostics-mapping">
          匹配字段映射：{mappingText(summary.mapping)}
        </p>

        {summary.sampleRows.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">前 3 行样例（每行截断到 120 字符）</span>
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
            复制诊断信息
          </Button>
          <Button size="sm" variant="ghost" className="w-full tablet:w-auto" onClick={() => void onExport()}>
            导出诊断日志
          </Button>
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
