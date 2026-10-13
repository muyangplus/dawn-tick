import { useEffect, useRef, useState } from 'react';
import { Bookmark, FileSpreadsheet, FileText, PencilLine, SlidersHorizontal } from 'lucide-react';
import {
  BUILTIN_SCHOOLS,
  PAGE_BOOKMARKLET,
  SYSTEM_ENTRIES,
  applyImport,
  buildEntryUrl,
  countPastedFrames,
  entryUrlFor,
  extractTimetableFromHtml,
  icsToSchedules,
  inspectPage,
  loadSemester,
  mergeSchools,
  parseCsv,
  parseIcs,
  parseTimetableMatrix,
  listTimeSlots,
  stripPageMarkers,
  systemEntry,
  type ImportedSchedule,
  type PageInspection,
  type SchoolEntry,
  type SchoolSystem,
  type Storage,
} from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../components/ui/controls.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { logError, logInfo } from '../log.ts';
import { SchoolPicker } from '../components/school-picker.tsx';
import { adapterInfo, loadPresetContext, type PresetContext, type School } from './school-picker-model.ts';
import { readRecentSchool, writeRecentSchool } from '../school-recent.ts';
import {
  canOpenImportWindow,
  closeImportWindow,
  listenImportPayload,
  loadCustomSchools,
  openImportWindow,
  rememberedImportUrl,
  saveCustomSchool,
} from '../import-window.ts';
import { cn } from '../lib/cn.ts';

type Method = 'page' | 'file' | 'ics' | 'manual';
type Step = 1 | 2 | 3 | 4;

const METHODS: Array<{ id: Method; label: string; icon: typeof Bookmark; hint: string }> = [
  { id: 'page', label: '网页课表', icon: Bookmark, hint: '自己登录后粘贴课表页' },
  { id: 'file', label: 'CSV / Excel', icon: FileSpreadsheet, hint: '二维矩阵' },
  { id: 'ics', label: 'ICS', icon: FileText, hint: '日历文件' },
  { id: 'manual', label: '手动添加', icon: PencilLine, hint: '逐门录入' },
];

export interface ImportFlowProps {
  storage: Storage;
  semesterId: string;
  /** 手动添加课程：由宿主页面决定怎么打开课程表单 */
  onManual?: (() => void) | undefined;
  onDone: () => void;
  onClose: () => void;
}

async function readMatrix(file: File): Promise<string[][]> {
  if (file.name.toLowerCase().endsWith('.xlsx')) {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (sheet === undefined) return [];
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => values.push(cell.text ?? String(cell.value ?? '')));
      rows.push(values);
    });
    return rows;
  }
  return parseCsv(await file.text());
}

