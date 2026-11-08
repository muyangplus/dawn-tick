import { useEffect, useState } from 'react';
import { Button } from '../ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog.tsx';
import { StatusLine } from '../ui/status-line.tsx';
import { toast } from '../ui/toaster.tsx';
import { copyText } from '../../system-actions.ts';

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
    if (ok) toast.success('已复制扫码内容');
    else toast.error('复制失败，请长按选择文本复制');
  }

  const failed = error !== null && error !== undefined && error !== '';

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent
        title={failed ? '扫码没有成功' : '扫码结果'}
        description={failed ? '可以重试，或改用粘贴 / 手输' : '识别到的内容保留在这里，可复制后自行使用'}
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
                复制失败，请长按选择文本复制
              </StatusLine>
            )}
            {copied === 'ok' && (
              <StatusLine dataRole="scan-result-copy-state" tone="success">
                已复制
              </StatusLine>
            )}
          </>
        )}
        <DialogFooter>
          {failed && onRetry !== undefined && (
            <Button size="sm" variant="secondary" aria-label="重新扫码" onClick={onRetry}>
              重新扫码
            </Button>
          )}
          {!failed && (
            <Button
              size="sm"
              variant="secondary"
              aria-label="复制扫码内容"
              disabled={text === undefined || text === ''}
              onClick={() => void copy()}
            >
              复制内容
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-label="关闭扫码结果" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
