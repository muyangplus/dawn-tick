import { Drawer } from 'vaul';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'bottom' | 'right';
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
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
}: SheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={side}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Drawer.Content
          className={cn(
            'fixed z-50 flex flex-col gap-4 border-line bg-surface p-4',
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
          <div className="flex-1 overflow-y-auto">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
