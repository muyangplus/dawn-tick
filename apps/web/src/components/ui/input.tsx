import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn.ts';
import { HelpHint } from './help-hint.tsx';

const fieldBase =
  'w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong focus-visible:ring-offset-1 ' +
  'focus-visible:ring-offset-page disabled:opacity-50 aria-invalid:border-danger-strong ' +
  'aria-invalid:focus-visible:ring-danger-strong';

/** `Field` 与内部控件之间的关联信息：控件自己消费，调用方无需关心。 */
export interface FieldControlContextValue {
  id: string;
  describedBy: string | undefined;
  /** 字段有错误时控件标 aria-invalid，边框随之变红 */
  invalid: boolean;
  register: () => () => void;
}

const FieldControlContext = createContext<FieldControlContextValue | null>(null);

export function useFieldControl(): FieldControlContextValue | null {
  return useContext(FieldControlContext);
}

/** 控件挂载后告诉 `Field`：这里确实存在可关联控件，`label` 才写 `htmlFor`。 */
export function useRegisterFieldControl(field: FieldControlContextValue | null): void {
  useEffect(() => field?.register(), [field]);
}

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  const field = useFieldControl();
  useRegisterFieldControl(field);
  return (
    <input
      ref={ref}
      className={cn(fieldBase, 'min-h-tap', className)}
      {...props}
      id={props.id ?? field?.id}
      aria-invalid={props['aria-invalid'] ?? (field?.invalid === true ? true : undefined)}
      aria-describedby={props['aria-describedby'] ?? field?.describedBy}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const field = useFieldControl();
  useRegisterFieldControl(field);
  return (
    <textarea
      className={cn(fieldBase, 'min-h-20 py-2', className)}
      {...props}
      id={props.id ?? field?.id}
      aria-invalid={props['aria-invalid'] ?? (field?.invalid === true ? true : undefined)}
      aria-describedby={props['aria-describedby'] ?? field?.describedBy}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-xs font-medium text-muted', className)} {...props} />;
}

/** `hint` 是正文说明（≤20 字）；更长的补充放 `help`，收进「?」里；`error` 为字段级校验错误。 */
export function Field({
  label,
  hint,
  help,
  error,
  children,
}: {
  label: string;
  hint?: string;
  help?: ReactNode;
  /** 字段级错误：非空时标红控件、播报文案，并替代 hint 的说明位置 */
  error?: string | undefined;
  children: React.ReactNode;
}) {
  const id = useId();
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter((item) => item !== undefined).join(' ') || undefined;
  /** 只有控件实际注册过才写 `htmlFor`：按钮组这类字段没有单一控件，避免悬空引用。 */
  const [hasControl, setHasControl] = useState(false);
  const controlCount = useRef(0);

  const register = useCallback(() => {
    controlCount.current += 1;
    setHasControl(true);
    return () => {
      controlCount.current -= 1;
      if (controlCount.current === 0) setHasControl(false);
    };
  }, []);

  const control = useMemo<FieldControlContextValue>(
    () => ({ id, describedBy, invalid: error !== undefined, register }),
    [id, describedBy, error, register],
  );

  return (
    <FieldControlContext.Provider value={control}>
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1">
          <Label htmlFor={hasControl ? id : undefined}>{label}</Label>
          {help !== undefined && <HelpHint label={label}>{help}</HelpHint>}
        </span>
        {children}
        {hint !== undefined && (
          <span id={hintId} className="text-xs text-muted">
            {hint}
          </span>
        )}
        {error !== undefined && (
          <span id={errorId} role="alert" className="text-xs text-danger-strong">
            {error}
          </span>
        )}
      </div>
    </FieldControlContext.Provider>
  );
}
