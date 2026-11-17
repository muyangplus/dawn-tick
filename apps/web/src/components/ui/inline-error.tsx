import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export interface InlineErrorProps extends Omit<HTMLAttributes<HTMLParagraphElement>, 'role'> {
  children: ReactNode;
}

/** 表单/面板内的一行错误：统一字号、颜色与播报语义，调用方只给文案。 */
export function InlineError({ className, children, ...props }: InlineErrorProps) {
  return (
    <p role="alert" className={cn('text-xs text-danger-strong', className)} {...props}>
      {children}
    </p>
  );
}
