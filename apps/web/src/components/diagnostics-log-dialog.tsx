import { useCallback, useEffect, useState } from 'react';
import { clearDiagnosticsLog, collectDiagnosticsLog, type DiagnosticsLog } from '../lib/diagnostics-log.ts';
import { copyText } from '../system-actions.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog.tsx';
import { toast } from './ui/toaster.tsx';

export interface DiagnosticsLogDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 诊断日志弹窗：直接查看/复制，不依赖文件系统与分享插件。
 *
 * 安卓上导出文件可能失败；这个弹窗是导出失败时的兜底入口（也可以随时查看）。
 */
export function DiagnosticsLogDialog({ open, onClose }: DiagnosticsLogDialogProps) {
  const [data, setData] = useState<DiagnosticsLog | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      setData(await collectDiagnosticsLog());
      setCopied(false);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  async function copyAll(): Promise<void> {
    if (data === null) return;
    const ok = await copyText(data.text === '' ? '（暂无日志）' : data.text);
    if (!ok) {
      toast.error('复制失败，请长按日志内容手动选择复制');
      return;
    }
    setCopied(true);
    toast.success('已复制全部诊断日志');
  }

  async function clearAll(): Promise<void> {
    const result = await clearDiagnosticsLog();
    if (result.error !== null) toast.error(`Web 日志已清空，原生日志清空失败：${result.error}`);
    else toast.success('已清空诊断日志');
    await reload();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-role="diagnostics-log-dialog"
        title="诊断日志"
        description={data === null ? '正在读取…' : `共 ${data.text.split('\n').length} 行，可直接复制发给开发者`}
        className="max-w-3xl"
      >
        <div className="flex flex-col gap-2">
          {data?.nativeError !== null && data?.nativeError !== undefined && (
            <p data-role="diagnostics-log-error" className="text-xs text-danger-strong" role="alert">
              原生日志读取失败：{data.nativeError}（Web 日志仍可用）
            </p>
          )}
          {data?.nativePath !== null && data?.nativePath !== undefined && (
            <p className="text-xs text-muted" data-role="diagnostics-log-path">
              原生日志：{data.nativePath}
            </p>
          )}
          <pre
            data-role="diagnostics-log-text"
            aria-label="诊断日志内容"
            className="max-h-[52vh] min-h-[160px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-surface-2 p-3 text-[11px] leading-relaxed text-ink"
          >
            {data === null || data.text === '' ? '（暂无日志：复现问题后再打开这里）' : data.text}
          </pre>
        </div>
        <DialogFooter>
          <Button
            size="sm"
            variant="secondary"
            data-role="diagnostics-log-copy"
            onClick={() => void copyAll()}
            disabled={data === null}
          >
            {copied ? '已复制' : '复制全部'}
          </Button>
          <Button size="sm" variant="ghost" data-role="diagnostics-log-refresh" loading={busy} onClick={() => void reload()}>
            刷新
          </Button>
          <Button size="sm" variant="ghost" data-role="diagnostics-log-clear" onClick={() => void clearAll()}>
            清空
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
