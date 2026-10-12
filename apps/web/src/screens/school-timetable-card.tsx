/**
 * 「按学校套用作息」：作息设置里与 SchoolPicker 共用的选校入口。
 *
 * 为什么单独一张卡片：作息设置原有的「作息预设」下拉列的是**内置作息表**（与学校无关），
 * 用户真正的诉求是「我这所学校几点上课」。这里把选校体验与导入流程统一成同一个
 * `SchoolPicker`，选中后：
 *   1. 预设索引里这所学校有 `timetablePath`、快照的作息清单里能定位到它、且**生效的预设**
 *      里真有这套作息正文 → 照抄它的节次（`presetToTimeSlots` → `replaceTimeSlots`）；
 *   2. 否则回退**内置通用作息**，并明确提示「该校暂无专属作息，已套用通用作息」——
 *      不回退到「什么都没发生」，也不假装套用了专属作息。
 *
 * 与 `PeriodSettings` 的分工：节次时间的逐节编辑 / 顺延重排仍在那张卡片里，
 * 这张卡片只负责「按学校一次性套用」，两边都用 core 的 `replaceTimeSlots` 落库。
 */
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import {
  DEFAULT_TIMETABLE_ID,
  findTimetable,
  listTimeSlots,
  presetToTimeSlots,
  replaceTimeSlots,
  type Storage,
  type TimeSlotRow,
} from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { CollapsibleCard } from '../components/ui/collapsible-card.tsx';
import { Dialog, DialogContent, DialogFooter } from '../components/ui/dialog.tsx';
import { SchoolPicker } from '../components/school-picker.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { logInfo } from '../log.ts';
import { loadPresetContext, resolveSchoolTimetable, type PresetContext, type School } from './school-picker-model.ts';

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

  /** 打开选择器时重新读一次预设：用户可能刚在「同步与数据」里下载了新版本。 */
  async function openPicker(): Promise<void> {
    setMessage(null);
    setContext(await loadPresetContext(storage));
    setPickerOpen(true);
  }

  /**
   * 选中学校后套用作息：专属作息优先，否则内置通用作息。
   * 落库失败（节次非法等）只给一句可读提示，不改变现状。
   */
  async function applyForSchool(school: School): Promise<void> {
    // 连点两行会并发写 time_slots，第二次覆盖第一次；套用期间直接忽略后续点击
    if (busy) return;
    setBusy(true);
    try {
      const resolution = context === null ? null : resolveSchoolTimetable(context, school);
      const exclusive = resolution?.found === true ? findTimetable(resolution.timetableId ?? '') : undefined;
      const fallback = findTimetable(DEFAULT_TIMETABLE_ID);
      const chosen = exclusive ?? fallback;
      if (chosen === undefined) {
        setMessage('内置通用作息不可用，没能套用');
        return;
      }

      await replaceTimeSlots(storage, semesterId, presetToTimeSlots(chosen));
      setPickedId(school.id);
      setApplied({
        school: school.name,
        timetable: chosen.name,
        periods: chosen.periods.length,
        exclusive: exclusive !== undefined,
        source: exclusive !== undefined ? (resolution?.sourcePath ?? chosen.source ?? null) : (chosen.source ?? null),
      });
      setMessage(
        exclusive === undefined
          ? '该校暂无专属作息，已套用通用作息'
          : `已套用 ${school.name} 的作息（${chosen.periods.length} 节）`,
      );
      logInfo('timetable', '按学校套用作息', {
        school: school.name,
        timetable: chosen.id,
        exclusive: exclusive !== undefined,
        periods: chosen.periods.length,
        source: resolution?.sourcePath ?? null,
      });
      toast.success(
        exclusive === undefined
          ? `该校暂无专属作息，已套用通用作息（${chosen.periods.length} 节）`
          : `已套用「${school.name}」作息（${chosen.periods.length} 节）`,
      );
      setPickerOpen(false);
      await reloadSlots();
      onChanged();
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
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
    <CollapsibleCard id="school-timetable" title="按学校套用作息" icon={CalendarClock} badge={presetLine}>
      <span className="text-xs text-muted">
        选一所学校：预设里有该校作息就按它重排整张时间表，没有就套用内置通用作息（会明确提示）。
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
        <span className="text-xs text-muted" data-role="school-timetable-status">
          {slots.length === 0 ? '当前没有课次' : `当前 ${slots.length} 节课次`}
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
          description="选中学校后会按预设里该校的作息重排整张时间表；该校暂无专属作息时套用通用作息。"
        >
          <SchoolPicker
            context={context}
            selectedId={pickedId}
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
    </CollapsibleCard>
  );
}
