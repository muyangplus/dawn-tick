import { SlidersHorizontal } from 'lucide-react';
import { SYSTEM_ENTRIES, systemEntry, type SchoolSystem } from '@dawn-tick/core';
import { SchoolPicker } from '../../components/school-picker.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/controls.tsx';
import { ImportSurface } from './import-surface.tsx';
import type { WindowSourceApi } from './use-window-source.ts';
import { importWindowCopy } from '../../copy/import-window.ts';
import { HelpLink } from '../../components/help-link.tsx';

export interface WindowSourceStepProps {
  source: WindowSourceApi;
  onUsePaste: () => void;
}

/**
 * 渠道 ②：应用内教务窗口。没有内嵌能力的平台在这里明确给出「改用粘贴」的下一步，
 * 不再让用户停在选校之后无处可去。
 */
export function WindowSourceStep({ source, onUsePaste }: WindowSourceStepProps) {
  return (
    <ImportSurface data-role="window-source">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-ink">{importWindowCopy.intro}</span>
        <HelpLink entryId="import-window" />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink">{importWindowCopy.schoolTitle}</span>
        <SchoolPicker
          context={source.presetContext}
          selectedId={source.pickedSchoolId}
          pinned={source.recentSchool}
          onPick={source.pickSchool}
        />
        <span className="text-xs text-muted" data-role="school-picked">
          {source.schoolName.trim() === '' ? importWindowCopy.schoolNone : importWindowCopy.schoolPicked(source.schoolName)}
        </span>
      </div>

      {/* 兜底路径：没有内置入口的学校在这里手填教务系统 + 域名（或直接粘贴入口地址） */}
      <details className="rounded-md border border-line bg-surface-muted p-3" data-role="window-manual-entry">
        <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-sm text-ink">
          <SlidersHorizontal className="size-4" aria-hidden />
          {importWindowCopy.manualEntry}
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <div className="grid grid-cols-2 gap-2 tablet:flex tablet:flex-wrap tablet:items-end">
            <Field label={importWindowCopy.systemLabel}>
              <Select
                value={source.schoolSystem}
                onValueChange={(value) => source.setSchoolSystem(value as SchoolSystem)}
              >
                <SelectTrigger aria-label={importWindowCopy.systemLabel} className="w-full tablet:w-40">
                  {systemEntry(source.schoolSystem).label}
                </SelectTrigger>
                <SelectContent>
                  {SYSTEM_ENTRIES.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={importWindowCopy.domainLabel}>
              <Input
                value={source.schoolDomain}
                placeholder="jw.example.edu.cn"
                aria-label={importWindowCopy.domainLabel}
                onChange={(event) => source.setSchoolDomain(event.target.value)}
              />
            </Field>
            <Button
              size="sm"
              variant="secondary"
              className="w-full tablet:w-auto"
              disabled={source.schoolDomain.trim().length === 0}
              onClick={source.fillEntry}
            >
              {importWindowCopy.fillEntry}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="w-full tablet:w-auto"
              disabled={source.schoolDomain.trim().length === 0}
              onClick={source.saveSchool}
            >
              {importWindowCopy.saveSchool}
            </Button>
          </div>

          <Field label={importWindowCopy.urlLabel}>
            <Input
              value={source.importUrl}
              placeholder="https://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html"
              aria-label={importWindowCopy.urlLabel}
              onChange={(event) => source.setImportUrl(event.target.value)}
            />
          </Field>
        </div>
      </details>

      {source.windowNote !== null && <span className="text-xs text-muted">{source.windowNote}</span>}

      {source.canOpen ? (
        <div className="flex flex-col gap-2 tablet:flex-row">
          <Button
            variant="primary"
            className="w-full tablet:w-auto"
            loading={source.opening}
            disabled={source.importUrl.trim().length === 0}
            onClick={() => void source.openWindow()}
          >
            {importWindowCopy.openWindow}
          </Button>
          <Button variant="ghost" className="w-full tablet:w-auto" onClick={() => void source.closeWindow()}>
            {importWindowCopy.closeWindow}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-muted p-3">
          <span className="text-xs text-muted">{importWindowCopy.unsupported}</span>
          <Button variant="secondary" className="w-full tablet:w-auto" onClick={onUsePaste}>
            {importWindowCopy.usePaste}
          </Button>
        </div>
      )}

      {source.canOpen && (
        <Button variant="link" className="w-full tablet:w-auto" onClick={onUsePaste}>
          {importWindowCopy.usePaste}
        </Button>
      )}
    </ImportSurface>
  );
}
