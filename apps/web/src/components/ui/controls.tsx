import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { useFieldControl, useRegisterFieldControl } from './input.tsx';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'size-5 shrink-0 rounded-sm border border-line-strong bg-surface',
        // 20px 的勾选框加一层 44px 透明命中区：视觉尺寸不变，触控/运动障碍用户可达（--spacing-tap 的 44px 口径）
        "relative after:absolute after:content-[''] after:-inset-3.5 after:rounded-sm",
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong',
        'data-[state=checked]:bg-primary data-[state=checked]:text-on-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="dt-check-icon size-4" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'dt-switch-motion inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-line-strong',
        // 24px 高：上下各外扩 10px 补到 44px 命中区，视觉高度不变
        "relative after:absolute after:content-[''] after:-inset-y-2.5 after:left-0 after:right-0",
        'bg-surface-muted data-[state=checked]:bg-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="dt-switch-thumb block size-5 translate-x-0.5 rounded-full bg-surface shadow-sm data-[state=checked]:translate-x-[1.375rem]" />
    </SwitchPrimitive.Root>
  );
}

export interface SwitchFieldProps {
  label: ReactNode;
  /** 标题下的补充说明（一句话）；需要长文本时自己传 Node */
  description?: ReactNode;
  icon?: LucideIcon;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** 开关本身的 aria-label，保持既有断言与可访问名不变 */
  ariaLabel?: string;
  /** 开关上的 data-role，保持既有断言选择器 */
  dataRole?: string;
  className?: string;
}

/**
 * 开关行：左侧标题 + 说明、右侧 Switch，整行可点（<label> 隐式关联）。
 * 只做展示，不含业务状态；`ariaLabel` / `dataRole` 落到 Switch 本身。
 */
export function SwitchField({
  label,
  description,
  icon: Icon,
  checked,
  onCheckedChange,
  disabled,
  ariaLabel,
  dataRole,
  className,
}: SwitchFieldProps) {
  return (
    <label className={cn('flex min-h-tap items-center justify-between gap-3 text-sm text-ink', className)}>
      <span className="flex min-w-0 flex-col">
        {Icon === undefined ? (
          <span>{label}</span>
        ) : (
          <span className="flex items-center gap-2">
            <Icon className="size-4" aria-hidden />
            {label}
          </span>
        )}
        {description !== undefined && <span className="truncate text-xs text-muted">{description}</span>}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={ariaLabel}
        data-role={dataRole}
      />
    </label>
  );
}

export const Select = SelectPrimitive.Root;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  const field = useFieldControl();
  useRegisterFieldControl(field);
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'inline-flex min-h-tap w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 text-sm text-ink',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong',
        'aria-invalid:border-danger-strong',
        className,
      )}
      {...props}
      id={props.id ?? field?.id}
      aria-invalid={props['aria-invalid'] ?? (field?.invalid === true ? true : undefined)}
      aria-describedby={props['aria-describedby'] ?? field?.describedBy}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 text-muted" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className={cn(
          'dt-select-content z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-surface shadow-md',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex min-h-tap cursor-pointer select-none items-center rounded-sm px-3 text-sm text-ink outline-none',
        'data-[highlighted]:bg-surface-muted data-[state=checked]:text-primary-strong',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
