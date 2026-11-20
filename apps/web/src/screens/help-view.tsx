import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Bell,
  CircleHelp,
  Cloud,
  GraduationCap,
  Info,
  ListChecks,
  MonitorSmartphone,
  RefreshCw,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { Input } from '../components/ui/input.tsx';
import {
  searchHelp,
  type HelpCategory,
  type HelpEntry,
  type HelpIconId,
  type HelpTarget,
} from '../help/help-content.ts';
import { helpCopy } from '../copy/help.ts';

export interface HelpViewProps {
  /** 「去设置」：切到对应页面并打开分组（由 App 统一处理） */
  onOpenGroup: (target: HelpTarget) => void;
  /** 从界面「查看帮助」进来时要展开并定位的条目 */
  focusEntryId?: string | null;
}

const ICONS: Record<HelpIconId, LucideIcon> = {
  update: RefreshCw,
  lan: Wifi,
  backup: Archive,
  import: GraduationCap,
  widget: MonitorSmartphone,
  notify: Bell,
  storage: Cloud,
  about: Info,
  schedule: ListChecks,
};

/** 单条帮助：标题 + 一句话说明默认可见，展开后按 1/2/3 显示步骤与「去设置」。 */
function HelpEntryCard({
  entry,
  focused,
  onOpenGroup,
}: {
  entry: HelpEntry;
  focused: boolean;
  onOpenGroup: (target: HelpTarget) => void;
}) {
  const goTo = entry.goTo;
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!focused || element === null) return;
    element.open = true;
    // jsdom 没有 scrollIntoView
    element.scrollIntoView?.({ block: 'start' });
    element.querySelector<HTMLElement>('summary')?.focus();
  }, [focused]);
  return (
    <details
      ref={ref}
      data-role="help-entry"
      data-help-id={entry.id}
      className="rounded-md border border-line bg-surface-muted/60"
    >
      <summary className="flex min-h-tap cursor-pointer list-none flex-col gap-0.5 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          {entry.title}
          <span className="text-[11px] font-normal text-primary-strong">{helpCopy.viewSteps}</span>
        </span>
        <span className="text-xs text-muted">{entry.summary}</span>
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-ink" data-role="help-steps">
          {entry.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {goTo !== undefined && (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            data-role="help-goto"
            data-goto-page={goTo.page}
            data-goto-group={goTo.group}
            onClick={() => onOpenGroup(goTo)}
          >
            {helpCopy.goTo(goTo.label)}
          </Button>
        )}
      </div>
    </details>
  );
}

function HelpCategoryCard({
  category,
  focusEntryId,
  onOpenGroup,
}: {
  category: HelpCategory;
  focusEntryId: string | null;
  onOpenGroup: (target: HelpTarget) => void;
}) {
  const Icon = ICONS[category.icon];
  return (
    <Card className="flex flex-col gap-3" data-role="help-category" data-category={category.id}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-primary-strong">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">{category.title}</h2>
          <p className="text-xs text-muted">{category.description}</p>
        </div>
        <span className="ml-auto shrink-0 text-[11px] text-muted">{helpCopy.entryCount(category.entries.length)}</span>
      </div>
      <div className="flex flex-col gap-2">
        {category.entries.map((entry) => (
          <HelpEntryCard
            key={entry.id}
            entry={entry}
            focused={entry.id === focusEntryId}
            onOpenGroup={onOpenGroup}
          />
        ))}
      </div>
    </Card>
  );
}

/**
 * 帮助页：引导式布局 —— 顶部搜索、按分类分组的条目、每条可展开看步骤。
 *
 * 搜索按标题、关键词与正文实时过滤并给出结果计数；无结果时显示空态。
 * 「去设置」只发目标（页面 + 分组），实际导航由 App 统一处理。
 */
export function HelpView({ onOpenGroup, focusEntryId = null }: HelpViewProps) {
  const [query, setQuery] = useState('');
  const result = useMemo(() => searchHelp(query), [query]);
  const searching = query.trim() !== '';

  return (
    <div className="flex flex-col gap-4" data-role="help-view">
      <div className="flex items-start gap-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-primary-strong">
          <CircleHelp className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold text-ink">{helpCopy.pageTitle}</h1>
          <p className="text-xs text-muted">{helpCopy.pageSubtitle}</p>
        </div>
      </div>

      <Input
        data-role="help-search"
        aria-label={helpCopy.searchLabel}
        type="search"
        placeholder={helpCopy.searchPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted" data-role="help-result-count">
          {searching ? helpCopy.found(result.total) : helpCopy.total(result.total)}
        </span>
        {searching && (
          <Button size="sm" variant="ghost" data-role="help-clear" onClick={() => setQuery('')}>
            {helpCopy.clearSearch}
          </Button>
        )}
      </div>

      {result.total === 0 ? (
        <EmptyState
          data-role="help-empty"
          tone="muted"
          title={helpCopy.emptyTitle}
          description={helpCopy.emptyDescription}
          action={
            <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
              {helpCopy.showAll}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {result.categories.map((category) => (
            <HelpCategoryCard
              key={category.id}
              category={category}
              focusEntryId={focusEntryId}
              onOpenGroup={onOpenGroup}
            />
          ))}
        </div>
      )}
    </div>
  );
}
