import { useEffect, useReducer, useState } from 'react';
import { applyImport, previewDuplicates, type ImportedSchedule, type Storage } from '@dawn-tick/core';
import { toast } from '../../components/ui/toaster.tsx';
import { logInfo } from '../../log.ts';
import { useAction } from '../../lib/action.ts';
import { closeImportWindow } from '../../import-window.ts';
import {
  INITIAL_FLOW,
  applySelection,
  conflictInfo,
  reduceFlow,
  selectedCount,
  toggleSelection,
  visibleRowIndexes,
  type ImportChannel,
  type ImportStep,
  type PasteSource,
  type SelectionMode,
} from './import-flow-model.ts';

export interface ImportFlowOptions {
  storage: Storage;
  semesterId: string;
  onDone: () => void;
}

/** 预览与写入共用的状态：解析结果、勾选、重复预检与筛选。 */
export interface ImportFlowApi {
  step: ImportStep;
  channel: ImportChannel;
  pasteSource: PasteSource;
  schedules: ImportedSchedule[];
  warnings: string[];
  selected: ReadonlySet<number>;
  duplicateRows: boolean[];
  duplicatesKnown: boolean;
  conflictOnly: boolean;
  conflictCount: number;
  filteringConflicts: boolean;
  visibleIndexes: number[];
  visibleSelectedCount: number;
  busy: boolean;
  pickChannel: (channel: 'paste' | 'window') => void;
  pickPasteSource: (source: 'page' | 'file') => void;
  back: () => void;
  accept: (next: ImportedSchedule[], nextWarnings: string[]) => void;
  confirm: () => Promise<void>;
  restart: () => void;
  toggleRow: (index: number) => void;
  batchSelect: (mode: SelectionMode) => void;
  setConflictOnly: (value: boolean) => void;
}

export function useImportFlow({ storage, semesterId, onDone }: ImportFlowOptions): ImportFlowApi {
  const [flow, dispatch] = useReducer(reduceFlow, INITIAL_FLOW);
  const [schedules, setSchedules] = useState<ImportedSchedule[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** 预览重复预检：与 schedules 下标对齐，true 表示写入时会因重复被跳过 */
  const [duplicateRows, setDuplicateRows] = useState<boolean[]>([]);
  /** 只看冲突项：默认关，筛选只影响显示，不改变勾选语义 */
  const [conflictOnly, setConflictOnly] = useState(false);
  const { busy, run } = useAction();

  /**
   * 进入预览后跑一次只读重复预检：与写入共用 core 的判定口径，结果只用于标注与筛选。
   * 预检期间（长度未对齐）不做筛选，避免闪一屏空列表。
   */
  useEffect(() => {
    if (flow.step !== 3 || schedules.length === 0) return;
    let cancelled = false;
    void previewDuplicates(storage, semesterId, schedules)
      .then((flags) => {
        if (!cancelled) setDuplicateRows(flags);
      })
      .catch(() => {
        // 预检只是标注与筛选：失败时退回全量显示，不拦导入
        if (!cancelled) {
          setDuplicateRows([]);
          setConflictOnly(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [flow.step, schedules, storage, semesterId]);

  const conflicts = conflictInfo(schedules.length, duplicateRows, conflictOnly);
  const visibleIndexes = visibleRowIndexes(schedules.length, duplicateRows, conflictOnly);
  const visibleSelectedCount = selectedCount(visibleIndexes, selected);

  function pickChannel(channel: 'paste' | 'window'): void {
    dispatch({ type: 'pick-channel', channel });
  }

  function pickPasteSource(source: 'page' | 'file'): void {
    dispatch({ type: 'pick-paste-source', source });
  }

  function back(): void {
    dispatch({ type: 'back' });
  }

  function accept(next: ImportedSchedule[], nextWarnings: string[]): void {
    setSchedules(next);
    setWarnings(nextWarnings);
    setSelected(new Set(next.map((_, index) => index)));
    // 换了一批解析结果就重跑预检；筛选一并复位，默认仍显示全量
    setDuplicateRows([]);
    setConflictOnly(false);
    dispatch({ type: 'accepted' });
  }

  async function confirm(): Promise<void> {
    await run({
      scope: 'import',
      label: '正在导入课表…',
      fail: { what: '导入课表失败', next: '请检查文件与勾选项后重试。' },
      task: async () => {
        const chosen = schedules.filter((_, index) => selected.has(index));
        const applied = await applyImport(storage, semesterId, chosen);
        setWarnings(applied.warnings);
        logInfo('import', '应用导入', {
          channel: flow.channel,
          source: flow.channel === 'paste' ? flow.pasteSource : flow.channel,
          selected: chosen.length,
          courses: applied.createdCourses,
          schedules: applied.createdSchedules,
          skipped: applied.skippedSchedules,
        });
        toast.success(
          `新增课程 ${applied.createdCourses} · 排课 ${applied.createdSchedules} · 跳过重复 ${applied.skippedSchedules}`,
        );
        dispatch({ type: 'done' });
        // 导入完成就关掉内嵌教务窗口，避免用户还要自己关
        await closeImportWindow();
        logInfo('import', '导入完成并关闭内嵌窗口', { courses: applied.createdCourses });
        onDone();
      },
    });
  }

  function restart(): void {
    dispatch({ type: 'restart' });
    setSchedules([]);
    setWarnings([]);
    setSelected(new Set());
    setDuplicateRows([]);
    setConflictOnly(false);
  }

  function toggleRow(index: number): void {
    setSelected((current) => toggleSelection(current, index));
  }

  function batchSelect(mode: SelectionMode): void {
    setSelected((current) => applySelection(current, visibleIndexes, mode));
  }

  return {
    step: flow.step,
    channel: flow.channel,
    pasteSource: flow.pasteSource,
    schedules,
    warnings,
    selected,
    duplicateRows,
    duplicatesKnown: conflicts.known,
    conflictOnly,
    conflictCount: conflicts.conflictCount,
    filteringConflicts: conflicts.filtering,
    visibleIndexes,
    visibleSelectedCount,
    busy,
    pickChannel,
    pickPasteSource,
    back,
    accept,
    confirm,
    restart,
    toggleRow,
    batchSelect,
    setConflictOnly,
  };
}
