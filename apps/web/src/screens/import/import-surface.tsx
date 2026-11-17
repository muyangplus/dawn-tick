import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn.ts';

/**
 * 导入主流程的唯一表面：步骤内容只在这层承载。
 * 原先「Dialog 里套 CollapsibleCard 再套 Card」的三级嵌套改为「步骤条 + 单层表面」。
 */
export function ImportSurface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 tablet:p-4', className)}
      {...props}
    />
  );
}
