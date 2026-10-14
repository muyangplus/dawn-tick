import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export interface ComboboxProps<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (item: T) => void;
  renderItem?: (item: T) => ReactNode;
  placeholder?: string;
  ariaLabel: string;
  emptyText?: string;
  className?: string;
}

/** 可搜索下拉框：输入即筛选，方向键移动，回车选中。 */
export function Combobox<T>({
  items,
  keyOf,
  value,
  onValueChange,
  onSelect,
  renderItem,
  placeholder,
  ariaLabel,
  emptyText = '没有匹配项',
  className,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [value]);

  const commit = (index: number): void => {
    const item = items[index];
    if (item === undefined) return;
    onSelect(item);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn('relative flex flex-col', className)}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={open && items[active] !== undefined ? `${listId}-${keyOf(items[active] as T)}` : undefined}
        className={cn(
          'min-h-tap w-full rounded-md border border-line bg-surface px-3 text-sm text-ink',
          'placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong',
        )}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.min(current + 1, Math.max(0, items.length - 1)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => Math.max(0, current - 1));
          } else if (event.key === 'Enter') {
            if (open && items.length > 0) {
              event.preventDefault();
              commit(active);
            }
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={`${ariaLabel}候选`}
          className="absolute top-full z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-md"
        >
          {items.length === 0 && <div className="p-3 text-sm text-muted">{emptyText}</div>}
          {items.map((item, index) => (
            <div
              key={keyOf(item)}
              id={`${listId}-${keyOf(item)}`}
              role="option"
              aria-selected={index === active}
              tabIndex={-1}
              className={cn(
                'flex min-h-tap cursor-pointer items-center px-3 text-sm text-ink',
                index === active && 'bg-surface-muted',
              )}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(index)}
            >
              {renderItem === undefined ? String(item) : renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
