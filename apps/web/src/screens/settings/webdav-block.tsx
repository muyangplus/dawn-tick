import { useState } from 'react';
import { formatDateTime, type AppSettings, type Storage } from '@dawn-tick/core';
import {
  davConfigured,
  downloadAndApply,
  testConnection,
  uploadPackage,
  type ApplyMode,
  type DavSettings,
} from '../../webdav.ts';
import { createSnapshot, pruneSnapshots } from '../../backup.ts';
import { Button } from '../../components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../../components/ui/dialog.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { SwitchField } from '../../components/ui/controls.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { registerPendingRestart } from '../../pending-restart.ts';
import { useAction } from '../../lib/action.ts';
import { fail } from '../../copy/zh.ts';
import { toast } from '../../components/ui/toaster.tsx';
import { formatBytes, said } from './format.ts';

export interface WebdavBlockProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  onChanged: () => void;
  /** 只应用设置时的热加载 */
  onSettingsReplaced: () => Promise<void>;
  /** 下载前会先做一份本机快照，完成后刷新备份卡的列表 */
  onSnapshotsChanged: () => Promise<void>;
}

/**
 * WebDAV 块：地址账号、自动同步开关、测试连接 / 上传 / 下载。
 *
 * 下载要覆盖本机数据，因此走二次确认；整库恢复登记待重启，只应用设置则热加载。
 */
