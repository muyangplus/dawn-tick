import { useEffect, useState } from 'react';
import {
  BUILTIN_SCHOOLS,
  SYSTEM_ENTRIES,
  buildEntryUrl,
  extractTimetableFromHtml,
  mergeSchools,
  stripPageMarkers,
  systemEntry,
  type ImportedSchedule,
  type SchoolEntry,
  type SchoolSystem,
  type Storage,
} from '@dawn-tick/core';
import { toast } from '../../components/ui/toaster.tsx';
import { logError, logInfo } from '../../log.ts';
import {
  adapterInfo,
  loadPresetContext,
  matchingEntrySchools,
  type PresetContext,
  type School,
} from '../school-picker-model.ts';
import { readRecentSchool, writeRecentSchool } from '../../school-recent.ts';
import {
  canOpenImportWindow,
  closeImportWindow,
  listenImportPayload,
  loadCustomSchools,
  openImportWindow,
  rememberedImportUrl,
  saveCustomSchool,
} from '../../import-window.ts';

export interface WindowSourceOptions {
  storage: Storage;
  /** 窗口回传的页面内容同步到渠道 ① 的粘贴框，切回去还能手动校正 */
  onPayloadText: (payload: string) => void;
  onAccepted: (next: ImportedSchedule[], warnings: string[]) => void;
}

/** 渠道 ②：选学校 → 打开内嵌教务窗口 → 登录后回传页面并解析。 */
export interface WindowSourceApi {
  canOpen: boolean;
  importUrl: string;
  setImportUrl: (value: string) => void;
  schoolSystem: SchoolSystem;
  setSchoolSystem: (value: SchoolSystem) => void;
  schoolName: string;
  schoolDomain: string;
  setSchoolDomain: (value: string) => void;
  pickedSchoolId: string | null;
  recentSchool: School | null;
  presetContext: PresetContext | null;
  windowNote: string | null;
  opening: boolean;
  pickSchool: (school: School) => void;
  fillEntry: () => void;
  saveSchool: () => void;
  openWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
}

