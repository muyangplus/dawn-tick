import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

/**
 * 「?」说明入口：点开显示一两句补充，正文只留动作与状态。
 * 用 Popover 而不是 title：触摸端也能点开，读屏能读到内容。
 */
export function HelpHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        aria-label={`说明：${label}`}
        data-role="help-hint"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] leading-none text-muted hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong"
      >
        ?
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={6}
          data-role="help-body"
          className="z-50 max-w-64 rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink shadow-lg"
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
