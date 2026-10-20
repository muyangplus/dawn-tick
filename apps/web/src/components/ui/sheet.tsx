import { Drawer } from 'vaul';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { Dialog, DialogContent } from './dialog.tsx';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'bottom' | 'right';
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** 正文滚动区的附加样式：表单需要 flex + 间距，现有调用点保持原样 */
  bodyClassName?: string;
  /** 透传到内容节点的 data-* 属性（如 data-role），供断言与外部样式定位 */
  contentAttrs?: Record<string, string>;
}

/** 移动端底部弹窗与桌面端右侧抽屉：同一套内容，按断点换形态。 */
export function Sheet({
  open,
  onOpenChange,
  side = 'bottom',
  title,
  description,
  children,
  className,
  bodyClassName,
  contentAttrs,
}: SheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={side}>
      <Drawer.Portal>
        <Drawer.Overlay className="dt-overlay fixed inset-0 z-40 bg-overlay" />
        <Drawer.Content
          {...contentAttrs}
          data-container="sheet"
          className={cn(
            'dt-sheet fixed z-50 flex flex-col gap-4 border-line bg-surface p-4',
            side === 'bottom'
              ? 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg border-t'
              : 'bottom-0 right-0 top-0 w-[min(28rem,100vw)] rounded-l-lg border-l',
            className,
          )}
        >
          <div className="flex flex-col gap-1">
            <Drawer.Title className="text-base font-semibold text-ink">{title}</Drawer.Title>
            {description !== undefined && <Drawer.Description className="text-xs text-muted">{description}</Drawer.Description>}
          </div>
          <div
            data-role="sheet-body"
            className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName)}
          >
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** 表单容器形态：由挂载处按断点决定，表单组件只换壳不重写逻辑。 */
export type FormContainer = 'dialog' | 'sheet';

export interface FormSurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: FormContainer;
  title: string;
  description: string;
  children: ReactNode;
  /** 透传到容器内容节点（Sheet 与 Dialog 都带），保持 data-role 等断言选择器稳定 */
  contentAttrs?: Record<string, string>;
}

/**
 * 高频短表单的容器：移动端底部 Sheet、桌面端居中 Dialog。
 * 业务状态与提交逻辑留在各表单组件内，这里只负责外壳切换。
 */
export function FormSurface({
  open,
  onOpenChange,
  container,
  title,
  description,
  children,
  contentAttrs,
}: FormSurfaceProps) {
  if (container === 'sheet') {
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        side="bottom"
        title={title}
        description={description}
        bodyClassName="flex flex-col gap-4 overscroll-contain"
        {...(contentAttrs === undefined ? {} : { contentAttrs })}
      >
        {children}
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} {...contentAttrs} data-container="dialog">
        {children}
      </DialogContent>
    </Dialog>
  );
}
