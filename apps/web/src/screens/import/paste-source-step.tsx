import { PAGE_BOOKMARKLET } from '@dawn-tick/core';
import { Upload } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import { InlineError } from '../../components/ui/inline-error.tsx';
import { cn } from '../../lib/cn.ts';
import { fail } from '../../lib/fail.ts';
import { ImportSurface } from './import-surface.tsx';
import { ImportDiagnosticsPanel } from './import-diagnostics-panel.tsx';
import { ManualMappingSheet } from './manual-mapping-sheet.tsx';
import { FILE_ACCEPT, type PasteSource } from './import-flow-model.ts';
import type { PasteSourceApi } from './use-paste-source.ts';
import { importPasteCopy } from '../../copy/import-paste.ts';
import { HelpLink } from '../../components/help-link.tsx';

export interface PasteSourceStepProps {
  paste: PasteSourceApi;
  source: PasteSource;
  onPickSource: (source: PasteSource) => void;
}

/** 渠道 ① 的取材面板：粘贴网页文本 / 选择文件两个页签，共用一个表面。 */
export function PasteSourceStep({ paste, source, onPickSource }: PasteSourceStepProps) {
  return (
    <ImportSurface data-role="paste-source">
      <div
        role="group"
        aria-label={importPasteCopy.tabsAria}
        data-role="paste-source-tabs"
        className="grid grid-cols-2 gap-1 rounded-full bg-surface-muted p-1"
      >
        {(
          [
            { id: 'page', label: importPasteCopy.tabs.page },
            { id: 'file', label: importPasteCopy.tabs.file },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={source === tab.id}
            onClick={() => onPickSource(tab.id)}
            className={cn(
              'min-h-tap rounded-full px-3 text-sm',
              source === tab.id
                ? 'bg-surface text-primary-strong shadow-sm'
                : 'text-muted hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {source === 'page' ? <PagePane paste={paste} /> : <FilePane paste={paste} />}
    </ImportSurface>
  );
}

function PagePane({ paste }: { paste: PasteSourceApi }) {
  return (
    <div className="flex flex-col gap-3" data-role="paste-source-page">
      <HelpLink entryId="import-paste-page" />

      <details className="rounded-md border border-line bg-surface-muted p-3" data-role="bookmarklet">
        <summary className="flex min-h-tap cursor-pointer items-center text-sm text-ink">
          {importPasteCopy.bookmarkStep}
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <textarea
            readOnly
            value={PAGE_BOOKMARKLET}
            aria-label={importPasteCopy.bookmarkAria}
            className="h-20 w-full rounded-md border border-line bg-surface p-2 text-[11px] text-muted"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void paste.copyBookmarklet()}>
              {importPasteCopy.copyBookmark}
            </Button>
            {paste.bookmarkCopied && <span className="text-xs text-muted">{importPasteCopy.copied}</span>}
          </div>
          {paste.clipboardFailure !== null && <InlineError>{paste.clipboardFailure.reason}</InlineError>}
        </div>
      </details>

      <ol className="flex flex-col gap-1 text-sm text-ink">
        <li>{importPasteCopy.runBookmarkStep}</li>
        <li>{importPasteCopy.pasteStep}</li>
      </ol>

      <textarea
        value={paste.text}
        aria-label={importPasteCopy.pasteAria}
        data-role="import-paste"
        placeholder={importPasteCopy.pastePlaceholder}
        onChange={(event) => paste.setText(event.target.value)}
        className="min-h-28 w-full resize-y rounded-md border border-line bg-surface p-2 text-xs text-ink tablet:min-h-32"
      />

      <div className="flex flex-col gap-2 tablet:flex-row">
        <Button
          variant="primary"
          className="w-full tablet:w-auto"
          loading={paste.busy}
          disabled={paste.text.trim().length === 0}
          onClick={paste.runPage}
        >
          {importPasteCopy.recognize}
        </Button>
        <Button
          variant="secondary"
          className="w-full tablet:w-auto"
          onClick={paste.openMapping}
        >
          {importPasteCopy.openMapping}
        </Button>
      </div>

      {paste.pageFailure?.source === 'page' && (
        <div
          role="alert"
          data-role="import-recognize-error"
          className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/10 p-3"
        >
          <InlineError>
            {fail(importPasteCopy.recognizeFailWhat, paste.pageFailure.reason, importPasteCopy.pageFailNext).text}
          </InlineError>
          <Button size="sm" variant="secondary" className="w-full tablet:w-auto" onClick={paste.openMapping}>
            {importPasteCopy.useMapping}
          </Button>
        </div>
      )}

      <ManualMappingSheet
        open={paste.mappingOpen}
        onOpenChange={(open) => (open ? paste.openMapping() : paste.closeMapping())}
        inspection={paste.inspection}
        failure={paste.mappingFailure}
        mapHeaderRow={paste.mapHeaderRow}
        mapDayStart={paste.mapDayStart}
        mapDayCount={paste.mapDayCount}
        mapPeriodColumn={paste.mapPeriodColumn}
        onReadTables={paste.readTables}
        onApply={paste.applyMapping}
        onMapHeaderRow={paste.setMapHeaderRow}
        onMapDayStart={paste.setMapDayStart}
        onMapDayCount={paste.setMapDayCount}
        onMapPeriodColumn={paste.setMapPeriodColumn}
      />

      {paste.diagnostics !== null && (
        <ImportDiagnosticsPanel
          summary={paste.diagnostics}
          defaultOpen={paste.pageFailure !== null || paste.mappingFailure !== null}
          onCopy={paste.copyDiagnostics}
          onExport={paste.exportDiagnostics}
        />
      )}
    </div>
  );
}

function FilePane({ paste }: { paste: PasteSourceApi }) {
  return (
    <div className="flex flex-col gap-3" data-role="paste-source-file">
      <HelpLink entryId="import-file-formats" />
      <input
        ref={paste.fileInput}
        type="file"
        accept={FILE_ACCEPT}
        hidden
        aria-label={importPasteCopy.fileAria}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void paste.selectFile(file);
          event.target.value = '';
        }}
      />
      <div className="flex flex-col gap-2 tablet:flex-row">
        <Button
          size="sm"
          variant="secondary"
          className="w-full tablet:w-auto"
          disabled={paste.busy}
          onClick={() => paste.fileInput.current?.click()}
        >
          <Upload className="size-4" aria-hidden />
          {importPasteCopy.pickFile}
        </Button>
        <span className="text-center text-[11px] text-muted tablet:text-left">
          {importPasteCopy.fileFormats}
        </span>
      </div>
      {paste.fileFailure?.source === 'file' && (
        <div role="alert" data-role="import-file-error">
          <InlineError>
            {fail(importPasteCopy.recognizeFailWhat, paste.fileFailure.reason, importPasteCopy.fileFailNext).text}
          </InlineError>
        </div>
      )}
    </div>
  );
}
