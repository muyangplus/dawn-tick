import { useEffect, useState } from 'react';
import { Button } from '../ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog.tsx';
import { StatusLine } from '../ui/status-line.tsx';
import { toast } from '../ui/toaster.tsx';
import { copyText } from '../../system-actions.ts';
import { scanCopy } from '../../copy/import-scan.ts';

export interface ScanResultDialogProps {
  open: boolean;
  /** 识别到的文本；错误态为空 */
  text?: string;
  /** 解析补充说明：未知 scheme、像配对但解析失败等 */
  note?: string | null;
  /** 扫码失败原因；非空时显示错误态 */
  error?: string | null;
  onClose: () => void;
  onRetry?: () => void;
}

/**
 * 通用扫码结果面板：显示内容、复制、关闭；未知 scheme / 空内容会带说明。
 * 错误态保留「重新扫码」，不把失败静默丢掉。
 */
export function ScanResultDialog({ open, text, note, error, onClose, onRetry }: ScanResultDialogProps) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');

  useEffect(() => {
    if (!open) setCopied('idle');
  }, [open]);

  async function copy(): Promise<void> {
    const value = text ?? '';
    if (value === '') return;
    const ok = await copyText(value);
    setCopied(ok ? 'ok' : 'failed');
    if (ok) toast.success(scanCopy.copied);
    else toast.error(scanCopy.copyFailed);
  }

  const failed = error !== null && error !== undefined && error !== '';

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent
        title={failed ? scanCopy.failedTitle : scanCopy.resultTitle}
        description={failed ? scanCopy.failedDescription : scanCopy.resultDescription}
        data-role="scan-result"
      >
        {failed ? (
          <StatusLine dataRole="scan-result-error" tone="danger">
            {error}
          </StatusLine>
        ) : (
          <>
            <div
              data-role="scan-result-text"
              className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-surface-muted p-2 text-xs text-ink"
            >
              {text ?? ''}
            </div>
            {note !== null && note !== undefined && note !== '' && (
              <StatusLine dataRole="scan-result-note" tone="muted">
                {note}
              </StatusLine>
            )}
            {copied === 'failed' && (
              <StatusLine dataRole="scan-result-copy-state" tone="danger">
                {scanCopy.copyFailed}
              </StatusLine>
            )}
            {copied === 'ok' && (
              <StatusLine dataRole="scan-result-copy-state" tone="success">
                {scanCopy.copiedShort}
              </StatusLine>
            )}
          </>
        )}
        <DialogFooter>
          {failed && onRetry !== undefined && (
            <Button size="sm" variant="secondary" aria-label={scanCopy.retryAria} onClick={onRetry}>
              {scanCopy.retry}
            </Button>
          )}
          {!failed && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={scanCopy.copyAria}
              disabled={text === undefined || text === ''}
              onClick={() => void copy()}
            >
              {scanCopy.copy}
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-label={scanCopy.closeAria} onClick={onClose}>
            {scanCopy.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
