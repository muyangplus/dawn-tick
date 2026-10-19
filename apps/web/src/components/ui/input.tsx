import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn.ts';
import { HelpHint } from './help-hint.tsx';

const fieldBase =
  'w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong focus-visible:ring-offset-1 ' +
  'focus-visible:ring-offset-page disabled:opacity-50';

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={cn(fieldBase, 'min-h-tap', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'min-h-20 py-2', className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-xs font-medium text-muted', className)} {...props} />;
}

/** `hint` 是正文说明（≤20 字）；更长的补充放 `help`，收进「?」里。 */
export function Field({
  label,
  hint,
  help,
  children,
}: {
  label: string;
  hint?: string;
  help?: ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1">
        <Label>{label}</Label>
        {help !== undefined && <HelpHint label={label}>{help}</HelpHint>}
      </span>
      {children}
      {hint !== undefined && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}
