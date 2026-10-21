import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

/**
 * 「?」说明入口：用 Popover 而非 title，触摸端可点开且读屏可读。
 *
 * 浮层走 Portal 挂到 body，不会被卡片/滚动容器的 `overflow` 裁切；
 * 限宽取「20rem 与视口减 2rem」的较小值，长 URL 这类无空格长词用 `break-words`
 * 折行，再加 8px 边界间距，窄屏上也不会横向溢出。
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
          avoidCollisions
          collisionPadding={8}
          data-role="help-body"
          className="z-50 max-w-[min(20rem,calc(100vw-2rem))] break-words rounded-md border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink shadow-lg"
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
