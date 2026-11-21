import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CalendarRange, Plus, Trash2, Wand2 } from 'lucide-react';
import {
  appendTimeSlot,
  DEFAULT_TIMETABLE_ID,
  deleteTimeSlot,
  effectiveTimetables,
  findTimetable,
  generatePeriods,
  isClockText,
  listTimeSlots,
  presetSpacing,
  reflowPeriods,
  replaceTimeSlots,
  sectionOf,
  updateTimeSlot,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';
import {
  DEFAULT_BREAK,
  DEFAULT_DURATION,
  MAX_BREAK,
  MAX_DURATION,
  MIN_BREAK,
  MIN_DURATION,
  breakFieldError,
  durationFieldError,
  filterPresets,
  paramError,
  reflowedSlots,
  timeDraft,
  within,
  type RerollDraft,
} from './period-settings-model.ts';
import { Button } from './ui/button.tsx';
import { HelpHint } from './ui/help-hint.tsx';
import { SectionCard } from './ui/collapsible-card.tsx';
import { Combobox } from './ui/combobox.tsx';
import { FormDialog } from './ui/dialog.tsx';
import { EmptyState } from './ui/empty-state.tsx';
import { InlineError } from './ui/inline-error.tsx';
import { Field, Input } from './ui/input.tsx';
import { toast } from './ui/toaster.tsx';
import { useAction } from '../lib/action.ts';
import { errorMessage } from '../lib/errors.ts';
import { logInfo } from '../log.ts';
import { periodsCopy } from '../copy/timetable-periods.ts';

const SECTION_LABEL = periodsCopy.sections;
/** 「本次启动期间不再询问」的勾选框文案 */
const SCOPE_OPT_OUT_LABEL = periodsCopy.scopeOptOut;

/** 「本次启动期间不再询问」只放模块级变量，不写 localStorage、不落盘；重新挂载仍有效，重启后恢复询问。 */
let scopeOptOut = false;

export interface PeriodSettingsProps {
  storage: Storage;
  semesterId: string;
  onChanged: () => void;
}

/** 一次「已经落库、但还没问作用范围」的编辑：输入时只记下，失焦或回车才问一次。 */
interface PendingEdit {
  /** 字段 + 本次落库的值的签名：同一次编辑只问一次 */
  signature: string;
  /** 这次编辑对应的重排参数 */
  draft: RerollDraft;
  /** 落库是否成功；失败时不打扰用户 */
  commit: Promise<boolean>;
}

/** 套用过的作息预设，用于在界面上说明当前时间表来自哪套作息。 */
interface AppliedPreset {
  name: string;
  source: string | null;
  count: number;
}

export function PeriodSettings({ storage, semesterId, onChanged }: PeriodSettingsProps) {
  /** 顺延重排时使用的每节时长（分钟） */
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  /** 顺延重排时使用的课间（分钟） */
  const [breakMinutes, setBreakMinutes] = useState(DEFAULT_BREAK);
  /** 选中的内置作息 */
  const [presetId, setPresetId] = useState(DEFAULT_TIMETABLE_ID);
  /** 作息预设搜索框里的关键词；空串时下拉列出全部预设 */
  const [presetQuery, setPresetQuery] = useState('');
  /** 已经套用过的作息，用于在界面上说明时间表来自哪里 */
  const [appliedPreset, setAppliedPreset] = useState<AppliedPreset | null>(null);
  const [amStart, setAmStart] = useState('08:00');
  const [amCount, setAmCount] = useState(4);
  const [pmStart, setPmStart] = useState('14:00');
  const [pmCount, setPmCount] = useState(4);
  const [nightStart, setNightStart] = useState('19:00');
  const [nightCount, setNightCount] = useState(2);
  const [slots, setSlots] = useState<readonly TimeSlotRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const { busy, run } = useAction();
  /** 单节改动已生效，等待用户选择重排范围；null 表示没有待回答的询问 */
  const [draft, setDraft] = useState<RerollDraft | null>(null);
  /** 已落库、但还没问范围的编辑：输入过程中只记在这里，失焦或回车时才弹窗 */
  const pendingEdit = useRef<PendingEdit | null>(null);
  /** 已经问过范围的签名：同一次编辑（回车后又失焦）只弹一个对话框 */
  const askedEdit = useRef<string | null>(null);
  /** 勾选框的显示状态，真实来源是模块级的 scopeOptOut（重新挂载后仍然是勾上的） */
  const [optOutScope, setOptOutScope] = useState(scopeOptOut);

  const selectedPreset = findTimetable(presetId);
  const presetHint =
    selectedPreset === undefined
      ? periodsCopy.presetHintEmpty
      : `${periodsCopy.periodCount(selectedPreset.periods.length)}${
          selectedPreset.source !== undefined && selectedPreset.source.length > 0
            ? periodsCopy.sourceSuffix(selectedPreset.source)
            : ''
        }`;

  /** 可套用的作息：内置 + 启动时套用的缓存快照（含各校作息），按关键词过滤。 */
  const presetOptions = useMemo(() => filterPresets(effectiveTimetables(), presetQuery), [presetQuery]);

  const reload = useCallback(async () => {
    setSlots(await listTimeSlots(storage, semesterId));
  }, [storage, semesterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 单节改动已写库生效，接着询问范围；手改结束时间时把推算出的时长同步到界面，顺延按它算。 */
  function askScope(next: RerollDraft): void {
    if (next.durationFromEdit && within(next.durationMinutes, MIN_DURATION, MAX_DURATION)) {
      setDuration(next.durationMinutes);
    }
    setDraft(next);
  }

  /** 记下一次「已落库、但还没问范围」的编辑；输入时只调用它，弹窗留给失焦或回车。 */
  function markPending(signature: string, next: RerollDraft, commit: Promise<boolean>): void {
    pendingEdit.current = { signature, draft: next, commit };
  }

  /** 失焦或回车才询问范围：同一签名只问一次，落库失败保持沉默；已勾选「不再询问」时跳过。 */
  function flushPending(): void {
    const pending = pendingEdit.current;
    if (pending === null || askedEdit.current === pending.signature) return;
    // 这次编辑已经消费掉：无论问不问范围，之后都不会拿同一个签名再弹一次
    pendingEdit.current = null;
    askedEdit.current = pending.signature;
    if (scopeOptOut) {
      // 已经勾选「本次启动期间不再询问」：改动在输入时就已经落库，保持「只改这一节」
      return;
    }
    const { draft: next, commit } = pending;
    void commit.then((saved) => {
      if (saved) askScope(next);
    });
  }

  /** 勾选「本次启动期间不再询问」：只记在模块级变量里，并给一次性提示。 */
  function optOutScopeAsk(): void {
    scopeOptOut = true;
    setOptOutScope(true);
    toast.info(periodsCopy.scopeOptedOut);
  }

  /** 关掉「调整范围」对话框（只改这一节 / 取消 / Esc / ✕），之后新的编辑可以重新询问。 */
  function closeScope(): void {
    pendingEdit.current = null;
    askedEdit.current = null;
    setDraft(null);
  }

  /** 时间输入框共用：失焦或回车才把挂起的改动拿去问范围，onChange 只负责落库。 */
  const scopeTriggers = {
    onBlur: () => {
      flushPending();
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      flushPending();
    },
  };

  async function generate(): Promise<void> {
    setMessage(null);
    const result = await run({
      scope: 'timetable',
      label: periodsCopy.generating,
      task: async () => {
        const periods = generatePeriods({
          durationMinutes: duration,
          breakMinutes,
          blocks: [
            { section: 'am', startTime: amStart, count: amCount },
            { section: 'pm', startTime: pmStart, count: pmCount },
            { section: 'night', startTime: nightStart, count: nightCount },
          ],
        });
        await replaceTimeSlots(storage, semesterId, periods);
        logInfo('timetable', '节次已生成', { periods: periods.length, duration, breakMinutes });
        toast.success(periodsCopy.generated(periods.length));
        await reload();
        onChanged();
      },
    });
    if (!result.ok && result.error !== null) setMessage(result.error);
  }

  /** 套用选中的内置作息：照抄预设的节次时间，并把时长与课间同步成预设里最常见的节距。 */
  async function applyPreset(): Promise<void> {
    if (selectedPreset === undefined) return;
    setMessage(null);
    const result = await run({
      scope: 'timetable',
      label: periodsCopy.applyingPreset,
      task: async () => {
        await replaceTimeSlots(
          storage,
          semesterId,
          selectedPreset.periods.map((period) => ({
            periodNo: period.periodNo,
            startTime: period.start,
            endTime: period.end,
            // 时段按开始时间推断：<12:00 上午、<18:00 下午、其余晚上
            section: sectionOf(period.start),
            label: null,
          })),
        );
        const spacing = presetSpacing(selectedPreset.periods);
        if (spacing.durationMinutes !== null) setDuration(spacing.durationMinutes);
        if (spacing.breakMinutes !== null) setBreakMinutes(spacing.breakMinutes);
        setAppliedPreset({
          name: selectedPreset.name,
          source: selectedPreset.source ?? null,
          count: selectedPreset.periods.length,
        });
        logInfo('timetable', '作息预设已套用', {
          id: selectedPreset.id,
          periods: selectedPreset.periods.length,
          duration: spacing.durationMinutes,
          breakMinutes: spacing.breakMinutes,
        });
        toast.success(periodsCopy.presetApplied(selectedPreset.name, selectedPreset.periods.length));
        await reload();
        onChanged();
      },
    });
    if (!result.ok && result.error !== null) setMessage(result.error);
  }

  async function append(): Promise<void> {
    setMessage(null);
    const result = await run({
      scope: 'timetable',
      label: periodsCopy.appending,
      task: async () => {
        // 追加的一节接在最后一节之后：间隔用界面上的课间
        const created = await appendTimeSlot(storage, semesterId, duration, breakMinutes);
        logInfo('timetable', '节次已追加', {
          periodNo: created['period_no'],
          startTime: created['start_time'],
          breakMinutes,
        });
        toast.success(periodsCopy.appended(String(created['period_no'])));
        await reload();
        onChanged();
      },
    });
    if (!result.ok && result.error !== null) setMessage(result.error);
  }

  /** 单节改起止时间先只改这一节并立即生效；改了结束时间的推算时长即重排用的新时长。 */
  async function saveTime(slot: TimeSlotRow, changes: { startTime?: string; endTime?: string }): Promise<boolean> {
    setMessage(null);
    try {
      await updateTimeSlot(storage, slot.id, changes);
      logInfo('timetable', '节次时间已修改', { periodNo: slot.period_no, ...changes });
      await reload();
      onChanged();
      return true;
    } catch (cause: unknown) {
      setMessage(errorMessage(cause));
      return false;
    }
  }

  /** 时间输入框：立刻落库，失焦或回车时才弹「调整范围」。 */
  function editTime(slot: TimeSlotRow, changes: { startTime?: string; endTime?: string }): void {
    const field = changes.startTime !== undefined ? 'start' : 'end';
    const value = changes.startTime ?? changes.endTime ?? '';
    markPending(`time:${slot.id}:${field}=${value}`, timeDraft(slot, changes, duration), saveTime(slot, changes));
  }

  /** 从改动的这一节起顺延重排；锚点之前的课次与各节原有的时段、备注原样保留。 */
  async function reflowFromAnchor(): Promise<void> {
    const current = draft;
    if (current === null) return;
    closeScope();
    setMessage(null);
    const result = await run({
      scope: 'timetable',
      label: periodsCopy.reflowing,
      task: async () => {
        const rows = await listTimeSlots(storage, semesterId);
        if (rows.length === 0) {
          setMessage(periodsCopy.reflowNoSlots);
          return;
        }
        const anchor = current.periodNo;
        if (!rows.some((row) => row.period_no === anchor)) {
          setMessage(periodsCopy.reflowAnchorMissing(anchor));
          return;
        }
        const planned = reflowPeriods(
          rows.map((row) => ({ periodNo: row.period_no, start: row.start_time, end: row.end_time })),
          { anchorPeriodNo: anchor, durationMinutes: duration, breakMinutes },
        );
        await replaceTimeSlots(storage, semesterId, reflowedSlots(rows, planned));
        logInfo('timetable', '节次已按锚点顺延', {
          anchor,
          section: current.section,
          duration,
          breakMinutes,
        });
        toast.success(periodsCopy.reflowed(anchor, duration, breakMinutes));
        await reload();
        onChanged();
      },
    });
    if (!result.ok && result.error !== null) setMessage(result.error);
  }

  async function remove(periodNo: number): Promise<void> {
    setMessage(null);
    const result = await run({
      scope: 'timetable',
      label: periodsCopy.removing,
      task: async () => {
        const outcome = await deleteTimeSlot(storage, semesterId, periodNo);
        if (!outcome.deleted) {
          setMessage(
            outcome.usedBy > 0
              ? periodsCopy.periodInUse(periodNo, outcome.usedBy)
              : periodsCopy.periodMissing(periodNo),
          );
          return;
        }
        logInfo('timetable', '节次已删除', { periodNo });
        await reload();
        onChanged();
      },
    });
    if (!result.ok && result.error !== null) setMessage(result.error);
  }

  const draftError = draft === null ? null : paramError(duration, breakMinutes);

  return (
    <SectionCard title={periodsCopy.title} icon={CalendarRange}>
      <div className="grid grid-cols-2 gap-2">
        <Field label={periodsCopy.durationLabel} error={durationFieldError(duration)}>
          <Input
            type="number"
            min={MIN_DURATION}
            max={MAX_DURATION}
            aria-label={periodsCopy.durationLabel}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </Field>
        <Field label={periodsCopy.breakLabel} error={breakFieldError(breakMinutes)}>
          <Input
            type="number"
            min={MIN_BREAK}
            max={MAX_BREAK}
            aria-label={periodsCopy.breakLabel}
            value={breakMinutes}
            onChange={(event) => setBreakMinutes(Number(event.target.value))}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <Field label={periodsCopy.presetLabel} hint={presetHint}>
          <Combobox
            items={presetOptions}
            keyOf={(preset) => preset.id}
            value={presetQuery}
            onValueChange={setPresetQuery}
            onSelect={(preset) => {
              setPresetId(preset.id);
              setPresetQuery(preset.name);
            }}
            renderItem={(preset) => (
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{preset.name}</span>
                <span className="truncate text-xs text-muted">
                  {periodsCopy.periodCount(preset.periods.length)}
                  {preset.source !== undefined && preset.source.length > 0 ? periodsCopy.sourceSuffix(preset.source) : ''}
                </span>
              </span>
            )}
            placeholder={selectedPreset?.name ?? periodsCopy.presetPlaceholder}
            ariaLabel={periodsCopy.presetLabel}
            emptyText={periodsCopy.presetEmpty}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            disabled={selectedPreset === undefined}
            onClick={() => void applyPreset()}
          >
            {periodsCopy.applyPreset}
          </Button>
          {appliedPreset !== null && (
            <span className="text-xs text-muted" data-role="preset-summary">
              {periodsCopy.appliedPreset(appliedPreset.name, appliedPreset.count)}
              {appliedPreset.source !== null ? periodsCopy.sourceSuffix(appliedPreset.source) : ''}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted">
          <span>{periodsCopy.blockHeader}</span>
          <span>{periodsCopy.blockStartHeader}</span>
          <span>{periodsCopy.blockCountHeader}</span>
        </div>
        {[
          { label: SECTION_LABEL.am, start: amStart, setStart: setAmStart, count: amCount, setCount: setAmCount },
          { label: SECTION_LABEL.pm, start: pmStart, setStart: setPmStart, count: pmCount, setCount: setPmCount },
          {
            label: SECTION_LABEL.night,
            start: nightStart,
            setStart: setNightStart,
            count: nightCount,
            setCount: setNightCount,
          },
        ].map((block) => (
          <div key={block.label} className="grid grid-cols-3 items-center gap-2">
            <span className="text-sm text-ink">{block.label}</span>
            <Input type="time" value={block.start} onChange={(event) => block.setStart(event.target.value)} />
            <Input
              type="number"
              min={0}
              max={20}
              value={block.count}
              aria-label={periodsCopy.blockCountAria(block.label)}
              onChange={(event) => block.setCount(Number(event.target.value))}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void generate()}>
          <Wand2 className="size-4" aria-hidden />
          {periodsCopy.generate}
        </Button>
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void append()}>
          <Plus className="size-4" aria-hidden />
          {periodsCopy.append}
        </Button>
      </div>
      {message !== null && <InlineError>{message}</InlineError>}

      {slots.length === 0 ? (
        <EmptyState size="sm" tone="muted" title={periodsCopy.empty} />
      ) : (
        <ul className="flex flex-col gap-1">
          {slots.map((slot) => (
            <li key={slot.id} className="flex min-h-tap items-center gap-2 text-sm">
              <span className="tabular w-16 shrink-0 text-ink">{periodsCopy.period(slot.period_no)}</span>
              <Input
                type="time"
                className="w-28"
                aria-label={periodsCopy.startAria(slot.period_no)}
                value={slot.start_time}
                onChange={(event) => {
                  if (!isClockText(event.target.value)) return;
                  editTime(slot, { startTime: event.target.value });
                }}
                {...scopeTriggers}
              />
              <span className="text-muted">–</span>
              <Input
                type="time"
                className="w-28"
                aria-label={periodsCopy.endAria(slot.period_no)}
                value={slot.end_time}
                onChange={(event) => {
                  if (!isClockText(event.target.value)) return;
                  editTime(slot, { endTime: event.target.value });
                }}
                {...scopeTriggers}
              />
              <span className="ml-auto text-xs text-muted">{SECTION_LABEL[slot.section ?? 'am']}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={periodsCopy.removeAria(slot.period_no)}
                disabled={busy}
                onClick={() => void remove(slot.period_no)}
              >
                <Trash2 className="size-4 text-danger-strong" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <span className="flex items-center gap-1 text-xs text-muted">
        {periodsCopy.editHint}
        <HelpHint label={periodsCopy.editHelpLabel}>{periodsCopy.editHelp}</HelpHint>
      </span>

      <FormDialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) closeScope();
        }}
        title={periodsCopy.scopeTitle}
        description={periodsCopy.scopeDescription}
        contentAttrs={{ 'data-role': 'scope-dialog' }}
        submitLabel={periodsCopy.scopeSubmit}
        cancelLabel={periodsCopy.scopeCancel}
        submitting={busy}
        submitDisabled={draftError !== null}
        onSubmit={() => void reflowFromAnchor()}
        extra={
          <Button type="button" variant="ghost" size="sm" aria-label={periodsCopy.scopeOnlyThis} onClick={() => closeScope()}>
            {periodsCopy.scopeOnlyThis}
          </Button>
        }
      >
        <div className="flex flex-col gap-1 text-xs text-muted">
          <span>
            {draft === null
              ? ''
              : periodsCopy.scopeSummary(draft.periodNo, duration, breakMinutes)}
          </span>
          {draftError !== null && <InlineError>{draftError}</InlineError>}
        </div>
        <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="size-4"
            aria-label={SCOPE_OPT_OUT_LABEL}
            checked={optOutScope}
            onChange={() => optOutScopeAsk()}
          />
          {SCOPE_OPT_OUT_LABEL}
        </label>
      </FormDialog>
    </SectionCard>
  );
}
