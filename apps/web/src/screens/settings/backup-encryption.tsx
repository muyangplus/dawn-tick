import { BACKUP_PASSWORD_MIN_LENGTH } from '../../lib/backup-crypto.ts';
import { Field, Input } from '../../components/ui/input.tsx';
import { FormDialog } from '../../components/ui/dialog.tsx';

/**
 * 导出加密的界面片段：只放勾选、口令与警示，校验与加解密由调用方和
 * `lib/backup-crypto.ts` 负责；口令仅存在组件状态里，不落盘、不进日志。
 */

/** 提交前的口令校验：返回可读问题，没问题返回 null。 */
export function exportPasswordIssue(password: string, confirm: string): string | null {
  if (password.length < BACKUP_PASSWORD_MIN_LENGTH) {
    return `口令至少 ${BACKUP_PASSWORD_MIN_LENGTH} 位`;
  }
  if (password !== confirm) return '两次输入的口令不一致';
  return null;
}

export interface ExportEncryptionFieldsProps {
  enabled: boolean;
  password: string;
  confirm: string;
  onEnabledChange: (enabled: boolean) => void;
  onPasswordChange: (password: string) => void;
  onConfirmChange: (confirm: string) => void;
}

export function ExportEncryptionFields({
  enabled,
  password,
  confirm,
  onEnabledChange,
  onPasswordChange,
  onConfirmChange,
}: ExportEncryptionFieldsProps) {
  return (
    <div className="flex flex-col gap-2" data-role="export-encryption">
      <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="size-4"
          aria-label="用口令加密"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        用口令加密
      </label>
      {enabled && (
        <>
          <Field
            label="加密口令"
            hint={`至少 ${BACKUP_PASSWORD_MIN_LENGTH} 位；口令不会保存到本机`}
          >
            <Input
              data-role="export-password"
              type="password"
              autoComplete="new-password"
              aria-label="加密口令"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
            />
          </Field>
          <Field label="确认口令" hint="再输入一次，避免打错">
            <Input
              data-role="export-password-confirm"
              type="password"
              autoComplete="new-password"
              aria-label="确认加密口令"
              value={confirm}
              onChange={(event) => onConfirmChange(event.target.value)}
            />
          </Field>
          <span
            role="note"
            data-role="export-password-warning"
            className="text-xs text-danger-strong"
          >
            忘记口令将无法恢复备份；晓刻不会保存口令，也无法帮你找回。
          </span>
          <span className="text-xs text-muted" data-role="export-encryption-scope">
            加密只覆盖本次导出的文件；自动快照仍按原样保存，不加密。
          </span>
        </>
      )}
    </div>
  );
}

export interface UnlockBackupDialogProps {
  open: boolean;
  password: string;
  error: string | null;
  busy: boolean;
  onPasswordChange: (password: string) => void;
  onSubmit: () => void;
  onOpenChange: (open: boolean) => void;
}

/** 导入加密备份时的口令框：错误留在框内，可反复重试。 */
export function UnlockBackupDialog({
  open,
  password,
  error,
  busy,
  onPasswordChange,
  onSubmit,
  onOpenChange,
}: UnlockBackupDialogProps) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="备份已加密"
      description="输入导出时设置的口令，解密后再选模块导入"
      submitLabel="解密并导入"
      submitting={busy}
      submitDisabled={password.length === 0}
      onSubmit={onSubmit}
      contentAttrs={{ 'data-role': 'unlock-backup-dialog' }}
    >
      <Field label="备份口令" hint="口令区分大小写；输错可以重试" error={error ?? undefined}>
        <Input
          data-role="unlock-backup-password"
          type="password"
          autoComplete="current-password"
          aria-label="备份口令"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </Field>
      <span className="text-xs text-muted" data-role="unlock-backup-hint">
        忘记口令将无法恢复这份备份；口令只在本次解密时使用。
      </span>
    </FormDialog>
  );
}
