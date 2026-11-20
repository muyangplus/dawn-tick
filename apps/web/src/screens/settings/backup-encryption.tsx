import { BACKUP_PASSWORD_MIN_LENGTH } from '../../lib/backup-crypto.ts';
import { Field, Input } from '../../components/ui/input.tsx';
import { FormDialog } from '../../components/ui/dialog.tsx';
import { transferCopy as copy } from '../../copy/backup-transfer.ts';
import { HelpLink } from '../../components/help-link.tsx';

/**
 * 导出加密的界面片段：只放勾选、口令与警示，校验与加解密由调用方和
 * `lib/backup-crypto.ts` 负责；口令仅存在组件状态里，不落盘、不进日志。
 */

/** 提交前的口令校验：返回可读问题，没问题返回 null。 */
export function exportPasswordIssue(password: string, confirm: string): string | null {
  if (password.length < BACKUP_PASSWORD_MIN_LENGTH) {
    return copy.passwordTooShort(BACKUP_PASSWORD_MIN_LENGTH);
  }
  if (password !== confirm) return copy.passwordMismatch;
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
          aria-label={copy.encryptToggle}
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        {copy.encryptToggle}
      </label>
      {enabled && (
        <>
          <Field
            label={copy.passwordLabel}
            hint={copy.passwordHint(BACKUP_PASSWORD_MIN_LENGTH)}
          >
            <Input
              data-role="export-password"
              type="password"
              autoComplete="new-password"
              aria-label={copy.passwordLabel}
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
            />
          </Field>
          <Field label={copy.confirmLabel}>
            <Input
              data-role="export-password-confirm"
              type="password"
              autoComplete="new-password"
              aria-label={copy.confirmAriaLabel}
              value={confirm}
              onChange={(event) => onConfirmChange(event.target.value)}
            />
          </Field>
          <span
            role="note"
            data-role="export-password-warning"
            className="text-xs text-danger-strong"
          >
            {copy.forgetWarning}
          </span>
          <HelpLink entryId="backup-transfer" />
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
      title={copy.unlockTitle}
      description={copy.unlockDescription}
      submitLabel={copy.unlockSubmit}
      submitting={busy}
      submitDisabled={password.length === 0}
      onSubmit={onSubmit}
      contentAttrs={{ 'data-role': 'unlock-backup-dialog' }}
    >
      <Field label={copy.unlockLabel} hint={copy.unlockHint} error={error ?? undefined}>
        <Input
          data-role="unlock-backup-password"
          type="password"
          autoComplete="current-password"
          aria-label={copy.unlockLabel}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </Field>
      <span className="text-xs text-muted" data-role="unlock-backup-hint">
        {copy.unlockForgetHint}
      </span>
    </FormDialog>
  );
}
