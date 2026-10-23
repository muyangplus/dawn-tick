import type { AppSettings, Storage } from '@dawn-tick/core';
import { CHANNEL } from '../../channel.ts';
import { SwitchField } from '../../components/ui/controls.tsx';
import { UpdateActions } from './update-actions.tsx';
import type { UpdateCheckApi } from './use-update-check.ts';

export interface UpdateCardProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  /** 版本检查与设备页顶部快捷动作共用一份状态 */
  update: UpdateCheckApi;
}

/**
 * 更新卡：检查更新、渠道开关、忽略版本、回滚与后台下载任务。
 *
 * 更新区仍由 `update-actions.tsx` 呈现，本卡只补开发者特性开关与「只在应用内检查版本」说明；
 * 版本检查状态由设备页的 `useUpdateCheck` 提供，顶部快捷动作与本卡显示同一份进度。
 */
export function UpdateCard({ storage, settings, onPatch, update }: UpdateCardProps) {
  return (
    <>
      <UpdateActions storage={storage} settings={settings} onPatch={onPatch} update={update} />
      {CHANNEL === 'dev' && (
        <SwitchField
          label="开发者特性"
          description="关闭后按正式版运行"
          checked={settings.devFeatures}
          onCheckedChange={(checked) => void onPatch({ devFeatures: checked })}
          ariaLabel="开发者特性"
        />
      )}
      <span className="text-xs text-muted">只在应用内检查版本</span>
    </>
  );
}
