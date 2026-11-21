import { useMemo, useRef, useState } from 'react';
import {
  executePlan,
  findAction,
  runAssistantTurn,
  type AiChatMessage,
  type AppSettings,
  type AssistantMode,
  type Storage,
} from '@dawn-tick/core';
import { AlertTriangle } from 'lucide-react';
import { createSnapshot, pruneSnapshots, restoreSnapshot, type SnapshotEntry } from '../backup.ts';
import { snapshotsCopy } from '../copy/backup-snapshots.ts';
import { assistantPanelCopy as copy } from '../copy/assistant.ts';
import { fail } from '../copy/common.ts';
import type { AppData } from '../data.ts';
import { loadAiClient } from '../lib/ai.ts';
import { cn } from '../lib/cn.ts';
import { errorMessage } from '../lib/errors.ts';
import { logError, logInfo, logWarn } from '../log.ts';
import { registerPendingRestart } from '../pending-restart.ts';
import { createAssistantHost, type AssistantHostDeps } from '../assistant/host-impl.ts';
import type { AssistantContext } from '../assistant/host.ts';
import {
  ASSISTANT_ACTIONS,
  applyExecution,
  cardsOf,
  contextNoteOf,
  hasDanger,
  markRunning,
  resetSkipped,
  selectedSteps,
  toggleCard,
  type PlanCard,
} from '../assistant/panel-model.ts';
import { Button } from './ui/button.tsx';
import { confirmAction } from './ui/confirm-dialog.tsx';
import { Checkbox } from './ui/controls.tsx';
import { Textarea } from './ui/input.tsx';
import { Sheet } from './ui/sheet.tsx';

export interface AssistantPanelProps extends Omit<AssistantHostDeps, 'storage' | 'userId' | 'settings'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'bottom' | 'right';
  storage: Storage;
  userId: string;
  settings: AppSettings;
  data: AppData;
  /** 写入口统一拦截（只读回退时返回 false） */
  guardWrite: (action: string) => boolean;
  onOpenAiSettings: () => void;
}

interface ChatEntry {
  id: number;
  role: 'user' | 'assistant' | 'note';
  text: string;
}

/** 动作说明的第一句：进度提示里给人看的名字。 */
function actionLabel(name: string): string {
  const action = findAction(ASSISTANT_ACTIONS, name);
  return action === undefined ? name : (action.description.split(/[，：；（。]/)[0] ?? name);
}

/**
 * AI 助手面板：对话在面板组件里常驻（关掉再开还在），计划卡片勾选后按顺序执行，执行前自动做快照。
 */
