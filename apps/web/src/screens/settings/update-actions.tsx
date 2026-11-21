import { useEffect, useState } from 'react';
import {
  DOWNLOAD_SOURCE_CHOICE_LABEL,
  DOWNLOAD_SOURCE_CHOICES,
  type AppSettings,
  type DownloadSourceChoice,
  type Storage,
} from '@dawn-tick/core';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../../channel.ts';
import { errorMessage } from '../../lib/errors.ts';
import { canRollbackToStable } from '../../lib/update-preferences.ts';
import { updatePlatform } from '../../lib/update-install.ts';
import { resolveReceiveBeta } from '../../update.ts';
import { useIgnoredUpdateVersion, unignoreUpdateVersion } from '../../components/update-prompt.ts';
import { UpdateInstallKindLine } from '../../components/update/update-install-kind.tsx';
import { UpdateTaskPanel } from '../../components/update/update-task-panel.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../../components/ui/dialog.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SwitchField,
} from '../../components/ui/controls.tsx';
import { ExternalLink } from '../../components/ui/external-link.tsx';
import { Field } from '../../components/ui/input.tsx';
import { StatusLine } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { RollbackDialog } from './update-rollback.tsx';
import type { UpdateCheckApi } from './use-update-check.ts';
import { updateSettingsCopy } from '../../copy/update-settings.ts';

export interface UpdateActionsProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  /** 版本检查状态由设备页持有，与「更新」分组共用一份 */
  update: UpdateCheckApi;
}

/**
 * 更新卡的「更新」区，按四组摆放：
 * ① 检查更新与渠道开关；② 后台下载任务（进度/取消/安装/重试）；
 * ③ 已忽略版本；④ 回滚到正式版。
 *
 * 只做展示与触发：是否自动提示、要不要回滚、回滚目标是谁都由 `lib/update-preferences.ts`
 * 的纯函数决定；下载/校验/安装沿用 `update-download` 与 `update-task`，不在这里重写。
 */
