import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CalendarRange, Plus, Trash2, Wand2 } from 'lucide-react';
import {
  appendTimeSlot,
  DEFAULT_TIMETABLE_ID,
  deleteTimeSlot,
  durationBetween,
  effectiveTimetables,
  findTimetable,
  generatePeriods,
  isClockText,
  listTimeSlots,
  PERIOD_BREAK_MAX,
  PERIOD_BREAK_MIN,
  PERIOD_DURATION_MAX,
  PERIOD_DURATION_MIN,
  presetSpacing,
  reflowPeriods,
  replaceTimeSlots,
  sectionOf,
  updateTimeSlot,
  type PeriodSection,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';
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

const SECTION_LABEL = { am: '上午', pm: '下午', night: '晚上' } as const;
/** 每节时长与课间的可输入范围：与 core 的生成/顺延算法同一口径 */
const MIN_DURATION = PERIOD_DURATION_MIN;
const MAX_DURATION = PERIOD_DURATION_MAX;
const DEFAULT_DURATION = 45;
const MIN_BREAK = PERIOD_BREAK_MIN;
const MAX_BREAK = PERIOD_BREAK_MAX;
const DEFAULT_BREAK = 10;
/** 「本次启动期间不再询问」的勾选框文案 */
const SCOPE_OPT_OUT_LABEL = '本次启动期间不再询问';

/** 「本次启动期间不再询问」只放模块级变量，不写 localStorage、不落盘；重新挂载仍有效，重启后恢复询问。 */
let scopeOptOut = false;

export interface PeriodSettingsProps {
  storage: Storage;
  semesterId: string;
  onChanged: () => void;
}

/** 刚完成的单节改动，以及这次重排要用的时长。 */
interface RerollDraft {
  /** 被改动的那一节，用于文案定位，也是重排的锚点 */
  periodNo: number;
  /** 被改动的那一节所属时段 */
  section: PeriodSection;
  /** 改结束时间时推算出的每节时长；没改结束时间时沿用设置里的值 */
  durationMinutes: number;
  /** 时长是否由刚才手改的结束时间推算而来 */
  durationFromEdit: boolean;
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

function within(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** 重排参数越界时的说明，null 表示可以顺延重排。 */
function paramError(durationMinutes: number, breakMinutes: number): string | null {
  if (!within(durationMinutes, MIN_DURATION, MAX_DURATION)) {
    return `每节时长 ${MIN_DURATION}–${MAX_DURATION} 分钟，当前 ${durationMinutes} 分钟`;
  }
  if (!within(breakMinutes, MIN_BREAK, MAX_BREAK)) {
    return `课间 ${MIN_BREAK}–${MAX_BREAK} 分钟，当前 ${breakMinutes} 分钟`;
  }
  return null;
}

/** 输入框下方的字段级错误：只标越界的那一项，避免两条重复文案。 */
function durationFieldError(value: number): string | undefined {
  return within(value, MIN_DURATION, MAX_DURATION)
    ? undefined
    : `每节时长 ${MIN_DURATION}–${MAX_DURATION} 分钟`;
}

function breakFieldError(value: number): string | undefined {
  return within(value, MIN_BREAK, MAX_BREAK) ? undefined : `课间 ${MIN_BREAK}–${MAX_BREAK} 分钟`;
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
      ? '套用后整表按该作息重排'
      : `${selectedPreset.periods.length} 节${
          selectedPreset.source !== undefined && selectedPreset.source.length > 0
            ? ` · ${selectedPreset.source}`
            : ''
        }`;

  /** 可套用的作息：内置 + 启动时套用的缓存快照（含各校作息），按关键词过滤。 */
  const presetOptions = useMemo(() => {
    const all = effectiveTimetables();
    const keyword = presetQuery.trim().toLowerCase();
    if (keyword === '') return all;
    return all.filter(
      (preset) =>
        preset.name.toLowerCase().includes(keyword) ||
        preset.id.toLowerCase().includes(keyword) ||
        (preset.source ?? '').toLowerCase().includes(keyword),
    );
  }, [presetQuery]);

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
    toast.info('本次启动期间不再询问调整范围');
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
      label: '正在生成节次…',
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
        logInfo('timetable', '生成节次', { periods: periods.length, duration, breakMinutes });
        toast.success(`已生成 ${periods.length} 个节次`);
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
      label: '正在套用作息…',
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
        logInfo('timetable', '套用作息预设', {
          id: selectedPreset.id,
          periods: selectedPreset.periods.length,
          duration: spacing.durationMinutes,
          breakMinutes: spacing.breakMinutes,
        });
        toast.success(`已套用「${selectedPreset.name}」作息（${selectedPreset.periods.length} 节）`);
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
      label: '正在追加节次…',
      task: async () => {
        // 追加的一节接在最后一节之后：间隔用界面上的课间
        const created = await appendTimeSlot(storage, semesterId, duration, breakMinutes);
        logInfo('timetable', '追加节次', {
          periodNo: created['period_no'],
          startTime: created['start_time'],
          breakMinutes,
        });
        toast.success(`已添加第 ${created['period_no']} 节`);
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
      logInfo('timetable', '修改节次时间', { periodNo: slot.period_no, ...changes });
      await reload();
      onChanged();
      return true;
    } catch (cause: unknown) {
      setMessage(errorMessage(cause));
      return false;
    }
  }

  /** 这次时间改动对应的重排参数（同步算好，等失焦或回车时再问范围）。 */
  function timeDraft(slot: TimeSlotRow, changes: { startTime?: string; endTime?: string }): RerollDraft {
    const nextStart = changes.startTime ?? slot.start_time;
    const nextEnd = changes.endTime ?? slot.end_time;
    const editedDuration = changes.endTime === undefined ? null : durationBetween(nextStart, nextEnd);
    return {
      periodNo: slot.period_no,
      section: sectionOf(nextStart),
      durationMinutes: editedDuration ?? duration,
      durationFromEdit: editedDuration !== null,
    };
  }

  /** 时间输入框：立刻落库，失焦或回车时才弹「调整范围」。 */
  function editTime(slot: TimeSlotRow, changes: { startTime?: string; endTime?: string }): void {
    const field = changes.startTime !== undefined ? 'start' : 'end';
    const value = changes.startTime ?? changes.endTime ?? '';
    markPending(`time:${slot.id}:${field}=${value}`, timeDraft(slot, changes), saveTime(slot, changes));
  }

  /** 从改动的这一节起顺延重排；锚点之前的课次与各节原有的时段、备注原样保留。 */
  async function reflowFromAnchor(): Promise<void> {
    const current = draft;
    if (current === null) return;
    closeScope();
    setMessage(null);
    const result = await run({
      scope: 'timetable',
      label: '正在顺延重排…',
      task: async () => {
        const rows = await listTimeSlots(storage, semesterId);
        if (rows.length === 0) {
          setMessage('没有可重排的节次，请先生成节次');
          return;
        }
        const anchor = current.periodNo;
        if (!rows.some((row) => row.period_no === anchor)) {
          setMessage(`第 ${anchor} 节不存在，无法顺延重排`);
          return;
        }
        const planned = reflowPeriods(
          rows.map((row) => ({ periodNo: row.period_no, start: row.start_time, end: row.end_time })),
          { anchorPeriodNo: anchor, durationMinutes: duration, breakMinutes },
        );
        const times = new Map(planned.map((period) => [period.periodNo, period] as const));
        await replaceTimeSlots(
          storage,
          semesterId,
          rows.map((row) => {
            const next = times.get(row.period_no);
            const startTime = next?.start ?? row.start_time;
            return {
              periodNo: row.period_no,
              startTime,
              endTime: next?.end ?? row.end_time,
              section: row.section ?? sectionOf(startTime),
              label: row.label,
            };
          }),
        );
        logInfo('timetable', '按锚点顺延重排', {
          anchor,
          section: current.section,
          duration,
          breakMinutes,
        });
        toast.success(`第 ${anchor} 节起已顺延：每节 ${duration} 分钟、课间 ${breakMinutes} 分钟`);
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
      label: '正在删除节次…',
      task: async () => {
        const outcome = await deleteTimeSlot(storage, semesterId, periodNo);
        if (!outcome.deleted) {
          setMessage(
            outcome.usedBy > 0
              ? `第 ${periodNo} 节被 ${outcome.usedBy} 条排课占用，请先调整`
              : `第 ${periodNo} 节不存在`,
          );
          return;
        }
        logInfo('timetable', '删除节次', { periodNo });
        await reload();
        onChanged();
      },
    });
    if (!result.ok && result.error !== null) setMessage(result.error);
  }

  const draftError = draft === null ? null : paramError(duration, breakMinutes);

  return (
    <SectionCard title="作息" icon={CalendarRange}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="每节时长（分钟）" error={durationFieldError(duration)}>
          <Input
            type="number"
            min={MIN_DURATION}
            max={MAX_DURATION}
            aria-label="每节时长（分钟）"
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </Field>
        <Field label="课间（分钟）" error={breakFieldError(breakMinutes)}>
          <Input
            type="number"
            min={MIN_BREAK}
            max={MAX_BREAK}
            aria-label="课间（分钟）"
            value={breakMinutes}
            onChange={(event) => setBreakMinutes(Number(event.target.value))}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <Field label="作息预设" hint={presetHint}>
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
                  {preset.periods.length} 节
                  {preset.source !== undefined && preset.source.length > 0 ? ` · ${preset.source}` : ''}
                </span>
              </span>
            )}
            placeholder={selectedPreset?.name ?? '输入学校或作息名搜索'}
            ariaLabel="作息预设"
            emptyText="没有匹配的作息"
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
            套用此作息
          </Button>
          {appliedPreset !== null && (
            <span className="text-xs text-muted" data-role="preset-summary">
              预设：{appliedPreset.name}（{appliedPreset.count} 节）
              {appliedPreset.source !== null ? ` · ${appliedPreset.source}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted">
          <span>时段</span>
          <span>第一节开始</span>
          <span>节数</span>
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
              aria-label={`${block.label}节数`}
              onChange={(event) => block.setCount(Number(event.target.value))}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void generate()}>
          <Wand2 className="size-4" aria-hidden />
          自动生成节次
        </Button>
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void append()}>
          <Plus className="size-4" aria-hidden />
          追加一节
        </Button>
      </div>
      {message !== null && <InlineError>{message}</InlineError>}

      {slots.length === 0 ? (
        <EmptyState size="sm" tone="muted" title="还没有节次，请先生成节次" />
      ) : (
        <ul className="flex flex-col gap-1">
          {slots.map((slot) => (
            <li key={slot.id} className="flex min-h-tap items-center gap-2 text-sm">
              <span className="tabular w-16 shrink-0 text-ink">第 {slot.period_no} 节</span>
              <Input
                type="time"
                className="w-28"
                aria-label={`第 ${slot.period_no} 节开始时间`}
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
                aria-label={`第 ${slot.period_no} 节结束时间`}
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
                aria-label={`删除第 ${slot.period_no} 节`}
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
        每节起止时间可单独修改
        <HelpHint label="改节次时间">
          改完会问一次作用范围：只改这一节，或按每节时长与课间从这一节起顺延后面的节次。
        </HelpHint>
      </span>

      <FormDialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) closeScope();
        }}
        title="调整范围"
        description="这次改动要应用到哪些节次？"
        contentAttrs={{ 'data-role': 'scope-dialog' }}
        submitLabel="从这一节起顺延重排"
        cancelLabel="取消"
        submitting={busy}
        submitDisabled={draftError !== null}
        onSubmit={() => void reflowFromAnchor()}
        extra={
          <Button type="button" variant="ghost" size="sm" aria-label="只改这一节" onClick={() => closeScope()}>
            只改这一节
          </Button>
        }
      >
        <div className="flex flex-col gap-1 text-xs text-muted">
          <span>
            {draft === null
              ? ''
              : `第 ${draft.periodNo} 节已改；顺延按每节 ${duration} 分钟、课间 ${breakMinutes} 分钟`}
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
