import { useEffect, useRef, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../../lib/cn.ts';

export interface UpdateMoreMenuProps {
  ignored: boolean;
  ignoring: boolean;
  showBackground: boolean;
  showRetry: boolean;
  onIgnore: () => void;
  onUnignore: () => void;
  onBackground: () => void;
  onRetry: () => void;
  onOpenRelease: () => void;
  onCopyLink: () => void;
}

/** 菜单项：统一收起菜单再派发动作，避免动作执行后菜单还挂在页面上。 */
function MenuItem({
  root,
  role,
  onSelect,
  children,
}: {
  root: React.RefObject<HTMLDetailsElement | null>;
  role?: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-role={role}
      className="dt-nav-item flex min-h-tap w-full items-center gap-2 rounded-sm px-3 text-left text-sm text-ink hover:bg-surface-muted disabled:opacity-50"
      onClick={() => {
        if (root.current !== null) root.current.open = false;
        onSelect();
      }}
    >
      {children}
    </button>
  );
}

/**
 * 更新弹窗的「更多」菜单：忽略/取消忽略、后台下载并关闭、打开发布页、复制下载链接、重试。
 *
 * 主操作之外的动作都收在这里，弹窗底部只留「立即更新」与「稍后」；
 * 用 `<details>` + `role="menu"` 实现，点击菜单外或按 Esc 自动收起。
 */
export function UpdateMoreMenu(props: UpdateMoreMenuProps) {
  const root = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const self = root.current;
      if (self === null || !self.open) return;
      if (event.target instanceof Node && self.contains(event.target)) return;
      self.open = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      const self = root.current;
      if (self === null || !self.open) return;
      if (event.key === 'Escape') self.open = false;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <details ref={root} data-role="update-more" className="relative">
      <summary
        aria-label="更多更新操作"
        className={cn(
          'dt-btn-motion inline-flex min-h-tap cursor-pointer list-none items-center justify-center gap-1 rounded-md border border-line bg-surface-muted px-3 text-sm font-medium text-ink',
          'hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong focus-visible:ring-offset-2 focus-visible:ring-offset-page',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <MoreHorizontal className="size-4" aria-hidden />
        更多
      </summary>
      <div
        role="menu"
        aria-label="更多更新操作"
        className="dt-menu-in absolute bottom-full right-0 z-30 mb-1 flex w-52 flex-col gap-1 rounded-md border border-line bg-surface p-1 shadow-md"
      >
        {props.ignored ? (
          <MenuItem root={root} role="update-unignore" onSelect={props.onUnignore}>
            取消忽略此版本
          </MenuItem>
        ) : (
          <MenuItem root={root} role="update-ignore" onSelect={props.onIgnore}>
            {props.ignoring ? '正在忽略…' : '忽略此版本'}
          </MenuItem>
        )}
        {props.showBackground && (
          <MenuItem root={root} role="update-background" onSelect={props.onBackground}>
            后台下载并关闭
          </MenuItem>
        )}
        {props.showRetry && (
          <MenuItem root={root} role="update-retry" onSelect={props.onRetry}>
            重试
          </MenuItem>
        )}
        <MenuItem root={root} role="update-open-release" onSelect={props.onOpenRelease}>
          打开发布页
        </MenuItem>
        <MenuItem root={root} role="update-copy-link" onSelect={props.onCopyLink}>
          复制下载链接
        </MenuItem>
      </div>
    </details>
  );
}
