import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, FormEvent, ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { Button } from './button.tsx';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string | undefined }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dt-overlay fixed inset-0 z-40 bg-overlay" />
      <DialogPrimitive.Content
        className={cn(
          'dt-panel',
          // 高度上限按视口算：内容再长也留在屏幕内，由下面的正文区滚动
          'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4',
          'overflow-hidden rounded-lg border border-line bg-surface p-4 shadow-lg',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
            {description !== undefined && (
              <DialogPrimitive.Description className="text-xs text-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label="关闭"
            className="inline-flex size-tap items-center justify-center rounded-md text-muted hover:bg-surface-muted"
          >
            <X className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        </div>
        <div
          data-role="dialog-body"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-1"
        >
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** 提交回调：Enter 与底部主按钮共用；挂起态由 `submitting` 控制 */
  onSubmit: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  /** 主按钮语义：普通表单 primary，破坏性动作 danger */
  submitVariant?: 'primary' | 'danger';
  /**
   * 底部取消左侧的附加操作（如「只改这一节」）。
   * 内容区与底部都在 `<form>` 内，附加操作的 `Button` 必须写 `type="button"`，否则会触发提交。
   */
  extra?: ReactNode;
  /** 透传到内容节点的 data-* 属性（如 data-role），保持断言选择器稳定 */
  contentAttrs?: Record<string, string>;
  className?: string;
}

/**
 * 表单弹窗统一壳：标题/说明 + 内容 + 底部「取消/提交」+ 提交挂起态。
 * 只管展示与提交触发，校验、保存与文案都留在调用方。
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  submitLabel = '保存',
  cancelLabel = '取消',
  submitting = false,
  submitDisabled = false,
  submitVariant = 'primary',
  extra,
  contentAttrs,
  className,
}: FormDialogProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitting || submitDisabled) return;
    onSubmit();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} {...contentAttrs}>
        <form className={cn('flex flex-col gap-4', className)} onSubmit={handleSubmit}>
          {children}
          <DialogFooter>
            {extra}
            <Button type="button" variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant={submitVariant} loading={submitting} disabled={submitDisabled}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface DangerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  submitting?: boolean;
  onConfirm: () => void;
  contentAttrs?: Record<string, string>;
}

/** 破坏性动作确认弹窗：与 `FormDialog` 同一套壳，主按钮固定 danger 语义。 */
export function DangerDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认删除',
  cancelLabel = '取消',
  submitting = false,
  onConfirm,
  contentAttrs,
}: DangerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} {...contentAttrs}>
        <DialogFooter>
          <Button variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant="danger" loading={submitting} disabled={submitting} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
