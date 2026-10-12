import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CalendarRange, Plus, Trash2, Wand2 } from 'lucide-react';
import {
  appendTimeSlot,
  deleteTimeSlot,
  generatePeriods,
  listTimeSlots,
  regenerateSections,
  replaceTimeSlots,
  sectionOf,
  updateTimeSlot,
  type GeneratedPeriod,
  type PeriodSection,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { Button } from './ui/button.tsx';
import { CollapsibleCard } from './ui/collapsible-card.tsx';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog.tsx';
import { Field, Input } from './ui/input.tsx';
import { toast } from './ui/toaster.tsx';
import { logInfo } from '../log.ts';

const SECTION_LABEL = { am: '上午', pm: '下午', night: '晚上' } as const;
const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})$/;
const MIN_DURATION = 10;
const MAX_DURATION = 240;
/**
 * 内部默认间隔（分钟）：不再对用户暴露。
 * 「自动生成课次」固定用它；按现有课次推算间隔时（重排、追加）算不出来才回退到它。
 */
const DEFAULT_INTERVAL_MINUTES = 10;
/** 推算出的间隔可用的上限（与 core 接受的范围一致）；超出的值不可用，同样回退到默认间隔。 */
const MAX_INTERVAL_MINUTES = 120;

export interface PeriodSettingsProps {
  storage: Storage;
  semesterId: string;
  onChanged: () => void;
}

/** 刚完成的单节改动，以及这次重排要用的时长。 */
interface RerollDraft {
  /** 被改动的那一节，用于文案定位 */
  periodNo: number;
  /** 被改动的那一节所属时段 */
  section: PeriodSection;
  /** 重排使用的每节时长（分钟） */
  durationMinutes: number;
  /** 时长是否由刚才手改的结束时间推算而来 */
  durationFromEdit: boolean;
}

/**
 * 一次「已经落库、但还没询问作用范围」的编辑。
 * 输入过程中只把它记下来（不弹窗），等到失焦或回车时才拿它去问一次。
 */
interface PendingEdit {
  /** 字段 + 本次落库的值的签名：同一次编辑只问一次 */
  signature: string;
  /** 这次编辑对应的重排参数 */
  draft: RerollDraft;
  /** 落库是否成功；失败时不打扰用户 */
  commit: Promise<boolean>;
}

/** 把 HH:MM 解析成当天的分钟数；不是完整时刻时返回 null。 */
function clockMinutes(value: string): number | null {
  const match = CLOCK_PATTERN.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 输入框里的 HH:MM 是否已经是完整时刻（过滤掉输入过程中的半成品）。 */
function isClockText(value: string): boolean {
  return clockMinutes(value) !== null;
}

/** 由起止时间推算单节时长；无法推算或不为正时返回 null。 */
function durationBetween(startTime: string, endTime: string): number | null {
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime);
  if (start === null || end === null) return null;
  const minutes = end - start;
  return minutes > 0 ? minutes : null;
}

/**
 * 从某个时段的现有课次推算节与节之间的间隔（间隔不再由用户设置）：
 * 取该时段第一节与第二节开始时间之差，减去这次要用的每节时长，
 * 这样重排后各节的开始时间与原来保持一致。
 * 不足两节、时刻不完整或算出的值无法使用时，回退到内部默认间隔。
 */
function sectionInterval(
  periods: readonly { startTime: string; section: PeriodSection }[],
  section: PeriodSection,
  durationMinutes: number,
): number {
  const starts = periods
    .filter((period) => period.section === section)
    .map((period) => clockMinutes(period.startTime))
    .filter((minutes): minutes is number => minutes !== null)
    .sort((left, right) => left - right);
  const first = starts[0];
  const second = starts[1];
  if (first === undefined || second === undefined) return DEFAULT_INTERVAL_MINUTES;
  const interval = second - first - Math.round(durationMinutes);
  if (!Number.isFinite(interval)) return DEFAULT_INTERVAL_MINUTES;
  if (interval < 0 || interval > MAX_INTERVAL_MINUTES) return DEFAULT_INTERVAL_MINUTES;
  return interval;
}