export function AssistantPanel(props: AssistantPanelProps) {
  const { open, onOpenChange, side, storage, userId, settings, data, guardWrite, onOpenAiSettings } = props;
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [cards, setCards] = useState<PlanCard[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotEntry | null>(null);
  const history = useRef<AiChatMessage[]>([]);
  const mode = useRef<AssistantMode | undefined>(undefined);
  const turn = useRef(0);
  const entrySeq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  // 最新的回调与设置：动作在异步执行中途读取，不能用渲染时的快照
  const latest = useRef(props);
  latest.current = props;

  const configured = settings.aiBaseUrl.trim() !== '' && settings.aiModel.trim() !== '';

  const context = useMemo<AssistantContext>(() => {
    const host = createAssistantHost({
      storage,
      userId,
      settings: () => latest.current.settings,
      patchSettings: (patch) => latest.current.patchSettings(patch),
      reloadSettings: () => latest.current.reloadSettings(),
      onDataChanged: () => latest.current.onDataChanged(),
      navigate: (target) => {
        latest.current.onOpenChange(false);
        latest.current.navigate(target);
      },
      openImport: (text) => {
        latest.current.onOpenChange(false);
        latest.current.openImport(text);
      },
    });
    return {
      storage,
      userId,
      now: () => Date.now(),
      get timeZone() {
        return latest.current.data.timeZone;
      },
      host,
    };
  }, [storage, userId]);

  function push(role: ChatEntry['role'], text: string): void {
    entrySeq.current += 1;
    const id = entrySeq.current;
    setEntries((list) => [...list, { id, role, text }]);
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (text === '' || busy) return;
    setInput('');
    push('user', text);
    setBusy(true);
    setProgress(copy.thinking);
    const controller = new AbortController();
    abort.current = controller;
    turn.current += 1;
    try {
      const client = await loadAiClient(storage);
      const result = await runAssistantTurn({
        client,
        actions: ASSISTANT_ACTIONS,
        context,
        history: history.current,
        userText: text,
        contextNote: contextNoteOf({
          today: data.today,
          todayOfWeek: data.todayOfWeek,
          timeZone: data.timeZone,
          semester: data.semester,
          week: data.week,
        }),
        stepIdPrefix: `t${turn.current}`,
        ...(mode.current === undefined ? {} : { mode: mode.current }),
        signal: controller.signal,
        onQuery: (name) => setProgress(copy.querying(actionLabel(name))),
      });
      history.current = result.history;
      mode.current = result.mode;
      push('assistant', result.exhausted ? copy.exhausted : result.reply === '' ? copy.emptyReply : result.reply);
      if (result.plan.length > 0) setCards((list) => [...list, ...cardsOf(result.plan)]);
      logInfo('app', '助手回复', { mode: result.mode, plan: result.plan.length, exhausted: result.exhausted });
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        push('note', fail(copy.requestWhat, errorMessage(cause)));
        logWarn('app', '助手请求失败', { message: errorMessage(cause) });
      }
    } finally {
      abort.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  async function execute(): Promise<void> {
    const steps = selectedSteps(cards);
    if (steps.length === 0 || executing) return;
    if (!guardWrite(copy.title)) return;
    if (hasDanger(steps)) {
      const ok = await confirmAction({
        title: copy.dangerConfirmTitle,
        description: copy.dangerConfirmDescription(steps.filter((step) => step.risk === 'danger').map((step) => step.preview)),
        confirmLabel: copy.dangerConfirm,
        tone: 'danger',
      });
      if (!ok) return;
    }
    setExecuting(true);
    try {
      const safe = await createSnapshot(storage).catch((error: unknown) => {
        logError('app', '助手执行前快照失败', { error: String(error) });
        return null;
      });
      if (safe === null) {
        push('note', copy.snapshotSkipped);
        return;
      }
      // 计划里要恢复的旧快照不能先被清理掉
      if (!steps.some((step) => step.action === 'restore_snapshot')) await pruneSnapshots(storage, settings.backupKeep);
      setSnapshot(safe);
      setCards((list) => markRunning(list, steps));
      const execution = await executePlan(steps, ASSISTANT_ACTIONS, context);
      setCards((list) => applyExecution(list, steps, execution));
      push(
        'note',
        copy.executedNote(
          execution.failed === null ? copy.executedAll(execution.done.length) : copy.executedPartly(execution.done.length, execution.failed.message),
          safe.id,
        ),
      );
      logInfo('app', '助手计划已执行', { done: execution.done.length, failed: execution.failed?.step.action ?? null });
      if (execution.done.length > 0) latest.current.onDataChanged();
    } finally {
      setExecuting(false);
    }
  }

  async function restore(): Promise<void> {
    if (snapshot === null || !guardWrite(copy.restoreWhat)) return;
    const ok = await confirmAction({
      title: copy.restoreTitle,
      description: copy.restoreDescription,
      confirmLabel: copy.restoreConfirm,
      tone: 'danger',
    });
    if (!ok) return;
    setExecuting(true);
    try {
      // 恢复前再留一份当前状态；这里不清理旧快照，免得把要恢复的那份清掉。
      // 快照 id 按毫秒取，时间不能与要恢复的那份相同，否则会把它覆盖
      await createSnapshot(storage, Math.max(Date.now(), snapshot.createdAt + 1)).catch((error: unknown) => {
        logWarn('app', '助手恢复前快照失败', { error: String(error) });
      });
      const outcome = await restoreSnapshot(storage, snapshot);
      if (!outcome.ok) {
        push('note', fail(copy.restoreWhat, outcome.error));
        return;
      }
      if (outcome.needsRestart) {
        // 文件快照重启后才套用，数据还没变，不刷新
        registerPendingRestart('snapshot-restore');
        setSnapshot(null);
        push('note', snapshotsCopy.restoreQueued);
        return;
      }
      await latest.current.reloadSettings();
      latest.current.onDataChanged();
      setSnapshot(null);
      push('note', copy.restored);
    } finally {
      setExecuting(false);
    }
  }

  function clearConversation(): void {
    abort.current?.abort();
    history.current = [];
    mode.current = undefined;
    setEntries([]);
    setCards([]);
    setSnapshot(null);
  }

  const selected = selectedSteps(cards);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side={side}
      title={copy.title}
      description={copy.description}
      bodyClassName="flex flex-col gap-3"
      contentAttrs={{ 'data-role': 'assistant-panel' }}
    >
      {!configured ? (
        <div className="flex flex-col gap-2" data-role="assistant-not-configured">
          <p className="text-sm text-muted">{copy.notConfigured}</p>
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => {
              onOpenChange(false);
              onOpenAiSettings();
            }}
          >
            {copy.openAiSettings}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2" data-role="assistant-chat" aria-live="polite">
            {entries.map((entry) => (
              <div
                key={entry.id}
                data-role={`assistant-${entry.role}`}
                className={cn(
                  'max-w-[90%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm',
                  entry.role === 'user' && 'self-end bg-primary text-on-primary',
                  entry.role === 'assistant' && 'self-start bg-surface-muted text-ink',
                  entry.role === 'note' && 'self-stretch max-w-none border border-line text-muted',
                )}
              >
                <span className="sr-only">{copy.speaker(entry.role === 'user' ? copy.you : copy.assistant)}</span>
                {entry.text}
              </div>
            ))}
            {progress !== null && <p className="text-xs text-muted">{progress}</p>}
          </div>

          {cards.length > 0 && (
            <section className="flex flex-col gap-2" data-role="assistant-plan" aria-label={copy.planTitle}>
              <h3 className="text-sm font-medium text-ink">{copy.planTitle}</h3>
              {cards.map((card) => (
                <PlanCardRow
                  key={card.step.id}
                  card={card}
                  disabled={executing || card.status !== 'pending'}
                  onToggle={() => setCards((list) => toggleCard(list, card.step.id))}
                />
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={hasDanger(selected) ? 'danger' : 'primary'}
                  data-role="assistant-execute"
                  disabled={selected.length === 0 || busy}
                  loading={executing}
                  onClick={() => void execute()}
                >
                  {executing ? copy.executing : copy.execute(selected.length)}
                </Button>
                {snapshot !== null && (
                  <Button
                    size="sm"
                    variant="secondary"
                    data-role="assistant-restore"
                    disabled={executing}
                    onClick={() => void restore()}
                  >
                    {copy.restoreSnapshot}
                  </Button>
                )}
                {cards.some((card) => card.status === 'skipped') && (
                  <Button size="sm" variant="ghost" onClick={() => setCards((list) => resetSkipped(list))}>
                    {copy.reselectSkipped}
                  </Button>
                )}
              </div>
            </section>
          )}

          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Textarea
              aria-label={copy.inputLabel}
              placeholder={copy.inputPlaceholder}
              value={input}
              data-role="assistant-input"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {entries.length > 0 && (
                <Button type="button" size="sm" variant="ghost" disabled={executing} onClick={clearConversation}>
                  {copy.clear}
                </Button>
              )}
              {busy ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => abort.current?.abort()}>
                  {copy.stop}
                </Button>
              ) : (
                <Button type="submit" size="sm" variant="primary" data-role="assistant-send" disabled={input.trim() === ''}>
                  {copy.send}
                </Button>
              )}
            </div>
          </form>
        </>
      )}
    </Sheet>
  );
}

function PlanCardRow({ card, disabled, onToggle }: { card: PlanCard; disabled: boolean; onToggle: () => void }) {
  const danger = card.step.risk === 'danger';
  const id = `assistant-step-${card.step.id}`;
  return (
    <div
      data-role="assistant-step"
      data-risk={card.step.risk}
      data-status={card.status}
      className={cn('flex items-start gap-3 rounded-md border p-3', danger ? 'border-danger' : 'border-line')}
    >
      <Checkbox id={id} checked={card.checked} disabled={disabled} onCheckedChange={onToggle} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={id} className={cn('text-sm', danger ? 'text-danger-strong' : 'text-ink')}>
          {danger && (
            <span className="mr-1 inline-flex items-center gap-0.5 font-medium">
              <AlertTriangle className="size-3.5" aria-hidden />
              {copy.danger}
            </span>
          )}
          {card.step.preview}
        </label>
        {card.status !== 'pending' && (
          <span
            className={cn('text-xs', card.status === 'failed' ? 'text-danger-strong' : 'text-muted')}
            data-role="assistant-step-status"
          >
            {copy.stepStatus(copy.status[card.status], card.message)}
          </span>
        )}
      </div>
    </div>
  );
}
