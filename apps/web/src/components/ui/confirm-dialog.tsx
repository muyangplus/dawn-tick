import { useEffect, useState } from 'react';
import { Button } from './button.tsx';
import { Dialog, DialogContent, DialogFooter } from './dialog.tsx';

/** 破坏性动作确认：同一时刻只保留一个待确认请求，返回是否确认执行。 */
export interface ConfirmRequest {
  title: string;
  /** 后果说明，句式来自 copy/zh.ts 的 DELETE / OVERWRITE */
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
}

interface PendingConfirm {
  request: ConfirmRequest;
  resolve: (ok: boolean) => void;
}

let pending: PendingConfirm | null = null;
const listeners = new Set<(next: PendingConfirm | null) => void>();

function publish(next: PendingConfirm | null): void {
  pending = next;
  for (const listener of listeners) listener(next);
}

/** 弹确认框并等待结果；新请求会先把上一个请求按「取消」处理。 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  if (pending !== null) {
    const previous = pending;
    publish(null);
    previous.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    publish({ request, resolve });
  });
}

function settle(ok: boolean): void {
  const current = pending;
  if (current === null) return;
  publish(null);
  current.resolve(ok);
}

/** 全局唯一的确认框宿主，挂在应用根节点。 */
export function ConfirmDialogHost() {
  const [current, setCurrent] = useState<PendingConfirm | null>(pending);
  useEffect(() => {
    const listener = (next: PendingConfirm | null): void => setCurrent(next);
    listeners.add(listener);
    listener(pending);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const request = current?.request ?? null;
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <DialogContent title={request?.title ?? '确认操作'} description={request?.description ?? ''}>
        <DialogFooter>
          <Button variant="ghost" onClick={() => settle(false)}>
            {request?.cancelLabel ?? '取消'}
          </Button>
          <Button
            variant={request?.tone === 'default' ? 'primary' : 'danger'}
            data-role="confirm-action"
            onClick={() => settle(true)}
          >
            {request?.confirmLabel ?? '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