function within(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** 重排参数越界时的说明，null 表示可以重排。 */
function paramError(draft: RerollDraft): string | null {
  if (!within(draft.durationMinutes, MIN_DURATION, MAX_DURATION)) {
    return `每节时长需在 ${MIN_DURATION}–${MAX_DURATION} 分钟之间，当前是 ${draft.durationMinutes} 分钟`;
  }
  return null;
}

export function PeriodSettings({ storage, semesterId, onChanged }: PeriodSettingsProps) {
  const [duration, setDuration] = useState(45);
  const [amStart, setAmStart] = useState('08:00');
  const [amCount, setAmCount] = useState(4);
  const [pmStart, setPmStart] = useState('14:00');
  const [pmCount, setPmCount] = useState(4);
  const [nightStart, setNightStart] = useState('19:00');
  const [nightCount, setNightCount] = useState(2);
  const [slots, setSlots] = useState<readonly TimeSlotRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 单节改动已生效，等待用户选择重排范围；null 表示没有待回答的询问 */
  const [draft, setDraft] = useState<RerollDraft | null>(null);
  /** 已落库、但还没问范围的编辑：输入过程中只记在这里，失焦或回车时才弹窗 */
  const pendingEdit = useRef<PendingEdit | null>(null);
  /** 已经问过范围的签名：同一次编辑（回车后又失焦）只弹一个对话框 */
  const askedEdit = useRef<string | null>(null);

  const reload = useCallback(async () => {
    setSlots(await listTimeSlots(storage, semesterId));
  }, [storage, semesterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 单节改动已经写库生效，接着询问这次改动的范围。
   * 重排参数以「刚刚手改的那个值」为准，并把界面上的时长同步成同一个值。
   */
  function askScope(next: RerollDraft): void {
    if (next.durationFromEdit && within(next.durationMinutes, MIN_DURATION, MAX_DURATION)) {
      setDuration(next.durationMinutes);
    }
    setDraft(next);
  }

  /**
   * 记下一次「已经落库、但还没问范围」的编辑。
   * 输入过程中只调用它（所以打字时不会弹窗），弹窗留给失焦或回车。
   */
  function markPending(signature: string, next: RerollDraft, commit: Promise<boolean>): void {
    pendingEdit.current = { signature, draft: next, commit };
  }

  /**
   * 失焦或回车时才真正询问范围。
   * 同一个签名只问一次，所以「回车之后紧接着失焦」也只会弹一个对话框；
   * 落库失败（commit 为 false）时保持沉默，与改动前的行为一致。
   */
  function flushPending(): void {
    const pending = pendingEdit.current;
    if (pending === null || askedEdit.current === pending.signature) return;
    pendingEdit.current = null;
    askedEdit.current = pending.signature;
    const { draft: next, commit } = pending;
    void commit.then((saved) => {
      if (saved) askScope(next);
    });
  }

  /** 关掉「调整范围」对话框（只改这一节 / 取消 / Esc / ✕），之后新的编辑可以重新询问。 */
  function closeScope(): void {
    pendingEdit.current = null;
    askedEdit.current = null;
    setDraft(null);
  }

  /**
   * 时间输入框共用的触发：失焦或回车时才把挂起的改动拿去问范围。
   * 输入框里的 onChange 只负责落库，所以连输多位数时不会中途弹窗抢焦点。
   */
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
    setBusy(true);
    setMessage(null);
    try {
      const periods = generatePeriods({
        durationMinutes: duration,
        // 内部默认间隔：不再对用户暴露
        breakMinutes: DEFAULT_INTERVAL_MINUTES,
        blocks: [
          { section: 'am', startTime: amStart, count: amCount },
          { section: 'pm', startTime: pmStart, count: pmCount },
          { section: 'night', startTime: nightStart, count: nightCount },
        ],
      });
      await replaceTimeSlots(storage, semesterId, periods);
      logInfo('timetable', '生成课次', { periods: periods.length, duration });
      toast.success(`已生成 ${periods.length} 节课次`);
      await reload();
      onChanged();
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function append(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      // 追加时同样按最后一节所在时段的真实间隔接上（推算不出时用内部默认间隔）
      const rows = slots.map((row) => ({
        startTime: row.start_time,
        section: row.section ?? sectionOf(row.start_time),
      }));
      const section = rows.at(-1)?.section ?? 'am';
      const interval = sectionInterval(rows, section, duration);
      const created = await appendTimeSlot(storage, semesterId, duration, interval);
      logInfo('timetable', '追加课次', {
        periodNo: created['period_no'],
        startTime: created['start_time'],
        interval,
      });
      toast.success(`已添加第 ${created['period_no']} 节`);
      await reload();
      onChanged();
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 单节课次改起止时间：先只改这一节并立即生效（不弹窗）。
   * 改了结束时间（或起止一起改）时，把推算出的时长当作重排用的新时长。
   */
  async function saveTime(slot: TimeSlotRow, changes: { startTime?: string; endTime?: string }): Promise<boolean> {
    setMessage(null);
    try {
      await updateTimeSlot(storage, slot.id, changes);
      logInfo('timetable', '修改课次时间', { periodNo: slot.period_no, ...changes });
      await reload();
      onChanged();
      return true;
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
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

  /**
   * 按选定的范围重排：时段起点与节数取现有课次（各时段第一节的开始时间与节数），
   * 时长取这次改动带来的新值；节与节之间的间隔由该时段现有课次的开始时间推算，
   * 范围外的时段原样保留。
   */
  async function reroll(scope: 'section' | 'all'): Promise<void> {
    const current = draft;
    if (current === null) return;
    closeScope();
    setBusy(true);
    setMessage(null);
    try {
      const rows = await listTimeSlots(storage, semesterId);
      const existing: GeneratedPeriod[] = rows.map((row) => ({
        periodNo: row.period_no,
        startTime: row.start_time,
        endTime: row.end_time,
        section: row.section ?? sectionOf(row.start_time),
      }));
      const targets: PeriodSection[] = [
        ...new Set(scope === 'all' ? existing.map((period) => period.section) : [current.section]),
      ];
      if (!existing.some((period) => targets.includes(period.section))) {
        setMessage('还没有可重排的课次，请先点「自动生成课次」');
        return;
      }
      // 每个时段各用自己的真实间隔重排一次，互不影响
      let planned = existing;
      const intervals = new Map<PeriodSection, number>();
      for (const target of targets) {
        const minutes = sectionInterval(existing, target, current.durationMinutes);
        intervals.set(target, minutes);
        planned = regenerateSections(planned, [target], {
          durationMinutes: current.durationMinutes,
          breakMinutes: minutes,
        });
      }
      const labels = new Map(rows.map((row) => [row.period_no, row.label] as const));
      await replaceTimeSlots(
        storage,
        semesterId,
        planned.map((period) => ({
          periodNo: period.periodNo,
          startTime: period.startTime,
          endTime: period.endTime,
          section: period.section,
          label: labels.get(period.periodNo) ?? null,
        })),
      );
      logInfo('timetable', '按范围重排课次', {
        scope,
        section: current.section,
        duration: current.durationMinutes,
        intervals: [...intervals.entries()].map(([key, value]) => `${key}:${value}`).join(','),
      });
      const where = scope === 'all' ? '全部时段' : `本时段（${SECTION_LABEL[current.section]}）`;
      toast.success(`已按新的每节时长重排${where}`);
      await reload();
      onChanged();
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(periodNo: number): Promise<void> {    setBusy(true);
    setMessage(null);
    try {
      const result = await deleteTimeSlot(storage, semesterId, periodNo);
      if (!result.deleted) {
        setMessage(
          result.usedBy > 0
            ? `第 ${periodNo} 节被 ${result.usedBy} 条排课使用，请先调整这些课程的节次`
            : `第 ${periodNo} 节不存在`,
        );
        return;
      }
      logInfo('timetable', '删除课次', { periodNo });
      await reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const draftError = draft === null ? null : paramError(draft);

  return (
    <CollapsibleCard id="timetable" title="时间表" icon={CalendarRange}>
      <div className="grid gap-2">
        <Field label="固定上课时长（分钟）">
          <Input
            type="number"
            min={10}
            max={240}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </Field>
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
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void generate()}>
          <Wand2 className="size-4" aria-hidden />
          自动生成课次
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void append()}>
          <Plus className="size-4" aria-hidden />
          追加一节
        </Button>
      </div>
      {message !== null && <span className="text-xs text-danger-strong">{message}</span>}

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
        {slots.length === 0 && <li className="text-xs text-muted">还没有课次，先点「自动生成课次」</li>}
      </ul>
      <span className="text-xs text-muted">
        每节起止时间可单独修改。改完会问一次作用范围，可只保留这一节，也可按新的每节时长重排本时段或全部时段。
      </span>

      {draft !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeScope();
          }}
        >
          <DialogContent
            title="调整范围"
            description="这次改动要应用到哪些课次？"
            data-role="scope-dialog"
          >
            <div className="flex flex-col gap-1 text-xs text-muted">
              <span>
                第 {draft.periodNo} 节（{SECTION_LABEL[draft.section]}）的改动已生效；重排会用每节{' '}
                {draft.durationMinutes} 分钟
                {draft.durationFromEdit ? '（来自你刚才的修改）' : '（来自上方设置）'}。
              </span>
              {draftError !== null && <span className="text-danger-strong">{draftError}</span>}
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" aria-label="只改这一节" onClick={() => closeScope()}>
                只改这一节
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`本时段重排（${SECTION_LABEL[draft.section]}）`}
                disabled={busy || draftError !== null}
                onClick={() => void reroll('section')}
              >
                本时段重排（{SECTION_LABEL[draft.section]}）
              </Button>
              <Button
                variant="primary"
                size="sm"
                aria-label="全部时段重排"
                disabled={busy || draftError !== null}
                onClick={() => void reroll('all')}
              >
                全部时段重排
              </Button>
              <Button variant="ghost" size="sm" aria-label="取消" onClick={() => closeScope()}>
                取消
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </CollapsibleCard>
  );
}
