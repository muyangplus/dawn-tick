import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn.ts';

/**
 * 设置类页面的分组导航外壳：桌面左列分组、右列内容；移动端首页清单 + 点进子页。
 *
 * 为什么不继续用手风琴：卡片多、内容高时，展开/收起必然改变页面高度，切换会「跳」；
 * 分组导航一次只渲染一个分组，高度天然稳定，也天然做到了懒挂载（只挂载当前分组）。
 *
 * 交互约定：
 * - 桌面（≥1024px）：左列常驻，点分组换右侧内容，默认选第一组；
 * - 移动端：先显示分组清单，点进子页（只渲染该组内容），顶上「返回设置列表」回到清单；
 * - 分组内容由调用方提供，组件只负责导航、标题与返回，不关心配置项本身。
 */
export interface SettingsGroup {
  id: string;
  title: string;
  /** 清单里的一行摘要，例如「青春活力 · 跟随系统」 */
  summary: string;
  icon?: LucideIcon;
  /** 该分组的配置内容（只在选中时挂载） */
  content: ReactNode;
}

export interface GroupedSettingsProps {
  /** 页面标题，例如「设置」「设备与同步」 */
  pageTitle: string;
  /** 分组清单的无障碍名称 */
  ariaLabel: string;
  groups: readonly SettingsGroup[];
}

export function GroupedSettings({ pageTitle, ariaLabel, groups }: GroupedSettingsProps) {
  /** null = 移动端还在清单页；桌面下 null 视为第一组 */
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = groups.find((group) => group.id === activeId) ?? groups[0];
  const navVisibleOnMobile = activeId === null;

  return (
    <div className="flex flex-col gap-4 desktop:flex-row desktop:items-start">
      <nav
        aria-label={ariaLabel}
        className={cn(
          // 参考 CC Switch：窄侧栏 + 分组列表，选中项整行高亮
          'flex flex-col gap-0.5 p-1 desktop:w-56 desktop:shrink-0 desktop:border-r desktop:border-line desktop:pr-2',
          !navVisibleOnMobile && 'hidden desktop:flex',
        )}
      >
        <h1 className="px-2 pb-2 text-base font-semibold text-ink desktop:text-lg">{pageTitle}</h1>
        {groups.map((group) => {
          const selected = active?.id === group.id;
          return (
            <button
              key={group.id}
              type="button"
              data-role="settings-nav-item"
              data-group={group.id}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'dt-nav-item flex min-h-tap items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-muted',
                selected && 'bg-surface-muted',
              )}
              onClick={() => setActiveId(group.id)}
            >
              {group.icon !== undefined && <group.icon className="size-4 shrink-0 text-ink" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{group.title}</span>
                <span className="block truncate text-[11px] leading-tight text-muted">{group.summary}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted desktop:hidden" aria-hidden />
            </button>
          );
        })}
      </nav>

      <section
        aria-label={active?.title ?? pageTitle}
        className={cn('min-w-0 flex-1', navVisibleOnMobile && 'hidden desktop:block')}
      >
        <div className="flex items-center gap-2 pb-3 desktop:hidden">
          <button
            type="button"
            data-role="settings-nav-back"
            aria-label={`返回${pageTitle}列表`}
            className="dt-nav-item flex min-h-tap items-center gap-1 rounded-lg px-2 py-1 text-sm text-primary-strong"
            onClick={() => setActiveId(null)}
          >
            <ChevronLeft className="size-4" aria-hidden />
            返回
          </button>
          <h2 className="min-w-0 truncate text-base font-semibold text-ink">{active?.title}</h2>
        </div>
        <h2 className="hidden pb-3 text-base font-semibold text-ink desktop:block">{active?.title}</h2>
        <div className="flex min-w-0 flex-col gap-3">{active?.content}</div>
      </section>
    </div>
  );
}
