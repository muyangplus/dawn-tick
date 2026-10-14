import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn.ts';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-page disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:opacity-90',
        secondary: 'bg-surface-muted text-ink border border-line hover:border-line-strong',
        outline: 'border border-line-strong text-ink hover:bg-surface-muted',
        ghost: 'text-ink hover:bg-surface-muted',
        danger: 'bg-danger text-on-primary hover:opacity-90',
        link: 'text-primary-strong underline-offset-4 hover:underline',
      },
      size: {
        sm: 'min-h-tap px-3 text-sm',
        md: 'min-h-tap px-4 text-sm',
        lg: 'min-h-12 px-6 text-base',
        icon: 'size-tap shrink-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
