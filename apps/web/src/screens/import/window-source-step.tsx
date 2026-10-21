import { SlidersHorizontal } from 'lucide-react';
import { SYSTEM_ENTRIES, systemEntry, type SchoolSystem } from '@dawn-tick/core';
import { SchoolPicker } from '../../components/school-picker.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/controls.tsx';
import { ImportSurface } from './import-surface.tsx';
import type { WindowSourceApi } from './use-window-source.ts';

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
        <span className="text-sm text-ink">在应用内登录教务，登录后直接带回课表</span>
        <span className="text-xs text-muted">
          Windows 打开独立窗口，Android 打开应用内窗口；登录后点窗口里的「导入到晓刻」。
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink">选择学校</span>
        <SchoolPicker
          context={source.presetContext}
          selectedId={source.pickedSchoolId}
          pinned={source.recentSchool}
          onPick={source.pickSchool}
        />
        <span className="text-xs text-muted" data-role="school-picked">
          {source.schoolName.trim() === '' ? '未选择学校' : `已选：${source.schoolName}`}
        </span>
      </div>

      {/* 兜底路径：没有内置入口的学校在这里手填教务系统 + 域名（或直接粘贴入口地址） */}
      <details className="rounded-md border border-line bg-surface-muted p-3" data-role="window-manual-entry">
        <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-sm text-ink">
          <SlidersHorizontal className="size-4" aria-hidden />
          手动填写入口地址
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <div className="grid grid-cols-2 gap-2 tablet:flex tablet:flex-wrap tablet:items-end">
            <Field label="教务系统">
              <Select
                value={source.schoolSystem}
                onValueChange={(value) => source.setSchoolSystem(value as SchoolSystem)}
              >
                <SelectTrigger aria-label="教务系统" className="w-full tablet:w-40">
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
            <Field label="学校域名">
              <Input
                value={source.schoolDomain}
                placeholder="jw.example.edu.cn"
                aria-label="学校域名"
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
              按入口补齐
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="w-full tablet:w-auto"
              disabled={source.schoolDomain.trim().length === 0}
              onClick={source.saveSchool}
            >
              保存到我的学校
            </Button>
          </div>

          <Field label="入口地址">
            <Input
              value={source.importUrl}
              placeholder="https://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html"
              aria-label="入口地址"
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
            打开教务窗口
          </Button>
          <Button variant="ghost" className="w-full tablet:w-auto" onClick={() => void source.closeWindow()}>
            关闭窗口
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-muted p-3">
          <span className="text-xs text-muted">当前平台没有内嵌教务窗口，改用「粘贴文本 / 文件」。</span>
          <Button variant="secondary" className="w-full tablet:w-auto" onClick={onUsePaste}>
            改用粘贴文本
          </Button>
        </div>
      )}

      {source.canOpen && (
        <Button variant="link" className="w-full tablet:w-auto" onClick={onUsePaste}>
          改用粘贴文本
        </Button>
      )}
    </ImportSurface>
  );
}
