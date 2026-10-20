/** 「按学校套用作息」选校入口：能定位到 `timetablePath` 且预设含正文则照抄节次，否则回退内置通用作息。 */
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { listTimeSlots, type Storage, type TimeSlotRow } from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { SectionCard } from '../components/ui/collapsible-card.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { SchoolPicker } from '../components/school-picker.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { describeError, logInfo, logWarn } from '../log.ts';
import { fail } from '../lib/fail.ts';
import { readRecentSchool, writeRecentSchool } from '../school-recent.ts';
import {
  applySchoolTimetable,
  loadPresetContext,
  type PresetContext,
  type School,
} from './school-picker-model.ts';

export interface SchoolTimetableCardProps {
  storage: Storage;
  semesterId: string;
  onChanged: () => void;
}

/** 上一次套用的结果，仅用于界面说明（不落盘：作息本身已经落进 time_slots）。 */
interface AppliedSchoolTimetable {
  school: string;
  timetable: string;
  periods: number;
  /** 是否命中了该校的专属作息；false 表示套的是通用作息 */
  exclusive: boolean;
  /** 作息来源说明（预设里的源文件路径或内置来源） */
  source: string | null;
}

export function SchoolTimetableCard({ storage, semesterId, onChanged }: SchoolTimetableCardProps) {
  const [context, setContext] = useState<PresetContext | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  /** 上次选过的学校：置顶显示并支持一键再套用 */
  const [recent, setRecent] = useState<School | null>(null);
  const [slots, setSlots] = useState<readonly TimeSlotRow[]>([]);
  const [applied, setApplied] = useState<AppliedSchoolTimetable | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadSlots = useCallback(async () => {
    if (semesterId === '') {
      setSlots([]);
      return;
    }
    setSlots(await listTimeSlots(storage, semesterId));
  }, [storage, semesterId]);

  useEffect(() => {
    void reloadSlots();
  }, [reloadSlots]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await readRecentSchool(storage);
      if (!cancelled) setRecent(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  /** 打开选择器时重新读一次预设：用户可能刚在「同步与更新」里下载了新版本。 */
  async function openPicker(): Promise<void> {
    setMessage(null);
    setContext(await loadPresetContext(storage));
    setPickerOpen(true);
  }

  /** 选中学校后套用作息：专属优先，否则内置通用；落库失败只提示，不改现状。 */
  async function applyForSchool(school: School): Promise<void> {
    // 连点两行会并发写 time_slots，第二次覆盖第一次；套用期间直接忽略后续点击
    if (busy) return;
    setBusy(true);
    try {
      const result = await applySchoolTimetable(storage, semesterId, school);
      setPickedId(school.id);
      setRecent(school);
      await writeRecentSchool(storage, school);
      setApplied({
        school: school.name,
        timetable: result.timetableName,
        periods: result.periods,
        exclusive: result.exclusive,
        source: result.source,
      });
      setMessage(result.message);
      logInfo('timetable', '按学校套用作息', {
        school: school.name,
        timetable: result.timetableId,
        exclusive: result.exclusive,
        periods: result.periods,
        source: result.source,
      });
      toast.success(
        result.exclusive
          ? `已套用「${school.name}」作息（${result.periods} 节）`
          : `该校暂无专属作息，已套用通用作息（${result.periods} 节）`,
      );
      setPickerOpen(false);
      await reloadSlots();
      onChanged();
    } catch (cause: unknown) {
      // 落库失败的具体原因只进日志；界面按统一句式给原因与下一步
      logWarn('timetable', '按学校套用作息失败', {
        school: school.name,
        message: describeError(cause),
      });
      setMessage(fail('套用失败', '作息没能写入本机', '请重试；仍失败请重启应用。').text);
    } finally {
      setBusy(false);
    }
  }

  const presetLine =
    context === null
      ? '正在读取预设…'
      : context.problem !== null
        ? `预设索引不可用：${context.problem}`
        : `预设 ${context.version}${context.kind === 'cached' ? '（已更新）' : '（内置）'}`;

  return (
    <SectionCard title="按学校套用作息" icon={CalendarClock} badge={presetLine}>
      <span className="text-xs text-muted">
        按该校作息重排节次
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label="按学校套用作息"
          disabled={busy || semesterId === ''}
          onClick={() => void openPicker()}
        >
          选择学校
        </Button>
        {recent !== null && (
          <Button
            size="sm"
            variant="primary"
            aria-label={`一键套用 ${recent.name} 的作息`}
            disabled={busy || semesterId === ''}
            data-role="recent-school-apply"
            onClick={() => void applyForSchool(recent)}
          >
            一键套用：{recent.name}
          </Button>
        )}
        <span className="text-xs text-muted" data-role="school-timetable-status">
          {slots.length === 0 ? '当前没有节次' : `当前 ${slots.length} 个节次`}
          {applied === null
            ? ''
            : ` · 上次套用：${applied.school} → ${applied.timetable}（${applied.periods} 节，${
                applied.exclusive ? '专属作息' : '通用作息'
              }）`}
        </span>
      </div>
      {message !== null && (
        <span className="text-xs text-muted" data-role="school-timetable-message">
          {message}
        </span>
      )}
      {applied !== null && applied.source !== null && (
        <span className="text-xs text-muted" data-role="school-timetable-source">
          作息来源：{applied.source}
        </span>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent
          title="按学校套用作息"
          description="按学校作息重排节次"
        >
          <SchoolPicker
            context={context}
            selectedId={pickedId ?? recent?.id ?? null}
            pinned={recent}
            onPick={(school) => void applyForSchool(school)}
            listClassName="max-h-64"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPickerOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
