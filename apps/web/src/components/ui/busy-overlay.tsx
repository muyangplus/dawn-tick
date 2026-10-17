import { Loader2 } from 'lucide-react';
import { useBusy } from '../../lib/busy.ts';

/** 慢操作蒙版：操作进行中盖住整页，同时挡住重复点击。 */
export function BusyOverlay() {
  const busy = useBusy();
  if (busy === null) return null;
  return (
    <div className="dt-busy-mask" data-role="busy-overlay" role="status" aria-live="polite">
      <span className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink shadow-lg">
        <Loader2 className="dt-spinner size-4" aria-hidden />
        <span>{busy.label}</span>
      </span>
    </div>
  );
}
