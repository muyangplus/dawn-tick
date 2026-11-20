import { cn } from '../../lib/cn.ts';
import { Button } from '../../components/ui/button.tsx';
import {
  STEP_COUNT,
  STEP_TITLES,
  canGoBack,
  compactStepLabel,
  type ImportStep,
} from './import-flow-model.ts';
import { importFlowCopy } from '../../copy/import-flow.ts';

export interface StepBarProps {
  step: ImportStep;
  onBack: () => void;
}

/**
 * 步骤条：桌面显示四个胶囊，窄屏收成「第 2/4 步 · 获取课表」。
 * 完整步骤表仍留在 DOM 里（读屏与冒烟按 aria-label="导入步骤" 找），只是窄屏视觉收起。
 */
export function StepBar({ step, onBack }: StepBarProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink tablet:hidden" data-role="step-compact">
        {compactStepLabel(step)}
      </p>
      <ol
        aria-label={importFlowCopy.stepsAria}
        className="hidden items-center gap-2 overflow-x-auto pb-1 text-xs tablet:flex"
      >
        {STEP_TITLES.map((label, index) => {
          const value = (index + 1) as ImportStep;
          return (
            <li
              key={label}
              aria-current={step === value ? 'step' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-3 py-1',
                step === value
                  ? 'bg-primary text-on-primary'
                  : step > value
                    ? 'bg-surface-muted text-ink'
                    : 'text-muted',
              )}
            >
              <span className="tabular">{value}</span>
              {label}
            </li>
          );
        })}
      </ol>
      {canGoBack(step) && (
        <div className="flex flex-col gap-2 tablet:flex-row tablet:items-center">
          <Button
            size="sm"
            variant="secondary"
            aria-label={importFlowCopy.backAria}
            className="w-full tablet:w-auto"
            onClick={onBack}
          >
            {importFlowCopy.back}
          </Button>
          <span className="text-center text-xs text-muted tablet:text-left">
            {importFlowCopy.stepProgress(step, STEP_COUNT)}
          </span>
        </div>
      )}
    </div>
  );
}