export function useWindowSource({
  storage,
  onPayloadText,
  onAccepted,
}: WindowSourceOptions): WindowSourceApi {
  const [importUrl, setImportUrl] = useState(() => rememberedImportUrl());
  const [schoolSystem, setSchoolSystem] = useState<SchoolSystem>('jwglxt');
  const [schoolName, setSchoolName] = useState('');
  /** 选择器里高亮的那所学校（目录 id，未必等于教务条目 id） */
  const [pickedSchoolId, setPickedSchoolId] = useState<string | null>(null);
  const [schoolId, setSchoolId] = useState('');
  const [schoolDomain, setSchoolDomain] = useState('');
  const [customSchools, setCustomSchools] = useState<SchoolEntry[]>(() => loadCustomSchools());
  /** 当前生效的预设（缓存优先，否则内置）：学校选择器的适配徽标与入口推断都看它 */
  const [presetContext, setPresetContext] = useState<PresetContext | null>(null);
  const [windowNote, setWindowNote] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  /** 上次在这台设备选过的学校：挂在选择器顶部 */
  const [recentSchool, setRecentSchool] = useState<School | null>(null);

  /** 预设只在挂载时读一次：索引来自已校验的快照，缓存优先，失败退回内置 */
  useEffect(() => {
    let cancelled = false;
    void loadPresetContext(storage).then((context) => {
      if (!cancelled) setPresetContext(context);
    });
    return () => {
      cancelled = true;
    };
  }, [storage]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await readRecentSchool(storage);
      if (!cancelled) setRecentSchool(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  /** 内置学校与本地保存的学校合并：选中学校时用来匹配教务入口 */
  const allSchools = mergeSchools(BUILTIN_SCHOOLS, customSchools);

  /** 选中学校：有入口条目就按条目的系统与地址填入，否则用预设索引教务系统做初值待手填。 */
  function pickSchool(school: School): void {
    setSchoolName(school.name);
    setPickedSchoolId(school.id);
    setSchoolId(school.id);
    // 导入流程与作息页共用「上次选的学校」：下次打开选择器置顶
    void writeRecentSchool(storage, school);
    const match = matchingEntrySchools(allSchools, school);
    if (match === undefined) {
      const info = presetContext === null ? null : adapterInfo(presetContext, school);
      const matched = SYSTEM_ENTRIES.find((item) => item.id === info?.systemId);
      if (matched !== undefined) setSchoolSystem(matched.id);
      setImportUrl('');
      setWindowNote(`${school.name} 暂无内置入口：用「按入口补齐」生成`);
      return;
    }

    setSchoolId(match.entry.id);
    setSchoolSystem(match.entry.system);
    if (match.entry.url.trim() !== '') {
      setImportUrl(match.url);
      setWindowNote(`已填入 ${match.entry.name} 的教务入口（${systemEntry(match.entry.system).label}）`);
    } else {
      setImportUrl('');
      setWindowNote(`${match.entry.name} 没有内置入口：先按入口补齐`);
    }
  }

  function fillEntry(): void {
    setImportUrl(buildEntryUrl(schoolSystem, schoolDomain));
  }

  function saveSchool(): void {
    const name = schoolName.trim().length > 0 ? schoolName : schoolDomain.trim();
    const id = schoolId.trim().length > 0 ? schoolId : `user-${name}`;
    setCustomSchools(saveCustomSchool({ id, name, system: schoolSystem, url: schoolDomain.trim(), source: 'user' }));
    setWindowNote(`「${name}」已保存到我的学校列表`);
  }

  /** 教务窗口回传的页面内容，直接走识别。桌面端走事件，移动端由打开调用直接返回。 */
  function handleImportPayload(payload: string): void {
    onPayloadText(payload);
    const result = extractTimetableFromHtml(stripPageMarkers(payload));
    if (result.schedules.length === 0) {
      setWindowNote(result.warnings.join('；'));
      logError('import-window', '回传内容未识别到课表', { shape: result.shape, tables: result.tables });
      return;
    }
    logInfo('import-window', '教务窗口回传并识别', {
      shape: result.shape,
      tables: result.tables,
      schedules: result.schedules.length,
    });
    setWindowNote(`已从教务窗口识别到 ${result.schedules.length} 条排课，请核对后导入`);
    toast.success(`已从教务窗口识别到 ${result.schedules.length} 条排课`);
    onAccepted(result.schedules, result.warnings);
  }

  useEffect(() => {
    if (!canOpenImportWindow()) return;
    let dispose: (() => void) | null = null;
    void listenImportPayload(handleImportPayload).then((unlisten) => {
      dispose = unlisten;
    });
    return () => {
      dispose?.();
    };
    // 事件监听只建一次；回调只依赖 setState 与纯函数
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openWindow(): Promise<void> {
    if (opening) return;
    setOpening(true);
    try {
      const result = await openImportWindow(importUrl.trim());
      if (!result.ok) {
        setWindowNote(result.error ?? '打开失败');
        return;
      }
      if (result.payload !== undefined) {
        // 移动端：窗口关闭时已经把页面内容带回来
        if (result.payload === '') setWindowNote('已关闭教务窗口，没有带回页面内容');
        else handleImportPayload(result.payload);
        return;
      }
      setWindowNote('窗口已打开：登录后用窗口右下角「导入到晓刻」');
    } finally {
      setOpening(false);
    }
  }

  async function closeWindow(): Promise<void> {
    await closeImportWindow();
    setWindowNote('已关闭教务窗口');
  }

  return {
    canOpen: canOpenImportWindow(),
    importUrl,
    setImportUrl,
    schoolSystem,
    setSchoolSystem,
    schoolName,
    schoolDomain,
    setSchoolDomain,
    pickedSchoolId,
    recentSchool,
    presetContext,
    windowNote,
    opening,
    pickSchool,
    fillEntry,
    saveSchool,
    openWindow,
    closeWindow,
  };
}
