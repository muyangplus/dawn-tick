import { useEffect, useRef, useState } from 'react';
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
import { StatusLine, type StatusMessage, type StatusTone } from '../../components/ui/status-line.tsx';
import { registerPendingRestart } from '../../pending-restart.ts';
import { useAction } from '../../lib/action.ts';
import {
  ENCRYPTION_UNAVAILABLE_TEXT,
  readWebdavPassword,
  saveWebdavPassword,
  type WebdavPasswordInfo,
} from '../../lib/credentials.ts';
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

/** 密码状态行：加密态是「已加密保存」，无加密能力的平台显式说明会落明文。 */
function passwordStatus(
  info: WebdavPasswordInfo | null,
  busy: boolean,
  saveError: string | null,
): { text: string; tone: StatusTone } {
  if (busy) return { text: '正在保存密码…', tone: 'muted' };
  if (saveError !== null) return { text: saveError, tone: 'danger' };
  if (info === null) return { text: '正在读取密码…', tone: 'muted' };
  if (info.state === 'error') return { text: info.message ?? '密码无法解密，请重新输入', tone: 'danger' };
  if (info.state === 'plaintext') return { text: info.message ?? ENCRYPTION_UNAVAILABLE_TEXT, tone: 'danger' };
  if (info.state === 'encrypted' || info.state === 'migrated') return { text: '已加密保存', tone: 'success' };
  return info.encryptionAvailable
    ? { text: '未保存密码', tone: 'muted' }
    : { text: '本平台不支持加密：保存后密码会以明文留在本机', tone: 'danger' };
}

/** 密码框只写不回显：占位文案说明当前存储状态，真正的值从不回填。 */
function passwordPlaceholder(info: WebdavPasswordInfo | null): string {
  if (info === null) return '';
  if (info.state === 'encrypted' || info.state === 'migrated') return '已加密保存（输入新密码可覆盖）';
  if (info.state === 'error') return '请重新输入 WebDAV 密码';
  if (info.state === 'plaintext') return '输入 WebDAV 密码（本平台不加密）';
  return '输入 WebDAV 密码';
}

/**
 * WebDAV 块：地址账号、自动同步开关、测试连接 / 上传 / 下载。
 *
 * 下载要覆盖本机数据，因此走二次确认；整库恢复登记待重启，只应用设置则热加载。
 * 密码框只写：输入后离开输入框（或回车）才加密保存，存储值不回显，只显示「已加密保存」。
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
  const [passwordInfo, setPasswordInfo] = useState<WebdavPasswordInfo | null>(null);
  /** 正在输入、尚未提交的密码；null 表示没有未保存的改动 */
  const [passwordDraft, setPasswordDraft] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordSaveError, setPasswordSaveError] = useState<string | null>(null);
  /** 当前可用的明文密码：只在内存里，供本次会话的请求使用 */
  const passwordRef = useRef('');
  const draftRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const info = await readWebdavPassword(storage);
      if (!alive) return;
      passwordRef.current = info.password;
      setPasswordInfo(info);
    })();
    return () => {
      alive = false;
    };
  }, [storage]);

  /** 每次请求都现取密码：刚提交的密码要立即用于测试连接 / 上传下载。 */
  function davSettings(): DavSettings {
    return {
      webdavUrl: settings.webdavUrl,
      webdavUser: settings.webdavUser,
      webdavPassword: passwordRef.current,
      webdavHistory: settings.webdavHistory,
    };
  }

  function updateDraft(value: string): void {
    draftRef.current = value;
    setPasswordDraft(value);
    setPasswordSaveError(null);
  }

  /** 提交未保存的密码：空串表示清除；加密失败时保留旧值并给出可读错误。 */
  async function commitPassword(): Promise<void> {
    const next = draftRef.current;
    if (next === null) return;
    draftRef.current = null;
    setPasswordDraft(null);
    setPasswordBusy(true);
    setPasswordSaveError(null);
    const result = await saveWebdavPassword(storage, next);
    setPasswordBusy(false);
    if (result.error !== null) {
      setPasswordSaveError(fail('保存 WebDAV 密码', result.error, '请稍后重试'));
      return;
    }
    passwordRef.current = next;
    setPasswordInfo({
      password: next,
      state: result.state === 'encrypted' ? 'encrypted' : result.state === 'plaintext' ? 'plaintext' : 'empty',
      message: result.message,
      encryptionAvailable: result.encryptionAvailable,
    });
  }

  async function testDav(): Promise<void> {
    await commitPassword();
    setDavStatus(said('正在测试连接…'));
    await davAction.run({
      scope: 'webdav',
      label: '正在测试连接…',
      fail: false,
      task: async () => {
        const status = await testConnection(davSettings());
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
    await commitPassword();
    setDavStatus(null);
    await davAction.run({
      scope: 'webdav',
      label: '正在上传到 WebDAV…',
      fail: false,
      task: async () => {
        const result = await uploadPackage(storage, davSettings());
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
    await commitPassword();
    setDavConfirmOpen(false);
    setDavStatus(null);
    await davAction.run({
      scope: 'webdav',
      label: '正在下载并应用…',
      fail: false,
      task: async () => {
        const safe = await createSnapshot(storage);
        await pruneSnapshots(storage, settings.backupKeep);
        const result = await downloadAndApply(storage, davSettings(), mode);
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

  const passwordView = passwordStatus(passwordInfo, passwordBusy, passwordSaveError);

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
      <Field label="密码" hint="只存在本机，不参与导出">
        <Input
          data-role="webdav-password"
          type="password"
          autoComplete="new-password"
          value={passwordDraft ?? ''}
          placeholder={passwordPlaceholder(passwordInfo)}
          onChange={(event) => updateDraft(event.target.value)}
          onBlur={() => void commitPassword()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </Field>
      <StatusLine dataRole="webdav-password-state" tone={passwordView.tone}>
        {passwordView.text}
      </StatusLine>
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
          disabled={!davConfigured(settings)}
          onClick={() => void testDav()}
        >
          测试连接
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label="上传到 WebDAV"
          loading={davAction.busy}
          disabled={!davConfigured(settings)}
          onClick={() => void uploadDav()}
        >
          立即上传
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label="从 WebDAV 下载"
          disabled={davAction.busy || !davConfigured(settings)}
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
