import { useRef, useState } from 'react';
import { Bookmark, FileSpreadsheet, FileText, PencilLine, SlidersHorizontal } from 'lucide-react';
import {
  PAGE_BOOKMARKLET,
  applyImport,
  countPastedFrames,
  extractTimetableFromHtml,
  icsToSchedules,
  inspectPage,
  loadSemester,
  parseCsv,
  parseIcs,
  parseTimetableMatrix,
  listTimeSlots,
  stripPageMarkers,
  type ImportedSchedule,
  type PageInspection,
  type Storage,
} from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { toast } from '../components/ui/toaster.tsx';
import { logError, logInfo } from '../log.ts';
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
  onManual: () => void;
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
  const [mapHeaderRow, setMapHeaderRow] = useState(0);
  const [mapDayStart, setMapDayStart] = useState(1);
  const [mapDayCount, setMapDayCount] = useState(7);
  const [mapPeriodColumn, setMapPeriodColumn] = useState(0);

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
                    onManual();
                    onClose();
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
          <span className="text-sm text-ink">1. 在浏览器里自行登录教务并打开课表页</span>
          <span className="text-xs text-muted">
            2. 把下面代码存成书签：新建书签，名称随意，地址粘贴这段代码；在课表页点一下该书签，页面内容会复制到剪贴板
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
          <span className="text-sm text-ink">3. 回到这里粘贴，自动识别课表</span>
          <textarea
            value={pageText}
            aria-label="粘贴课表页面内容"
            placeholder="把课表页面的内容（或书签复制的内容）粘贴到这里"
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
