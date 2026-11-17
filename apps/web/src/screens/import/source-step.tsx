import type { ImportChannel, PasteSource } from './import-flow-model.ts';
import { PasteSourceStep } from './paste-source-step.tsx';
import { WindowSourceStep } from './window-source-step.tsx';
import type { PasteSourceApi } from './use-paste-source.ts';
import type { WindowSourceApi } from './use-window-source.ts';

export interface SourceStepProps {
  channel: ImportChannel;
  pasteSource: PasteSource;
  paste: PasteSourceApi;
  windowSource: WindowSourceApi;
  onPickPasteSource: (source: PasteSource) => void;
  onUsePaste: () => void;
}

/** 步骤 2 只按渠道分派取材面板：手写渠道在步骤 1 就交给宿主，不会进到这里。 */
export function SourceStep({
  channel,
  pasteSource,
  paste,
  windowSource,
  onPickPasteSource,
  onUsePaste,
}: SourceStepProps) {
  switch (channel) {
    case 'paste':
      return <PasteSourceStep paste={paste} source={pasteSource} onPickSource={onPickPasteSource} />;
    case 'window':
      return <WindowSourceStep source={windowSource} onUsePaste={onUsePaste} />;
    case 'manual':
      return null;
  }
}
