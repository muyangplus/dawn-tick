import { useMemo, useState } from 'react';
import {
  Archive,
  Bell,
  CircleHelp,
  Cloud,
  GraduationCap,
  Info,
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

export interface HelpViewProps {
  /** 「去设置」：切到对应页面并打开分组（由 App 统一处理） */
  onOpenGroup: (target: HelpTarget) => void;
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
};

/** 单条帮助：标题 + 一句话说明默认可见，展开后按 1/2/3 显示步骤与「去设置」。 */
function HelpEntryCard({ entry, onOpenGroup }: { entry: HelpEntry; onOpenGroup: (target: HelpTarget) => void }) {
  const goTo = entry.goTo;
  return (
    <details
      data-role="help-entry"
      data-help-id={entry.id}
      className="rounded-md border border-line bg-surface-muted/60"
    >
      <summary className="flex min-h-tap cursor-pointer list-none flex-col gap-0.5 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          {entry.title}
          <span className="text-[11px] font-normal text-primary-strong">查看步骤</span>
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
            去设置：{goTo.label}
          </Button>
        )}
      </div>
    </details>
  );
}

function HelpCategoryCard({
  category,
  onOpenGroup,
}: {
  category: HelpCategory;
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
        <span className="ml-auto shrink-0 text-[11px] text-muted">{category.entries.length} 条</span>
      </div>
      <div className="flex flex-col gap-2">
        {category.entries.map((entry) => (
          <HelpEntryCard key={entry.id} entry={entry} onOpenGroup={onOpenGroup} />
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
export function HelpView({ onOpenGroup }: HelpViewProps) {
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
          <h1 className="text-lg font-semibold text-ink">帮助与使用指引</h1>
          <p className="text-xs text-muted">
            按分类查看常见操作步骤；也可以直接搜索功能名、设置项或报错关键词。
          </p>
        </div>
      </div>

      <Input
        data-role="help-search"
        aria-label="搜索帮助"
        type="search"
        placeholder="搜索：下载源、配对、快照、通知、WebDAV…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted" data-role="help-result-count">
          {searching ? `找到 ${result.total} 条帮助` : `共 ${result.total} 条帮助`}
        </span>
        {searching && (
          <Button size="sm" variant="ghost" data-role="help-clear" onClick={() => setQuery('')}>
            清空搜索
          </Button>
        )}
      </div>

      {result.total === 0 ? (
        <EmptyState
          data-role="help-empty"
          tone="muted"
          title="没有匹配的帮助内容"
          description="换个关键词试试，例如「更新」「配对」「备份」或「通知」。"
          action={
            <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
              查看全部帮助
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {result.categories.map((category) => (
            <HelpCategoryCard key={category.id} category={category} onOpenGroup={onOpenGroup} />
          ))}
        </div>
      )}
    </div>
  );
}
