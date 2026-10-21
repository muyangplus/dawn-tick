import { PAGE_BOOKMARKLET } from '@dawn-tick/core';
import { Upload } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import { InlineError } from '../../components/ui/inline-error.tsx';
import { cn } from '../../lib/cn.ts';
import { fail } from '../../lib/fail.ts';
import { ImportSurface } from './import-surface.tsx';
import { ManualMappingSheet } from './manual-mapping-sheet.tsx';
import { FILE_ACCEPT, type PasteSource } from './import-flow-model.ts';
import type { PasteSourceApi } from './use-paste-source.ts';

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
        aria-label="取材方式"
        data-role="paste-source-tabs"
        className="grid grid-cols-2 gap-1 rounded-full bg-surface-muted p-1"
      >
        {(
          [
            { id: 'page', label: '粘贴网页课表' },
            { id: 'file', label: '选择文件' },
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
      <p className="text-xs text-muted">
        自己登录教务系统后，把课表页内容原样粘贴进来；表格越完整，识别越准。
      </p>

      <details className="rounded-md border border-line bg-surface-muted p-3" data-role="bookmarklet">
        <summary className="flex min-h-tap cursor-pointer items-center text-sm text-ink">
          1. 安装书签（可选）
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <span className="text-xs text-muted">把下面的代码存为浏览器书签，在课表页点一下即可复制页面。</span>
          <textarea
            readOnly
            value={PAGE_BOOKMARKLET}
            aria-label="书签小工具代码"
            className="h-20 w-full rounded-md border border-line bg-surface p-2 text-[11px] text-muted"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void paste.copyBookmarklet()}>
              复制书签代码
            </Button>
            {paste.bookmarkCopied && <span className="text-xs text-muted">已复制</span>}
          </div>
          {paste.clipboardFailure !== null && <InlineError>{paste.clipboardFailure.reason}</InlineError>}
        </div>
      </details>

      <ol className="flex flex-col gap-1 text-sm text-ink">
        <li>2. 在课表页执行书签，页面内容进剪贴板</li>
        <li>3. 回到这里粘贴，自动识别课表</li>
      </ol>

      <textarea
        value={paste.text}
        aria-label="粘贴课表页面内容"
        data-role="import-paste"
        placeholder="将课表页面内容（或书签复制的内容）粘贴到这里"
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
          识别并预览
        </Button>
        <Button
          variant="secondary"
          className="w-full tablet:w-auto"
          onClick={paste.openMapping}
        >
          手动指定表格
        </Button>
      </div>

      {paste.pageFailure?.source === 'page' && (
        <div
          role="alert"
          data-role="import-recognize-error"
          className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/10 p-3"
        >
          <InlineError>
            {fail('识别失败', paste.pageFailure.reason, '请换一种导入方式，或手动添加课程。').text}
          </InlineError>
          <Button size="sm" variant="secondary" className="w-full tablet:w-auto" onClick={paste.openMapping}>
            改用手动指定表格
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
    </div>
  );
}

function FilePane({ paste }: { paste: PasteSourceApi }) {
  return (
    <div className="flex flex-col gap-3" data-role="paste-source-file">
      <p className="text-xs text-muted">
        选择课表文件：CSV / Excel 按二维矩阵解析，ICS 按日历事件解析，导入前都会先给预览。
      </p>
      <input
        ref={paste.fileInput}
        type="file"
        accept={FILE_ACCEPT}
        hidden
        aria-label="选择课表文件"
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
          选择文件
        </Button>
        <span className="text-center text-[11px] text-muted tablet:text-left">
          支持 .csv / .xlsx / .ics / .txt
        </span>
      </div>
      {paste.fileFailure?.source === 'file' && (
        <div role="alert" data-role="import-file-error">
          <InlineError>
            {fail('识别失败', paste.fileFailure.reason, '请检查文件格式，或改用其他导入方式。').text}
          </InlineError>
        </div>
      )}
    </div>
  );
}