export function WebdavBlock({
  storage,
  settings,
  onPatch,
  onChanged,
  onSettingsReplaced,
  onSnapshotsChanged,
}: WebdavBlockProps) {
  const davAction = useAction();
  const [davStatus, setDavStatus] = useState<StatusMessage | null>(null);
  const [davConfirmOpen, setDavConfirmOpen] = useState(false);
  const dav: DavSettings = {
    webdavUrl: settings.webdavUrl,
    webdavUser: settings.webdavUser,
    webdavPassword: settings.webdavPassword,
    webdavHistory: settings.webdavHistory,
  };

  async function testDav(): Promise<void> {
    setDavStatus(said('正在测试连接…'));
    await davAction.run({
      scope: 'webdav',
      label: '正在测试连接…',
      fail: false,
      task: async () => {
        const status = await testConnection(dav);
        if (!status.ok) {
          const message = fail('连接 WebDAV', status.error ?? `服务器返回 ${status.status}`, '请检查地址、账号与网络');
          setDavStatus(said(message));
          toast.error(message);
          return;
        }
        const remote =
          status.lastModified === null
            ? status.exists
              ? '远端已有备份'
              : '远端暂无备份'
            : `远端备份时间 ${formatDateTime(status.lastModified, settings.timeZone)}`;
        const message = `连接正常，${remote}`;
        setDavStatus(said(message));
        toast.success(message);
      },
    });
  }

  async function uploadDav(): Promise<void> {
    setDavStatus(null);
    await davAction.run({
      scope: 'webdav',
      label: '正在上传到 WebDAV…',
      fail: false,
      task: async () => {
        const result = await uploadPackage(storage, dav);
        if (!result.ok) {
          const message = fail('上传', result.error, '请检查网络后重试');
          setDavStatus(said(message));
          toast.error(message);
          return;
        }
        await onSnapshotsChanged();
        const message = `已上传 ${result.name}（${formatBytes(result.bytes)}）`;
        setDavStatus(said(message));
        toast.success(message);
      },
    });
  }

  /** 下载并应用：先备份本机再覆盖 */
  async function downloadDav(mode: ApplyMode): Promise<void> {
    setDavConfirmOpen(false);
    setDavStatus(null);
    await davAction.run({
      scope: 'webdav',
      label: '正在下载并应用…',
      fail: false,
      task: async () => {
        const safe = await createSnapshot(storage);
        await pruneSnapshots(storage, settings.backupKeep);
        const result = await downloadAndApply(storage, dav, mode);
        await onSnapshotsChanged();
        if (!result.ok) {
          const message = fail('下载', result.error, '请检查网络后重试');
          setDavStatus(said(message));
          toast.error(message);
          return;
        }
        const outcome = result.outcome;
        if (mode === 'settings') {
          const count = outcome?.settings?.imported ?? 0;
          const message = `已应用设置与预设（写入 ${count} 条${outcome?.presets === true ? '，含预设' : ''}）${safe === null ? '' : '，下载前已创建快照'}`;
          setDavStatus(said(message));
          toast.success(message);
          await onSettingsReplaced();
          return;
        }
        const message = `已恢复整库（写入 ${outcome?.full?.imported ?? 0} 条，清空 ${outcome?.full?.removed ?? 0} 条）${safe === null ? '' : '，下载前已创建快照'}`;
        setDavStatus(said(message));
        toast.success(message);
        // 整库恢复要重启才完全生效：统一登记给待重启条
        registerPendingRestart('webdav-restore');
        onChanged();
      },
    });
  }

  return (
    <div className="flex flex-col gap-1" data-role="webdav-settings">
      <span className="text-sm font-medium text-ink">WebDAV 云同步</span>
      <Field
        label="WebDAV 地址"
        hint="WebDAV 目录 URL"
        help="填完整目录地址，例如 https://dav.example.com/remote.php/dav/files/me/DawnTick"
      >
        <Input
          data-role="webdav-url"
          value={settings.webdavUrl}
          placeholder="https://dav.example.com/dav/DawnTick"
          onChange={(event) => void onPatch({ webdavUrl: event.target.value })}
        />
      </Field>
      <Field label="用户名">
        <Input
          data-role="webdav-user"
          value={settings.webdavUser}
          onChange={(event) => void onPatch({ webdavUser: event.target.value })}
        />
      </Field>
      <Field label="密码" hint="只存在本机设置里，不参与导出">
        <Input
          data-role="webdav-password"
          type="password"
          value={settings.webdavPassword}
          onChange={(event) => void onPatch({ webdavPassword: event.target.value })}
        />
      </Field>
      <SwitchField
        label="自动同步"
        checked={settings.webdavAuto}
        onCheckedChange={(checked) => void onPatch({ webdavAuto: checked })}
        ariaLabel="自动同步"
      />
      <SwitchField
        label="启动时同步一次"
        checked={settings.webdavOnStart}
        disabled={!settings.webdavAuto}
        onCheckedChange={(checked) => void onPatch({ webdavOnStart: checked })}
        ariaLabel="启动时同步"
      />
      <SwitchField
        label="每天同步一次"
        checked={settings.webdavDaily}
        disabled={!settings.webdavAuto}
        onCheckedChange={(checked) => void onPatch({ webdavDaily: checked })}
        ariaLabel="每天同步"
      />
      <SwitchField
        label="远端保留历史多份"
        checked={settings.webdavHistory}
        onCheckedChange={(checked) => void onPatch({ webdavHistory: checked })}
        ariaLabel="远端保留历史多份"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label="测试 WebDAV 连接"
          loading={davAction.busy}
          disabled={!davConfigured(dav)}
          onClick={() => void testDav()}
        >
          测试连接
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label="上传到 WebDAV"
          loading={davAction.busy}
          disabled={!davConfigured(dav)}
          onClick={() => void uploadDav()}
        >
          立即上传
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label="从 WebDAV 下载"
          disabled={davAction.busy || !davConfigured(dav)}
          onClick={() => setDavConfirmOpen(true)}
        >
          立即下载
        </Button>
      </div>
      {davStatus !== null && (
        <StatusLine dataRole="webdav-status" at={davStatus.at}>
          {davStatus.text}
        </StatusLine>
      )}

      <Dialog
        open={davConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setDavConfirmOpen(false);
        }}
      >
        <DialogContent
          title="从 WebDAV 下载"
          description="「恢复全部」会覆盖本机数据，需重启生效"
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDavConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="secondary"
              aria-label="下载并只应用设置与预设"
              loading={davAction.busy}
              onClick={() => void downloadDav('settings')}
            >
              只应用设置与预设
            </Button>
            <Button
              variant="danger"
              aria-label="下载并恢复整库"
              loading={davAction.busy}
              onClick={() => void downloadDav('all')}
            >
              恢复全部
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
