import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { cn } from '../../lib/cn.ts';
import { formatPeriodRange } from '../../lib/format.ts';
import type { Clash, EmptyDragMode, EmptyTarget } from './drag-session.ts';
import type { DragPointer } from './use-empty-slot.ts';
import { weekCopy } from '../../copy/timetable-week.ts';

/**
 * 44px 透明命中区：视觉尺寸不变，用伪元素把命中区外扩到触控口径（见 `--spacing-tap` 的 min-h-tap / size-tap 口径）。
 * 往上多扩 28px 是因为占位块只有一节高时，向下外扩会被 overflow-hidden 裁掉；左右各 14px 只占相邻留白。
 */
const TAP_AREA =
  "relative after:absolute after:content-[''] after:-top-7 after:bottom-0 after:-left-3.5 after:-right-3.5";
/** 滚轮条只上下外扩：左右外扩会盖住相邻的「上一节 / 下一节」。 */
const WHEEL_TAP_AREA =
  "relative after:absolute after:content-[''] after:-top-7 after:bottom-0 after:-left-1 after:-right-1";

export interface EmptySlotPlaceholderProps {
  placeholder: EmptyTarget;
  clash: Clash | null;
  bodyDragging: boolean;
  periodCount: number;
  rowHeight: number;
  padTop: number;
  /** 按钮与键盘处理读的是最新范围（含拖动中刚改的），不用渲染时的 placeholder */
  currentTarget: () => EmptyTarget | null;
  onBeginDrag: (event: React.PointerEvent<HTMLElement>, mode: EmptyDragMode) => void;
  onDragMove: (event: DragPointer) => void;
  onDragEnd: (event: DragPointer) => void;
  onDragCancel: (event: DragPointer) => void;
  onCreate: (target: EmptyTarget) => void;
  onStep: (target: EmptyTarget, delta: number) => void;
  onResize: (target: EmptyTarget, direction: -1 | 1) => void;
  onDismiss: () => void;
}

/** 空白格上的虚线占位块：「＋」新建、上一节/下一节、可拖动/滚轮/键盘调整的节次范围条。 */
export function EmptySlotPlaceholder({
  placeholder,
  clash,
  bodyDragging,
  periodCount,
  rowHeight,
  padTop,
  currentTarget,
  onBeginDrag,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onCreate,
  onStep,
  onResize,
  onDismiss,
}: EmptySlotPlaceholderProps) {
  return (
    <div
      className={cn(
        'absolute inset-x-1 z-10 flex select-none flex-col items-stretch gap-1 overflow-hidden rounded-sm border-2 border-dashed border-primary-strong bg-surface px-1.5 py-1',
        bodyDragging && 'ring-2 ring-primary-strong',
      )}
      style={{
        top: `${padTop + (placeholder.start - 1) * rowHeight + 2}px`,
        height: `${Math.max(rowHeight - 4, (placeholder.end - placeholder.start + 1) * rowHeight - 4)}px`,
        touchAction: 'none',
      }}
      data-role="empty-slot"
      data-dragging={bodyDragging ? 'true' : undefined}
      onPointerDown={(event) => onBeginDrag(event, 'body')}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragCancel}
      onClick={(event) => event.stopPropagation()}
    >
      {/* 本体拖动区：除了中间的「＋」小按钮，整块区域都能按住拖动改节次 */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <button
          type="button"
          aria-label={weekCopy.createHereAria}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-sm text-primary-strong hover:bg-surface-muted',
            TAP_AREA,
          )}
          data-tap-area="44"
          style={{ touchAction: 'none' }}
          onClick={(event) => {
            event.stopPropagation();
            // 用当前范围（含滚轮/箭头/拖动调好的节次），不要重置成单节
            const current = currentTarget();
            if (current === null) return;
            onCreate(current);
          }}
        >
          <Plus className="size-4" aria-hidden />
        </button>
        {bodyDragging && (
          // 拖动中的实时反馈：盖在「＋」上的一层；pointer-events-none 让单击仍落在按钮上
          <div
            data-role="empty-drag-label"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-sm bg-surface"
          >
            <span className="tabular rounded-sm bg-primary px-1.5 py-0.5 text-[11px] text-on-primary shadow-sm">
              {formatPeriodRange(placeholder.start, placeholder.end)}
            </span>
            {clash !== null && (
              <span data-role="empty-clash" className="max-w-full truncate text-[10px] text-danger-strong">
                {weekCopy.clashShort(clash.name)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-1 text-[11px]">
        <button
          type="button"
          aria-label={weekCopy.prevPeriodAria}
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-muted hover:text-ink',
            TAP_AREA,
          )}
          data-tap-area="44"
          onClick={(event) => {
            event.stopPropagation();
            const current = currentTarget();
            if (current !== null) onStep(current, -1);
          }}
        >
          <ChevronUp className="size-3.5" aria-hidden />
        </button>
        <div
          role="spinbutton"
          tabIndex={0}
          aria-label={weekCopy.periodRangeAria}
          aria-valuemin={placeholder.start}
          aria-valuemax={periodCount}
          aria-valuenow={placeholder.end}
          aria-valuetext={formatPeriodRange(placeholder.start, placeholder.end)}
          data-role="period-wheel"
          data-tap-area="44"
          title={weekCopy.periodWheelTitle}
          className={cn(
            'tabular cursor-ns-resize select-none whitespace-nowrap rounded-sm px-1 text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong',
            WHEEL_TAP_AREA,
          )}
          style={{ touchAction: 'none' }}
          onKeyDown={(event) => {
            const current = currentTarget();
            if (current === null) return;
            // ↑/↓ 调整范围：↓ 向下一节扩展、↑ 收回一节；Enter 直接新建，Esc 取消
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              onResize(current, event.key === 'ArrowDown' ? 1 : -1);
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              onCreate(current);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onDismiss();
            }
          }}
          onPointerDown={(event) => onBeginDrag(event, 'wheel')}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragCancel}
        >
          {formatPeriodRange(placeholder.start, placeholder.end)}
        </div>
        <button
          type="button"
          aria-label={weekCopy.nextPeriodAria}
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-muted hover:text-ink',
            TAP_AREA,
          )}
          data-tap-area="44"
          onClick={(event) => {
            event.stopPropagation();
            const current = currentTarget();
            if (current !== null) onStep(current, 1);
          }}
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
