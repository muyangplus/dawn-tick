import { useState } from 'react';
import { createEvent, type AiEventDraft, type Storage } from '@dawn-tick/core';
import { Button } from '../../components/ui/button.tsx';
import { Checkbox } from '../../components/ui/controls.tsx';
import { Dialog, DialogContent, DialogFooter } from '../../components/ui/dialog.tsx';
import { InlineError } from '../../components/ui/inline-error.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { loadAiClient } from '../../lib/ai.ts';
import { useBusyAction } from '../../lib/busy.ts';
import { errorMessage } from '../../lib/errors.ts';
import { fail } from '../../lib/fail.ts';
import { logInfo, logWarn } from '../../log.ts';
import { aiCopy as copy } from '../../copy/settings-ai.ts';
import { KIND_LABEL } from './section-props.ts';
import { eventInputOfDraft, generateEventDrafts } from './ai-events.ts';

export interface AiEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
  userId: string;
  semesterId: string;
  timeZone: string;
  onCreated: () => void;
}

function timeText(draft: AiEventDraft): string {
  if (draft.startTime === null) return copy.allDay;
  return draft.endTime === null ? draft.startTime : `${draft.startTime}–${draft.endTime}`;
}

/** 用 AI 生成日程：描述 → 生成草稿 → 勾选预览 → 写入。 */
export function AiEventDialog({ open, onOpenChange, storage, userId, semesterId, timeZone, onCreated }: AiEventDialogProps) {
  const [input, setInput] = useState('');
  const [drafts, setDrafts] = useState<AiEventDraft[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useBusyAction();

  function reset(): void {
    setDrafts(null);
    setWarnings([]);
    setPicked([]);
    setError(null);
  }

  async function generate(): Promise<void> {
    reset();
    await run(copy.generating, async () => {
      try {
        const client = await loadAiClient(storage);
        const result = await generateEventDrafts(client, input, Date.now(), timeZone);
        setDrafts(result.items);
        setWarnings(result.warnings);
        setPicked(result.items.map(() => true));
        logInfo('todo', 'AI 已生成日程草稿', { items: result.items.length, warnings: result.warnings.length });
      } catch (cause: unknown) {
        logWarn('todo', 'AI 生成日程失败', { error: errorMessage(cause) });
        setError(fail(copy.generateWhat, errorMessage(cause), copy.generateNext).text);
      }
    });
  }

  const chosen = (drafts ?? []).filter((_, index) => picked[index] === true);

  async function write(): Promise<void> {
    if (chosen.length === 0) return;
    await run(copy.writing, async () => {
      let written = 0;
      try {
        for (const draft of chosen) {
          await createEvent(storage, eventInputOfDraft(draft, { userId, semesterId, timeZone }));
          written += 1;
        }
        logInfo('todo', '已写入 AI 生成的日程', { count: written });
        toast.success(copy.written(written));
        setInput('');
        reset();
        onCreated();
        onOpenChange(false);
      } catch (cause: unknown) {
        logWarn('todo', '写入 AI 生成的日程失败', { error: errorMessage(cause), written });
        if (written > 0) onCreated();
        setError(fail(copy.writeWhat, errorMessage(cause), copy.retryLater).text);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={copy.dialogTitle} description={copy.dialogDescription} data-role="ai-event-dialog">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <textarea
            value={input}
            aria-label={copy.inputLabel}
            data-role="ai-event-input"
            placeholder={copy.inputPlaceholder}
            onChange={(event) => setInput(event.target.value)}
            className="min-h-24 w-full resize-y rounded-md border border-line bg-surface p-2 text-sm text-ink"
          />
          <Button
            variant="secondary"
            className="w-full tablet:w-auto tablet:self-start"
            loading={busy}
            disabled={input.trim().length === 0}
            onClick={() => void generate()}
          >
            {copy.generate}
          </Button>
          {error !== null && (
            <div role="alert">
              <InlineError>{error}</InlineError>
            </div>
          )}
          {drafts !== null && drafts.length === 0 && error === null && (
            <p className="text-sm text-muted">{copy.empty}</p>
          )}
          {drafts !== null && drafts.length > 0 && (
            <section aria-label={copy.previewAria} data-role="ai-event-preview" className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink">{copy.previewTitle(drafts.length)}</span>
              <ul className="flex flex-col gap-1">
                {drafts.map((draft, index) => (
                  <li key={`${draft.date}-${draft.title}-${index}`}>
                    <label className="flex min-h-11 items-center gap-3 rounded-md px-2 text-sm text-ink">
                      <Checkbox
                        checked={picked[index] === true}
                        onCheckedChange={(checked) =>
                          setPicked((previous) => previous.map((value, at) => (at === index ? checked === true : value)))
                        }
                      />
                      <span className="min-w-0 flex-1 break-words">
                        <span className="text-muted">{KIND_LABEL[draft.kind]}</span> {draft.title}
                        <span className="block text-xs text-muted">
                          {draft.date} {timeText(draft)}
                          {draft.location === null ? '' : ` · ${draft.location}`}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-muted" data-role="ai-event-warnings">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {copy.cancel}
          </Button>
          <Button variant="primary" loading={busy} disabled={chosen.length === 0} onClick={() => void write()}>
            {copy.write(chosen.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
