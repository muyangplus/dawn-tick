import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, Plus, Trash2, Wand2 } from 'lucide-react';
import {
  appendTimeSlot,
  deleteTimeSlot,
  generatePeriods,
  listTimeSlots,
  parseClock,
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
const MAX_GAP = 120;

export interface PeriodSettingsProps {
  storage: Storage;
  semesterId: string;
  onChanged: () => void;
}

/** 刚完成的单节改动，以及这次重排要用的时长与课间。 */
interface RerollDraft {
  /** 被改动的那一节，用于文案定位 */
  periodNo: number;
  /** 被改动的那一节所属时段 */
  section: PeriodSection;
  /** 重排使用的每节时长（分钟） */
  durationMinutes: number;
  /** 重排使用的课间（分钟） */
  breakMinutes: number;
  /** 时长是否由刚才手改的结束时间推算而来 */
  durationFromEdit: boolean;
  /** 课间是否由刚才手改的课间输入而来 */
  breakFromEdit: boolean;
}

/** 把 HH:MM 往后推 minutes 分钟，返回 HH:MM。 */
function addMinutesText(time: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (match === null) return time;
  const total = Number(match[1]) * 60 + Number(match[2]) + Math.max(0, Math.round(minutes));
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${hours < 10 ? '0' : ''}${hours}:${mins < 10 ? '0' : ''}${mins}`;
}

/** 两节课之间的课间分钟数（前节结束到后节开始）。 */
function gapMinutes(endTime: string, nextStart: string): number {
  const parse = (value: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
  };
  const end = parse(endTime);
  const start = parse(nextStart);
  if (end === null || start === null) return 0;
  return Math.max(0, start - end);
}

/** 输入框里的 HH:MM 是否已经是完整时刻（过滤掉输入过程中的半成品）。 */
function isClockText(value: string): boolean {
  const match = CLOCK_PATTERN.exec(value.trim());
  return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

/** 由起止时间推算单节时长；无法推算或不为正时返回 null。 */
function durationBetween(startTime: string, endTime: string): number | null {
  if (!isClockText(startTime) || !isClockText(endTime)) return null;
  const minutes = parseClock(endTime) - parseClock(startTime);
  return minutes > 0 ? minutes : null;
}

function within(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** 重排参数越界时的说明，null 表示可以重排。 */
function paramError(draft: RerollDraft): string | null {
  if (!within(draft.durationMinutes, MIN_DURATION, MAX_DURATION)) {
    return `每节时长需在 ${MIN_DURATION}–${MAX_DURATION} 分钟之间，当前是 ${draft.durationMinutes} 分钟`;
  }
  if (!within(draft.breakMinutes, 0, MAX_GAP)) {
    return `课间需在 0–${MAX_GAP} 分钟之间，当前是 ${draft.breakMinutes} 分钟`;
  }
  return null;
}

export function PeriodSettings({ storage, semesterId, onChanged }: PeriodSettingsProps) {
  const [duration, setDuration] = useState(45);
  const [gap, setGap] = useState(10);
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

  const reload = useCallback(async () => {
    setSlots(await listTimeSlots(storage, semesterId));
  }, [storage, semesterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 单节改动已经写库生效，接着询问这次改动的范围。
   * 重排参数以「刚刚手改的那个值」为准，并把界面上的时长/课间同步成同一个值。
   */
  function askScope(next: RerollDraft): void {
    if (next.durationFromEdit && within(next.durationMinutes, MIN_DURATION, MAX_DURATION)) {
      setDuration(next.durationMinutes);
    }
    if (next.breakFromEdit && within(next.breakMinutes, 0, MAX_GAP)) {
      setGap(next.breakMinutes);
    }
    setDraft(next);
  }

  async function generate(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const periods = generatePeriods({
        durationMinutes: duration,
        breakMinutes: gap,
        blocks: [
          { section: 'am', startTime: amStart, count: amCount },
          { section: 'pm', startTime: pmStart, count: pmCount },
          { section: 'night', startTime: nightStart, count: nightCount },
        ],
      });
      await replaceTimeSlots(storage, semesterId, periods);
      logInfo('timetable', '生成课次', { periods: periods.length, duration, gap });
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
      const created = await appendTimeSlot(storage, semesterId, duration, gap);
      logInfo('timetable', '追加课次', { periodNo: created['period_no'], startTime: created['start_time'] });
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
   * 单节课次改起止时间：先只改这一节并立即生效，再询问重排范围。
   * 改了结束时间（或起止一起改）时，把推算出的时长当作重排用的新时长。
   */
  async function saveTime(slot: TimeSlotRow, changes: { startTime?: string; endTime?: string }): Promise<void> {
    setMessage(null);
    const nextStart = changes.startTime ?? slot.start_time;
    const nextEnd = changes.endTime ?? slot.end_time;
    const editedDuration = changes.endTime === undefined ? null : durationBetween(nextStart, nextEnd);
    try {
      await updateTimeSlot(storage, slot.id, changes);
      logInfo('timetable', '修改课次时间', { periodNo: slot.period_no, ...changes });
      await reload();
      onChanged();
      askScope({
        periodNo: slot.period_no,
        section: sectionOf(nextStart),
        durationMinutes: editedDuration ?? duration,
        breakMinutes: gap,
        durationFromEdit: editedDuration !== null,
        breakFromEdit: false,
      });
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /**
   * 改某节课后的课间：只挪后一节的开始时间并立即生效，再询问重排范围。
   * 刚输入的课间分钟数就是这次重排要用的课间，作用时段取开始时间被改的那一节。
   */
  async function saveGap(slot: TimeSlotRow, nextSlot: TimeSlotRow, minutes: number): Promise<void> {
    if (!within(minutes, 0, MAX_GAP)) return;
    const startTime = addMinutesText(slot.end_time, minutes);
    setMessage(null);
    try {
      await updateTimeSlot(storage, nextSlot.id, { startTime });
      logInfo('timetable', '修改课间', { afterPeriodNo: slot.period_no, minutes });
      await reload();
      onChanged();
      askScope({
        periodNo: nextSlot.period_no,
        section: sectionOf(startTime),
        durationMinutes: duration,
        breakMinutes: Math.round(minutes),
        durationFromEdit: false,
        breakFromEdit: true,
      });
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /**
   * 按选定的范围重排：时段起点与节数取现有课次（各时段第一节的开始时间与节数），
   * 时长与课间取这次改动带来的新值；范围外的时段原样保留。
   */
  async function reroll(scope: 'section' | 'all'): Promise<void> {
    const current = draft;
    if (current === null) return;
    setDraft(null);
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
      const planned = regenerateSections(existing, targets, {
        durationMinutes: current.durationMinutes,
        breakMinutes: current.breakMinutes,
      });
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
        gap: current.breakMinutes,
      });
      const reason = current.breakFromEdit ? '课间' : '每节时长';
      const where = scope === 'all' ? '全部时段' : `本时段（${SECTION_LABEL[current.section]}）`;
      toast.success(`已按新的${reason}重排${where}`);
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
      <div className="grid gap-2 tablet:grid-cols-2">
        <Field label="固定上课时长（分钟）">
          <Input
            type="number"
            min={10}
            max={240}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </Field>
        <Field label="课间间隔（分钟）">
          <Input
            type="number"
            min={0}
            max={120}
            value={gap}
            onChange={(event) => setGap(Number(event.target.value))}
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
                void saveTime(slot, { startTime: event.target.value });
              }}
            />
            <span className="text-muted">–</span>
            <Input
              type="time"
              className="w-28"
              aria-label={`第 ${slot.period_no} 节结束时间`}
              value={slot.end_time}
              onChange={(event) => {
                if (!isClockText(event.target.value)) return;
                void saveTime(slot, { endTime: event.target.value });
              }}
            />
            {(() => {
              const nextSlot = slots.find((item) => item.period_no === slot.period_no + 1);
              if (nextSlot === undefined) return null;
              return (
                <span className="flex items-center gap-1">
                  <span className="text-xs text-muted">课间</span>
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    className="w-16"
                    aria-label={`第 ${slot.period_no} 节后课间分钟`}
                    value={gapMinutes(slot.end_time, nextSlot.start_time)}
                    onChange={(event) => {
                      const minutes = Number(event.target.value);
                      if (Number.isNaN(minutes)) return;
                      void saveGap(slot, nextSlot, minutes);
                    }}
                  />
                  <span className="text-xs text-muted">分</span>
                </span>
              );
            })()}
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
        每节起止时间可单独修改；「课间」只影响后一节的开始时间。改完会问一次作用范围，可只保留这一节，也可按新的时长与课间重排本时段或全部时段。
      </span>

      {draft !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDraft(null);
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
                {draft.durationMinutes} 分钟、课间 {draft.breakMinutes} 分钟
                {draft.durationFromEdit || draft.breakFromEdit ? '（来自你刚才的修改）' : '（来自上方设置）'}。
              </span>
              {draftError !== null && <span className="text-danger-strong">{draftError}</span>}
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" aria-label="只改这一节" onClick={() => setDraft(null)}>
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
              <Button variant="ghost" size="sm" aria-label="取消" onClick={() => setDraft(null)}>
                取消
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </CollapsibleCard>
  );
}
