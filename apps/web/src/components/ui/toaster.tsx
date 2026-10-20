import { Toaster as SonnerToaster } from 'sonner';

export { toast } from '../../lib/toast.ts';

export function Toaster({ mode }: { mode: 'light' | 'dark' }) {
  return (
    <SonnerToaster
      theme={mode}
      position="top-center"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-md border border-line bg-surface text-ink shadow-md',
          description: 'text-muted',
          actionButton: 'bg-primary text-on-primary',
          cancelButton: 'bg-surface-muted text-ink',
        },
      }}
    />
  );
}
