import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from './ui/button.tsx';
import { StatusLine } from './ui/status-line.tsx';
import { toast } from './ui/toaster.tsx';
import { relaunchApplication } from '../storage-config.ts';
import { clearPendingRestart, usePendingRestartSources } from '../pending-restart.ts';
import { fail } from '../copy/zh.ts';

export interface PendingRestartBarProps {
  /** 主壳里离内容更近，留白略小；设置页顶部用默认值 */
  compact?: boolean;
}

/**
 * 待重启常驻条（P1-06）：同一全局状态只有这一处呈现。
 * 「稍后」只把这条压成一行，计数与「立即重启」仍在，避免关掉后无处可查。
 */
export function PendingRestartBar({ compact = false }: PendingRestartBarProps) {
  const sources = usePendingRestartSources();
  const [collapsed, setCollapsed] = useState(false);

  // 新登记一笔就重新展开：用户刚改完设置时应该看到完整提示
  useEffect(() => {
    setCollapsed(false);
  }, [sources.length]);

  if (sources.length === 0) return null;

  async function restart(): Promise<void> {
    const ok = await relaunchApplication();
    if (!ok) {
      toast.error(fail('重启', null, '请手动重新打开应用'));
      return;
    }
    clearPendingRestart();
  }

  return (
    <div
      data-role="pending-restart"
      data-pending-restart-count={sources.length}
      className={`flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-muted px-3 ${
        compact ? 'py-1' : 'py-2'
      }`}
    >
      <StatusLine dataRole="pending-restart-status" className="text-ink">
        <span className="font-medium">{sources.length} 项改动待重启</span>
      </StatusLine>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <Button size="sm" variant="primary" aria-label="立即重启" onClick={() => void restart()}>
          <RotateCw className="size-3.5" aria-hidden />
          立即重启
        </Button>
        {collapsed ? (
          <Button size="sm" variant="ghost" aria-label="展开待重启提示" onClick={() => setCollapsed(false)}>
            展开
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(true)}>
            稍后
          </Button>
        )}
      </span>
    </div>
  );
}
