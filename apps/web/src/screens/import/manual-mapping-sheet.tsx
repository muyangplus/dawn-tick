import { useEffect, useRef } from 'react';
import type { PageInspection } from '@dawn-tick/core';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { InlineError } from '../../components/ui/inline-error.tsx';
import { Sheet } from '../../components/ui/sheet.tsx';
import { useBreakpoint } from '../../lib/use-media.ts';
import { fail } from '../../lib/fail.ts';
import type { ImportFailure } from './import-flow-model.ts';
import { importMappingCopy } from '../../copy/import-mapping.ts';

export interface ManualMappingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inspection: PageInspection | null;
  failure: ImportFailure | null;
  mapHeaderRow: number;
  mapDayStart: number;
  mapDayCount: number;
  mapPeriodColumn: number;
  onReadTables: () => void;
  onApply: () => void;
  onMapHeaderRow: (value: number) => void;
  onMapDayStart: (value: number) => void;
  onMapDayCount: (value: number) => void;
  onMapPeriodColumn: (value: number) => void;
}

/**
 * 手动映射抽屉：识别失败或识别不准时才出现，承载表格预览与行列参数。
 * 不再把映射参数塞在粘贴卡里的折叠块，主流程保持单层表面。
 */
export function ManualMappingSheet({
  open,
  onOpenChange,
  inspection,
  failure,
  mapHeaderRow,
  mapDayStart,
  mapDayCount,
  mapPeriodColumn,
  onReadTables,
  onApply,
  onMapHeaderRow,
  onMapDayStart,
  onMapDayCount,
  onMapPeriodColumn,
}: ManualMappingSheetProps) {
  const breakpoint = useBreakpoint();
  const headerRowInput = useRef<HTMLInputElement>(null);

  // 打开后把焦点送到表头行：用户是带着「哪里识别错了」进来的，先改最常错的一项
  useEffect(() => {
    if (!open || inspection === null) return;
    const timer = setTimeout(() => {
      headerRowInput.current?.focus();
      headerRowInput.current?.scrollIntoView({ block: 'nearest' });
    }, 60);
    return () => clearTimeout(timer);
  }, [open, inspection]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side={breakpoint === 'desktop' ? 'right' : 'bottom'}
      title={importMappingCopy.title}
      description={importMappingCopy.description}
      contentAttrs={{ 'data-role': 'manual-mapping' }}
      bodyClassName="flex flex-col gap-3 overscroll-contain"
    >
      <div className="flex items-center gap-2 text-sm text-ink">
        <SlidersHorizontal className="size-4" aria-hidden />
        {importMappingCopy.intro}
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="w-full tablet:w-auto"
        onClick={onReadTables}
      >
        {importMappingCopy.readTables}
      </Button>

      {inspection !== null && (
        <>
          <span className="text-xs text-muted">
            {importMappingCopy.inspection(inspection.system.label, inspection.tables.length)}
          </span>
          <div className="max-h-56 overflow-auto rounded-md border border-line">
            <table className="w-full text-left text-[11px]">
              <tbody>
                {(inspection.tables[0]?.rows ?? []).map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-line">
                    <th className="w-6 p-1 text-muted">{rowIndex}</th>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="max-w-24 break-words p-1 align-top">
                        {cell === '' ? importMappingCopy.emptyCell : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-2 tablet:flex tablet:flex-wrap tablet:items-end">
            <Field label={importMappingCopy.headerRowLabel}>
              <Input
                ref={headerRowInput}
                type="number"
                min={0}
                aria-label={importMappingCopy.headerRowLabel}
                value={mapHeaderRow}
                onChange={(event) => onMapHeaderRow(Number(event.target.value))}
              />
            </Field>
            <Field label={importMappingCopy.dayStartLabel}>
              <Input
                type="number"
                min={0}
                aria-label={importMappingCopy.dayStartLabel}
                value={mapDayStart}
                onChange={(event) => onMapDayStart(Number(event.target.value))}
              />
            </Field>
            <Field label={importMappingCopy.dayCountLabel}>
              <Input
                type="number"
                min={1}
                max={7}
                aria-label={importMappingCopy.dayCountLabel}
                value={mapDayCount}
                onChange={(event) => onMapDayCount(Number(event.target.value))}
              />
            </Field>
            <Field label={importMappingCopy.periodColumnLabel} help={importMappingCopy.periodColumnHelp}>
              <Input
                type="number"
                min={-1}
                aria-label={importMappingCopy.periodColumnLabel}
                value={mapPeriodColumn}
                onChange={(event) => onMapPeriodColumn(Number(event.target.value))}
              />
            </Field>
          </div>
          {failure?.source === 'mapping' && (
            <InlineError>
              {fail(importMappingCopy.failWhat, failure.reason, importMappingCopy.failNext).text}
            </InlineError>
          )}
        </>
      )}
      <div className="flex flex-col gap-2 tablet:flex-row">
        <Button
          variant="primary"
          className="w-full tablet:w-auto"
          disabled={inspection === null}
          onClick={onApply}
        >
          {importMappingCopy.apply}
        </Button>
        <Button
          variant="ghost"
          className="w-full tablet:w-auto"
          aria-label={importMappingCopy.closeAria}
          onClick={() => onOpenChange(false)}
        >
          {importMappingCopy.close}
        </Button>
      </div>
    </Sheet>
  );
}
