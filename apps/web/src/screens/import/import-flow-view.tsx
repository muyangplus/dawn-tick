import { useEffect, useRef } from 'react';
import type { Storage } from '@dawn-tick/core';
import { ChannelStep } from './channel-step.tsx';
import { DoneStep } from './done-step.tsx';
import { PreviewStep } from './preview-step.tsx';
import { SourceStep } from './source-step.tsx';
import { StepBar } from './step-bar.tsx';
import { useImportFlow, type ImportFlowApi } from './use-import-flow.ts';
import { usePasteSource } from './use-paste-source.ts';
import { useWindowSource } from './use-window-source.ts';

export interface ImportFlowProps {
  storage: Storage;
  semesterId: string;
  /** 手动添加课程：由宿主页面决定怎么打开课程表单 */
  onManual?: (() => void) | undefined;
  onDone: () => void;
  onClose: () => void;
  /** 预填的粘贴文本：直接进入「网页文本」一步，由用户点识别进预览 */
  initialText?: string | null | undefined;
}

/**
 * 导入主流程：步骤条 + 单层表面。
 * 步骤只在这里做 switch 分派，业务状态在 use-import-flow / use-paste-source / use-window-source，
 * 纯状态机与选择逻辑在 import-flow-model。
 */
export function ImportFlow({ storage, semesterId, onManual, onDone, onClose, initialText = null }: ImportFlowProps) {
  const flow = useImportFlow({ storage, semesterId, onDone });
  const paste = usePasteSource({ storage, semesterId, onAccepted: flow.accept });
  // 只在打开时预填一次：之后用户改动粘贴框不再被覆盖
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || initialText === null || initialText === '') return;
    prefilled.current = true;
    flow.pickPasteSource('page');
    paste.setText(initialText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);
  const windowSource = useWindowSource({
    storage,
    onPayloadText: paste.setText,
    onAccepted: flow.accept,
  });

  return (
    <div className="flex flex-col gap-3">
      <StepBar step={flow.step} onBack={flow.back} />
      {renderStep(flow, paste, windowSource, onManual, onClose)}
    </div>
  );
}

function renderStep(
  flow: ImportFlowApi,
  paste: ReturnType<typeof usePasteSource>,
  windowSource: ReturnType<typeof useWindowSource>,
  onManual: (() => void) | undefined,
  onClose: () => void,
) {
  switch (flow.step) {
    case 1:
      return (
        <ChannelStep
          onPick={(channel) => {
            if (channel === 'manual') {
              onManual?.();
              return;
            }
            flow.pickChannel(channel);
          }}
        />
      );
    case 2:
      return (
        <SourceStep
          channel={flow.channel}
          pasteSource={flow.pasteSource}
          paste={paste}
          windowSource={windowSource}
          onPickPasteSource={flow.pickPasteSource}
          onUsePaste={() => flow.pickPasteSource('page')}
        />
      );
    case 3:
      return <PreviewStep flow={flow} />;
    case 4:
      return <DoneStep warnings={flow.warnings} onRestart={flow.restart} onClose={onClose} />;
  }
}
