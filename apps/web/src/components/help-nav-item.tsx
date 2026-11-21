import { CircleHelp } from 'lucide-react';
import { helpCopy } from '../copy/help.ts';

/**
 * 设置 / 设备分组清单末尾的「帮助」入口。
 *
 * 移动端用它从设置/设备列表进入帮助子页；桌面端左列也保持一致。
 * data-role 与分组行不同（settings-nav-help），因此不影响分组计数与选中态。
 */
export function HelpNavItem({ onOpenHelp }: { onOpenHelp: () => void }) {
  return (
    <button
      type="button"
      data-role="settings-nav-help"
      className="dt-nav-item flex min-h-tap items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-muted"
      onClick={onOpenHelp}
    >
      <CircleHelp className="size-4 shrink-0 text-ink" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{helpCopy.navTitle}</span>
        <span className="block truncate text-[11px] leading-tight text-muted">{helpCopy.navSubtitle}</span>
      </span>
    </button>
  );
}