export function UpdateActions({ storage, settings, onPatch, update }: UpdateActionsProps) {
  const ignoredVersion = useIgnoredUpdateVersion();
  /** 打开「接收测试版更新」前的警告：测试版可能不稳定，确认后才写设置 */
  const [betaWarningOpen, setBetaWarningOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const platform = updatePlatform();
  const current = appVersion();
  /** 回滚复用安装链路：Web 只能刷新页面，不提供回滚入口 */
  const rollbackVisible =
    platform !== 'web' && canRollbackToStable({ current, channel: CHANNEL, latestStable: update.latestStable });

  // 打开「更新」分组时解析下载源：自动模式探测一次并缓存 10 分钟，手动模式不探测
  useEffect(() => {
    void update.ensureSource();
    // 只在下载源设置变化时重新解析；update 每次渲染都是新对象，不做依赖
  }, [settings.downloadSource]);

  async function unignore(): Promise<void> {
    try {
      await unignoreUpdateVersion(storage);
      toast.success(updateSettingsCopy.unignoredToast);
    } catch (cause: unknown) {
      toast.error(updateSettingsCopy.unignoreFailed(errorMessage(cause)));
    }
  }

  return (
    <>
      {/* ① 检查更新与渠道开关 */}
      <div className="flex flex-col gap-3" data-role="update-check-group">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label={updateSettingsCopy.checkButton}
            loading={update.busy}
            onClick={() => void update.run()}
          >
            {updateSettingsCopy.checkButton}
          </Button>
          <ExternalLink
            dataRole="release-page-link"
            className="text-xs text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick/releases"
            ariaLabel={updateSettingsCopy.releasePageAria}
          >
            {updateSettingsCopy.releasePageLink}
          </ExternalLink>
          {update.result !== null && (
            <StatusLine dataRole="update-result" at={update.result.at}>
              {update.result.text}
            </StatusLine>
          )}
          <UpdateInstallKindLine platform={platform} />
        </div>
        {CHANNEL !== 'dev' ? (
          <SwitchField
            label={updateSettingsCopy.receiveBetaLabel}
            description={
              CHANNEL === 'beta'
                ? updateSettingsCopy.receiveBetaDescriptionBeta
                : updateSettingsCopy.receiveBetaDescriptionRelease
            }
            checked={resolveReceiveBeta(settings.receiveBeta, CHANNEL)}
            onCheckedChange={(checked) => {
              if (checked && !resolveReceiveBeta(settings.receiveBeta, CHANNEL)) {
                setBetaWarningOpen(true);
                return;
              }
              void onPatch({ receiveBeta: checked });
            }}
            ariaLabel={updateSettingsCopy.receiveBetaLabel}
          />
        ) : (
          <span className="text-xs text-muted">{updateSettingsCopy.devChannelNote}</span>
        )}
        <SwitchField
          label={updateSettingsCopy.autoCheckLabel}
          description={updateSettingsCopy.autoCheckDescription}
          checked={settings.autoCheckUpdate}
          onCheckedChange={(checked) => void onPatch({ autoCheckUpdate: checked })}
          ariaLabel={updateSettingsCopy.autoCheckLabel}
        />
        <SwitchField
          label={updateSettingsCopy.releaseNotesLabel}
          description={updateSettingsCopy.releaseNotesDescription}
          checked={settings.releaseNotesOnUpdate}
          onCheckedChange={(checked) => void onPatch({ releaseNotesOnUpdate: checked })}
          ariaLabel={updateSettingsCopy.releaseNotesLabel}
        />
        {/* 下载源：自动探测 Gitee / GitHub 的 version.json，选完成快的；也可手动指定 */}
        <div className="flex flex-col gap-2" data-role="download-source-group">
          <Field
            label={updateSettingsCopy.downloadSourceLabel}
            help={updateSettingsCopy.downloadSourceHelp}
          >
            <Select
              value={settings.downloadSource}
              onValueChange={(value) => void onPatch({ downloadSource: value as DownloadSourceChoice })}
            >
              <SelectTrigger aria-label={updateSettingsCopy.downloadSourceLabel} data-role="download-source-select">
                <span>{DOWNLOAD_SOURCE_CHOICE_LABEL[settings.downloadSource]}</span>
              </SelectTrigger>
              <SelectContent>
                {DOWNLOAD_SOURCE_CHOICES.map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {DOWNLOAD_SOURCE_CHOICE_LABEL[choice]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <StatusLine dataRole="download-source-result">{update.sourceLine}</StatusLine>
            <Button
              size="sm"
              variant="secondary"
              aria-label={updateSettingsCopy.redetectAria}
              data-role="redetect-download-source"
              loading={update.sourceBusy}
              onClick={() => void update.refreshSource()}
            >
              {updateSettingsCopy.redetectButton}
            </Button>
          </div>
        </div>
      </div>
      {/* ② 后台下载任务：与更新弹窗共享同一个任务，关掉弹窗后这里继续显示进度 */}
      <UpdateTaskPanel />
      {/* ③ 已忽略版本 */}
      {ignoredVersion !== null && (
        <div className="flex flex-wrap items-center gap-2" data-role="ignored-version">
          <span className="text-xs text-muted">{updateSettingsCopy.ignoredVersion(ignoredVersion)}</span>
          <Button
            size="sm"
            variant="secondary"
            aria-label={updateSettingsCopy.unignoreAria}
            data-role="unignore-version"
            onClick={() => void unignore()}
          >
            {updateSettingsCopy.unignoreButton}
          </Button>
        </div>
      )}
      {/* ④ 回滚正式版 */}
      {rollbackVisible && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label={updateSettingsCopy.rollbackButton}
            data-role="rollback-stable"
            onClick={() => setRollbackOpen(true)}
          >
            {updateSettingsCopy.rollbackButton}
          </Button>
          <span className="text-xs text-muted">{updateSettingsCopy.rollbackChannelNote(CHANNEL_LABEL[CHANNEL])}</span>
        </div>
      )}
      <Dialog open={betaWarningOpen} onOpenChange={setBetaWarningOpen}>
        <DialogContent
          title={updateSettingsCopy.betaWarningTitle}
          description={updateSettingsCopy.betaWarningDescription}
          data-role="beta-warning-dialog"
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBetaWarningOpen(false)}>
              {updateSettingsCopy.cancel}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setBetaWarningOpen(false);
                void onPatch({ receiveBeta: true });
              }}
            >
              {updateSettingsCopy.betaWarningConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RollbackDialog open={rollbackOpen} onClose={() => setRollbackOpen(false)} platform={platform} current={current} />
    </>
  );
}
