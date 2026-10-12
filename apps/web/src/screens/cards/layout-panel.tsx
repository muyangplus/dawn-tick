import { useState, type ReactNode } from 'react';
import type { Storage } from '@dawn-tick/core';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/cn.ts';
import { moveCard, resolveAllCards, type CardScope, type CardState, type CardZone, type LayoutConfig } from './registry.ts';
import { readLayout, writeLayout } from './layout-store.ts';

export interface CardLayoutPanelProps {
  layout: LayoutConfig;
  onChange: (layout: LayoutConfig) => void;
  storage: Storage;
}

const SCOPE_LABEL: Record<CardScope, string> = {
  schedule: '日程页',
  settings: '设置页',
};

/**
 * 卡片布局面板：每张卡片一行，支持显示隐藏、上移下移、主列/侧列切换，以及恢复默认。
 * 只做这三件事，不做像素级拖拽与嵌套布局。
 */
export function CardLayoutPanel({ layout, onChange, storage }: CardLayoutPanelProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function apply(next: LayoutConfig): Promise<void> {
    setBusy(true);
    try {
      await writeLayout(storage, next);
      onChange(next);
      setMessage(null);
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefault(): Promise<void> {
    setBusy(true);
    try {
      await writeLayout(storage, {});
      onChange(await readLayout(storage));
      setMessage('已恢复默认布局');
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-muted">
        每张卡片可以显示/隐藏、上移下移、在「主列 / 侧列」之间切换；恢复默认即回到出厂顺序。
      </span>
      {(['schedule', 'settings'] as const).map((scope) => (
        <ScopeGroup key={scope} scope={scope} layout={layout} busy={busy} onApply={(next) => void apply(next)} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          aria-label="恢复默认布局"
          onClick={() => void restoreDefault()}
        >
          恢复默认
        </Button>
        {message !== null && <span className="text-xs text-muted">{message}</span>}
      </div>
    </div>
  );
}

function ScopeGroup({
  scope,
  layout,
  busy,
  onApply,
}: {
  scope: CardScope;
  layout: LayoutConfig;
  busy: boolean;
  onApply: (next: LayoutConfig) => void;
}) {
  const cards = resolveAllCards(scope, layout);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-ink">{SCOPE_LABEL[scope]}</span>
      {cards.map((card, index) => (
        <CardRow
          key={card.def.id}
          scope={scope}
          id={card.def.id}
          title={card.def.title}
          visible={card.visible}
          zone={card.zone}
          layout={layout}
          busy={busy}
          canMoveUp={cards[index - 1]?.zone === card.zone}
          canMoveDown={cards[index + 1]?.zone === card.zone}
          onApply={onApply}
        />
      ))}
    </div>
  );
}

function CardRow({
  scope,
  id,
  title,
  visible,
  zone,
  layout,
  busy,
  canMoveUp,
  canMoveDown,
  onApply,
}: {
  scope: CardScope;
  id: string;
  title: string;
  visible: boolean;
  zone: CardZone;
  layout: LayoutConfig;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onApply: (next: LayoutConfig) => void;
}) {
  const state = layout[id];
  const set = (patch: CardState): LayoutConfig => ({
    ...layout,
    [id]: { ...state, ...patch },
  });
  const zoneButton = (target: CardZone, label: string): ReactNode => (
    <Button
      key={target}
      size="sm"
      variant={zone === target ? 'primary' : 'secondary'}
      disabled={busy}
      aria-label={`卡片区域：${title}：${label}`}
      onClick={() => onApply(set({ zone: target }))}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex min-h-tap items-center gap-2">
      <input
        type="checkbox"
        className="size-4 shrink-0"
        aria-label={`显示卡片：${title}`}
        checked={visible}
        disabled={busy}
        onChange={(event) => onApply(set({ visible: event.target.checked }))}
      />
      <span className={cn('min-w-0 flex-1 truncate text-sm text-ink', !visible && 'text-muted')}>{title}</span>
      <span className="flex shrink-0 items-center gap-1">
        {zoneButton('main', '主列')}
        {zoneButton('side', '侧列')}
        <Button
          size="icon"
          variant="ghost"
          aria-label={`上移卡片：${title}`}
          disabled={busy || !canMoveUp}
          onClick={() => onApply(moveCard(layout, scope, id, 'up'))}
        >
          ↑
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`下移卡片：${title}`}
          disabled={busy || !canMoveDown}
          onClick={() => onApply(moveCard(layout, scope, id, 'down'))}
        >
          ↓
        </Button>
      </span>
    </div>
  );
}