export function ImportFlow({ storage, semesterId, onManual, onDone, onClose }: ImportFlowProps) {
  const [step, setStep] = useState<Step>(1);
  const [method, setMethod] = useState<Method>('page');
  const [schedules, setSchedules] = useState<ImportedSchedule[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [pageText, setPageText] = useState('');
  const [bookmarkCopied, setBookmarkCopied] = useState(false);
  const [inspection, setInspection] = useState<PageInspection | null>(null);
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
  const [mapHeaderRow, setMapHeaderRow] = useState(0);
  const [mapDayStart, setMapDayStart] = useState(1);
  const [mapDayCount, setMapDayCount] = useState(7);
  const [mapPeriodColumn, setMapPeriodColumn] = useState(0);

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

  /** 手动映射：识别不准时由用户指定表头行、星期列与节次列。 */
  function runMapped(): void {
    setError(null);
    const html = stripPageMarkers(pageText);
    const result = extractTimetableFromHtml(html, {
      mapping: {
        headerRow: mapHeaderRow,
        dayStartColumn: mapDayStart,
        dayCount: mapDayCount,
        periodColumn: mapPeriodColumn < 0 ? null : mapPeriodColumn,
      },
    });
    if (result.schedules.length === 0) {
      setError(result.warnings.join('；'));
      return;
    }
    logInfo('page-import', '按手动映射解析', {
      headerRow: mapHeaderRow,
      dayStart: mapDayStart,
      dayCount: mapDayCount,
      schedules: result.schedules.length,
    });
    accept(result.schedules, result.warnings);
  }

  async function copyBookmarklet(): Promise<void> {
    try {
      await navigator.clipboard.writeText(PAGE_BOOKMARKLET);
      setBookmarkCopied(true);
      toast.success('已复制，粘贴到浏览器书签的地址栏');
    } catch {
      setError('浏览器未允许写入剪贴板，请手动复制下方代码');
    }
  }

  /** 内置学校与本地保存的学校合并：SchoolPicker 用来补「我已保存的学校」那一组 */
  const allSchools = mergeSchools(BUILTIN_SCHOOLS, customSchools);

  /** 上次在这台设备选过的学校：挂在选择器顶部 */
  const [recentSchool, setRecentSchool] = useState<School | null>(null);
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

  /**
   * 选中一所学校：
   *   - 内置/自定义教务条目里有同名条目且有地址 → 直接按既有 `entryUrlFor` 生成入口；
   *   - 条目在但没地址（或目录里的学校还没有条目）→ 用预设索引里的教务系统做初值，
   *     由用户在「手动填写入口地址」里补域名；
   * 无论哪条路，`pickedSchoolId` 都会记住这次选择，选择器据此显示「已选」。
   */
  function pickSchool(school: School): void {
    setSchoolName(school.name);
    setPickedSchoolId(school.id);
    setSchoolId(school.id);
    // 导入页与作息页共用「上次选的学校」：下次打开选择器置顶
    void writeRecentSchool(storage, school);
    const entry = allSchools.find(
      (item) => item.name === school.name || (item.aliases ?? []).includes(school.name),
    );
    if (entry === undefined) {
      const info = presetContext === null ? null : adapterInfo(presetContext, school);
      const matched = SYSTEM_ENTRIES.find((item) => item.id === info?.systemId);
      if (matched !== undefined) setSchoolSystem(matched.id);
      setImportUrl('');
      setWindowNote(
        `${school.name} 暂无内置入口：在「手动填写入口地址」中选择教务系统并填写域名，再用「按入口补齐」生成入口地址`,
      );
      return;
    }

    setSchoolId(entry.id);
    setSchoolSystem(entry.system);
    if (entry.url.trim() !== '') {
      setImportUrl(entryUrlFor(entry.system, entry.url));
      setWindowNote(`已填入 ${entry.name} 的教务入口（${systemEntry(entry.system).label}）`);
    } else {
      setImportUrl('');
      setWindowNote(`${entry.name} 没有内置入口：选择教务系统并填写域名后用「按入口补齐」，可再用「保存到我的学校」`);
    }
  }

  /** 教务窗口回传的页面内容，直接走识别。桌面端走事件，移动端由打开调用直接返回。 */
  function handleImportPayload(payload: string): void {
    setPageText(payload);
    setError(null);
    const result = extractTimetableFromHtml(payload);
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
    accept(result.schedules, result.warnings);
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

  /** 通用网页导入：识别粘贴进来的课表页面，不绑定具体学校。 */
  function runPage(): void {
    setError(null);
    const html = stripPageMarkers(pageText);
    const result = extractTimetableFromHtml(html);
    if (result.schedules.length === 0) {
      setError(result.warnings.join('；'));
      logError('page-import', '未识别到课表', {
        shape: result.shape,
        tables: result.tables,
        frames: countPastedFrames(pageText),
      });
      return;
    }
    logInfo('page-import', '识别课表页面', {
      shape: result.shape,
      tables: result.tables,
      frames: countPastedFrames(pageText),
      schedules: result.schedules.length,
    });
    accept(result.schedules, result.warnings);
  }

  function accept(next: ImportedSchedule[], nextWarnings: string[]): void {
    setSchedules(next);
    setWarnings(nextWarnings);
    setSelected(new Set(next.map((_, index) => index)));
    setStep(3);
  }

  async function runFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const semester = await loadSemester(storage, semesterId);
      if (semester === undefined) throw new Error('学期不存在');
      if (file.name.toLowerCase().endsWith('.ics')) {
        const calendar = parseIcs(await file.text());
        const timeSlots = await listTimeSlots(storage, semesterId);
        const converted = icsToSchedules(
          calendar,
          {
            id: semester.id,
            start_date: semester.start_date,
            total_weeks: semester.total_weeks,
            time_zone: semester.time_zone,
          },
          timeSlots.map((slot) => ({
            period_no: slot.period_no,
            start_time: slot.start_time,
            end_time: slot.end_time,
          })),
        );
        accept(converted.schedules, converted.warnings);
        return;
      }
      const parsed = parseTimetableMatrix(await readMatrix(file), semester.total_weeks);
      accept(
        parsed.slots.map((slot) => ({
          courseName: slot.name,
          dayOfWeek: slot.dayOfWeek,
          periodStart: slot.periodStart,
          periodEnd: slot.periodEnd,
          weeks: slot.weeks ?? Array.from({ length: semester.total_weeks }, (_, index) => index + 1),
          room: slot.room,
          teacher: slot.teacher,
        })),
        parsed.warnings,
      );
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    setBusy(true);
    try {
      const chosen = schedules.filter((_, index) => selected.has(index));
      const applied = await applyImport(storage, semesterId, chosen);
      setWarnings(applied.warnings);
      logInfo('import', '应用导入', {
        method,
        selected: chosen.length,
        courses: applied.createdCourses,
        schedules: applied.createdSchedules,
        skipped: applied.skippedSchedules,
      });
      toast.success(`新增课程 ${applied.createdCourses} · 排课 ${applied.createdSchedules} · 跳过重复 ${applied.skippedSchedules}`);
      setStep(4);
      // 导入完成就关掉内嵌教务窗口，避免用户还要自己关
      await closeImportWindow();
      logInfo('import', '导入完成并关闭内嵌窗口', { courses: applied.createdCourses });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="导入步骤">
        {['选择方式', '登录或上传', '预览', '确认'].map((label, index) => {
          const value = (index + 1) as Step;
          return (
            <li
              key={label}
              className={cn(
                'flex items-center gap-1 rounded-full px-3 py-1',
                step === value ? 'bg-primary text-on-primary' : step > value ? 'bg-surface-muted text-ink' : 'text-muted',
              )}
            >
              <span>{value}</span>
              {label}
            </li>
          );
        })}
      </ol>

      {/* 上一步：预览与上传页都能退回上一步，不用重新开始 */}
      {step > 1 && step < 4 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label="上一步"
            onClick={() => setStep((current) => (current > 1 ? ((current - 1) as Step) : current))}
          >
            上一步
          </Button>
          <span className="text-xs text-muted">当前第 {step} 步 / 共 4 步</span>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-2 tablet:grid-cols-2">
          {METHODS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setMethod(item.id);
                  if (item.id === 'manual') {
                    onManual?.();
                    return;
                  }
                  setStep(2);
                }}
                className={cn(
                  'flex min-h-tap items-center gap-3 rounded-lg border p-3 text-left',
                  method === item.id ? 'border-primary-strong bg-surface-muted' : 'border-line bg-surface hover:bg-surface-muted',
                )}
              >
                <Icon className="size-5 text-primary-strong" aria-hidden />
                <span className="flex flex-col">
                  <span className="text-sm text-ink">{item.label}</span>
                  <span className="text-xs text-muted">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && method === 'page' && (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-muted p-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink">选择学校</span>
              <span className="text-xs text-muted">
                {canOpenImportWindow()
                  ? '选中学校 → 打开窗口 → 在窗口内登录并进入课表页 → 用窗口右下角「导入到晓刻」，本页自动识别'
                  : '选中学校取得入口地址，在浏览器登录并打开课表页，再回到本页粘贴内容'}
              </span>
            </div>

            {/* 学校检索统一收敛到 SchoolPicker（原基于名单的 Combobox 已移除） */}
            <SchoolPicker
              context={presetContext}
              entries={allSchools}
              selectedId={pickedSchoolId}
              pinned={recentSchool}
              onPick={pickSchool}
            />
            <span className="text-xs text-muted" data-role="school-picked">
              {schoolName.trim() === '' ? '未选择学校' : `已选：${schoolName}`}
            </span>

            {/* 兜底路径：没有内置入口的学校在这里手填教务系统 + 域名（或直接粘贴入口地址） */}
            <details className="flex flex-col gap-2">
              <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-sm text-ink">
                <SlidersHorizontal className="size-4" aria-hidden />
                手动填写入口地址
              </summary>
              <div className="flex flex-col gap-2 pt-2">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="教务系统">
                    <Select value={schoolSystem} onValueChange={(value) => setSchoolSystem(value as SchoolSystem)}>
                      <SelectTrigger aria-label="教务系统" className="w-40">
                        {systemEntry(schoolSystem).label}
                      </SelectTrigger>
                      <SelectContent>
                        {SYSTEM_ENTRIES.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {entry.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="学校域名">
                    <Input
                      value={schoolDomain}
                      placeholder="jw.example.edu.cn"
                      aria-label="学校域名"
                      onChange={(event) => setSchoolDomain(event.target.value)}
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={schoolDomain.trim().length === 0}
                    onClick={() => setImportUrl(buildEntryUrl(schoolSystem, schoolDomain))}
                  >
                    按入口补齐
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={schoolDomain.trim().length === 0}
                    onClick={() => {
                      const name = schoolName.trim().length > 0 ? schoolName : schoolDomain.trim();
                      const id = schoolId.trim().length > 0 ? schoolId : `user-${name}`;
                      setCustomSchools(
                        saveCustomSchool({ id, name, system: schoolSystem, url: schoolDomain.trim(), source: 'user' }),
                      );
                      setWindowNote(`「${name}」已保存到我的学校列表`);
                    }}
                  >
                    保存到我的学校
                  </Button>
                </div>

                <Field label="入口地址">
                  <Input
                    value={importUrl}
                    placeholder="https://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html"
                    aria-label="入口地址"
                    onChange={(event) => setImportUrl(event.target.value)}
                  />
                </Field>
              </div>
            </details>

            {windowNote !== null && <span className="text-xs text-muted">{windowNote}</span>}
            {canOpenImportWindow() && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={busy || importUrl.trim().length === 0}
                  onClick={() => {
                    void (async () => {
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
                    })();
                  }}
                >
                  打开教务窗口
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void closeImportWindow();
                    setWindowNote('已关闭教务窗口');
                  }}
                >
                  关闭窗口
                </Button>
              </div>
            )}
          </div>

          <span className="text-sm text-ink">或用浏览器书签复制</span>
          <span className="text-xs text-muted">
            将下方代码存为书签：新建书签，名称自定，地址栏粘贴该段代码；打开课表页后执行该书签，页面内容复制到剪贴板
          </span>
          <textarea
            readOnly
            value={PAGE_BOOKMARKLET}
            aria-label="书签小工具代码"
            className="h-20 w-full rounded-md border border-line bg-surface-muted p-2 text-[11px] text-muted"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void copyBookmarklet()}>
              复制书签代码
            </Button>
            {bookmarkCopied && <span className="text-xs text-muted">已复制</span>}
          </div>
          <span className="text-sm text-ink">3. 回到本页粘贴，自动识别课表</span>
          <textarea
            value={pageText}
            aria-label="粘贴课表页面内容"
            placeholder="将课表页面内容（或书签复制的内容）粘贴到这里"
            onChange={(event) => setPageText(event.target.value)}
            className="h-28 w-full rounded-md border border-line bg-surface p-2 text-xs text-ink"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || pageText.trim().length === 0} onClick={runPage}>
              识别并预览
            </Button>
            <Button variant="ghost" onClick={() => setStep(1)}>
              返回
            </Button>
          </div>

          <details className="flex flex-col gap-2">
            <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-sm text-ink">
              <SlidersHorizontal className="size-4" aria-hidden />
              手动指定表格
            </summary>
            <div className="flex flex-col gap-2 pt-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pageText.trim().length === 0}
                onClick={() => setInspection(inspectPage(stripPageMarkers(pageText)))}
              >
                读取页面表格
              </Button>
              {inspection !== null && (
                <>
                  <span className="text-xs text-muted">
                    形态推测：{inspection.system.label} · 预览 {inspection.tables.length} 个表格（行号从 0 起）
                  </span>
                  <div className="max-h-56 overflow-auto rounded-md border border-line">
                    <table className="w-full text-left text-[11px]">
                      <tbody>
                        {(inspection.tables[0]?.rows ?? []).map((row, rowIndex) => (
                          <tr key={rowIndex} className="border-t border-line">
                            <th className="w-6 p-1 text-muted">{rowIndex}</th>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className="max-w-24 truncate p-1" title={cell}>
                                {cell === '' ? '—' : cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="表头行">
                      <Input
                        type="number"
                        min={0}
                        className="w-16"
                        value={mapHeaderRow}
                        onChange={(event) => setMapHeaderRow(Number(event.target.value))}
                      />
                    </Field>
                    <Field label="星期起始列">
                      <Input
                        type="number"
                        min={0}
                        className="w-16"
                        value={mapDayStart}
                        onChange={(event) => setMapDayStart(Number(event.target.value))}
                      />
                    </Field>
                    <Field label="星期列数">
                      <Input
                        type="number"
                        min={1}
                        max={7}
                        className="w-16"
                        value={mapDayCount}
                        onChange={(event) => setMapDayCount(Number(event.target.value))}
                      />
                    </Field>
                    <Field label="节次列（-1 用行号）">
                      <Input
                        type="number"
                        min={-1}
                        className="w-20"
                        value={mapPeriodColumn}
                        onChange={(event) => setMapPeriodColumn(Number(event.target.value))}
                      />
                    </Field>
                    <Button variant="primary" size="sm" onClick={runMapped}>
                      按此映射识别
                    </Button>
                  </div>
                </>
              )}
            </div>
          </details>
        </Card>
      )}

      {step === 2 && (method === 'file' || method === 'ics') && (
        <Card className="flex flex-col gap-3">
          <span className="text-sm text-ink">
            {method === 'ics' ? '选择 .ics 日历文件' : '选择 .csv 或 .xlsx 课表文件'}
          </span>
          <input
            ref={fileInput}
            type="file"
            accept={method === 'ics' ? '.ics' : '.csv,.xlsx,.txt'}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void runFile(file);
            }}
          />
          <Button variant="ghost" onClick={() => setStep(1)}>
            返回
          </Button>
        </Card>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <span className="text-sm text-ink">
            解析到 {schedules.length} 条排课，已选 {selected.size} 条
          </span>
          <div className="max-h-72 overflow-auto rounded-md border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="p-2">选</th>
                  <th className="p-2">课程</th>
                  <th className="p-2">星期</th>
                  <th className="p-2">节次</th>
                  <th className="p-2">周次</th>
                  <th className="p-2">地点</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((item, index) => (
                  <tr key={`${item.courseName}-${index}`} className="border-t border-line">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={selected.has(index)}
                        aria-label={`选择 ${item.courseName}`}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="p-2 text-ink">{item.courseName}</td>
                    <td className="p-2">周{item.dayOfWeek}</td>
                    <td className="tabular p-2">
                      {item.periodStart}-{item.periodEnd}
                    </td>
                    <td className="p-2">{item.weeks.length} 周</td>
                    <td className="p-2">{item.room ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {warnings.length > 0 && <p className="text-xs text-danger-strong">{warnings.join('；')}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || selected.size === 0} onClick={() => void confirm()}>
              确认导入
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)}>
              返回
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3">
          <span className="text-sm text-ink">导入完成</span>
          {warnings.length > 0 && <p className="text-xs text-danger-strong">{warnings.join('；')}</p>}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setStep(1);
                setSchedules([]);
                setSelected(new Set());
              }}
            >
              继续导入
            </Button>
            <Button variant="primary" onClick={onClose}>
              完成
            </Button>
          </div>
        </div>
      )}

      {error !== null && <p className="text-xs text-danger-strong">{error}</p>}
    </div>
  );
}
