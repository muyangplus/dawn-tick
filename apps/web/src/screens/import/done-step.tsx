import { Button } from '../../components/ui/button.tsx';
import { InlineError } from '../../components/ui/inline-error.tsx';
import { ImportSurface } from './import-surface.tsx';
import { importFlowCopy } from '../../copy/import-flow.ts';

export interface DoneStepProps {
  warnings: readonly string[];
  onRestart: () => void;
  onClose: () => void;
}

/** 完成步骤：只报结果与下一步，不再套一层卡片。 */
export function DoneStep({ warnings, onRestart, onClose }: DoneStepProps) {
  return (
    <ImportSurface data-role="import-done">
      <span className="text-sm text-ink">{importFlowCopy.doneTitle}</span>
      {warnings.length > 0 && <InlineError>{warnings.join(importFlowCopy.warningSeparator)}</InlineError>}
      <div className="flex flex-col gap-2 tablet:flex-row">
        <Button variant="secondary" className="w-full tablet:w-auto" onClick={onRestart}>
          {importFlowCopy.importMore}
        </Button>
        <Button variant="primary" className="w-full tablet:w-auto" onClick={onClose}>
          {importFlowCopy.finish}
        </Button>
      </div>
    </ImportSurface>
  );
}
