import { useRef, useState, type RefObject } from 'react';
import {
  PAGE_BOOKMARKLET,
  countPastedFrames,
  extractTimetableFromHtml,
  icsToSchedules,
  inspectPage,
  listTimeSlots,
  loadSemester,
  parseCsv,
  parseIcs,
  parseTimetableMatrix,
  stripPageMarkers,
  type ImportedSchedule,
  type PageInspection,
  type Storage,
} from '@dawn-tick/core';
import { toast } from '../../components/ui/toaster.tsx';
import { logError, logInfo } from '../../log.ts';
import { useAction } from '../../lib/action.ts';
import { fileKind, unsupportedFileReason, type ImportFailure } from './import-flow-model.ts';

export interface PasteSourceOptions {
  storage: Storage;
  semesterId: string;
  onAccepted: (next: ImportedSchedule[], warnings: string[]) => void;
}

/** 渠道 ① 的取材状态：网页文本、表格/日历文件，以及失败时就近展开的手动映射。 */
export interface PasteSourceApi {
  text: string;
  setText: (value: string) => void;
  busy: boolean;
  bookmarkCopied: boolean;
  pageFailure: ImportFailure | null;
  mappingFailure: ImportFailure | null;
  fileFailure: ImportFailure | null;
  clipboardFailure: ImportFailure | null;
  inspection: PageInspection | null;
  mappingOpen: boolean;
  mapHeaderRow: number;
  mapDayStart: number;
  mapDayCount: number;
  mapPeriodColumn: number;
  fileInput: RefObject<HTMLInputElement | null>;
  runPage: () => void;
  copyBookmarklet: () => Promise<void>;
  openMapping: () => void;
  closeMapping: () => void;
  readTables: () => void;
  applyMapping: () => void;
  setMapHeaderRow: (value: number) => void;
  setMapDayStart: (value: number) => void;
  setMapDayCount: (value: number) => void;
  setMapPeriodColumn: (value: number) => void;
  selectFile: (file: File) => Promise<void>;
}

/** Excel 的二维矩阵要靠 exceljs 读；CSV / TXT 直接按文本切。 */
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

export function usePasteSource({ storage, semesterId, onAccepted }: PasteSourceOptions): PasteSourceApi {
  const [text, setText] = useState('');
  const [bookmarkCopied, setBookmarkCopied] = useState(false);
  const [pageFailure, setPageFailure] = useState<ImportFailure | null>(null);
  const [mappingFailure, setMappingFailure] = useState<ImportFailure | null>(null);
  const [fileFailure, setFileFailure] = useState<ImportFailure | null>(null);
  const [clipboardFailure, setClipboardFailure] = useState<ImportFailure | null>(null);
  const [inspection, setInspection] = useState<PageInspection | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mapHeaderRow, setMapHeaderRow] = useState(0);
  const [mapDayStart, setMapDayStart] = useState(1);
  const [mapDayCount, setMapDayCount] = useState(7);
  const [mapPeriodColumn, setMapPeriodColumn] = useState(0);
  const { busy, run } = useAction();
  const fileInput = useRef<HTMLInputElement>(null);

  function resetFailures(): void {
    setPageFailure(null);
    setMappingFailure(null);
    setFileFailure(null);
    setClipboardFailure(null);
  }

  /** 通用网页导入：识别粘贴进来的课表页面，不绑定具体学校。 */
  function runPage(): void {
    resetFailures();
    const html = stripPageMarkers(text);
    const result = extractTimetableFromHtml(html);
    if (result.schedules.length === 0) {
      setPageFailure({
        source: 'page',
        reason: result.warnings.join('；') || '没有识别到排课',
      });
      logError('page-import', '未识别到课表', {
        shape: result.shape,
        tables: result.tables,
        frames: countPastedFrames(text),
      });
      return;
    }
    logInfo('page-import', '识别课表页面', {
      shape: result.shape,
      tables: result.tables,
      frames: countPastedFrames(text),
      schedules: result.schedules.length,
    });
    onAccepted(result.schedules, result.warnings);
  }

  async function copyBookmarklet(): Promise<void> {
    try {
      await navigator.clipboard.writeText(PAGE_BOOKMARKLET);
      setBookmarkCopied(true);
      toast.success('已复制，粘贴到浏览器书签的地址栏');
    } catch {
      setClipboardFailure({ source: 'clipboard', reason: '浏览器未允许写入剪贴板，请手动复制下方代码' });
    }
  }

  /** 识别失败或主动校正时打开抽屉：先读出页面里的表格，再让用户指定行列。 */
  function openMapping(): void {
    setInspection(inspectPage(stripPageMarkers(text)));
    setMappingOpen(true);
  }

  function closeMapping(): void {
    setMappingOpen(false);
  }

  function readTables(): void {
    setInspection(inspectPage(stripPageMarkers(text)));
  }

  /** 手动映射：识别不准时由用户指定表头行、星期列与节次列。 */
  function applyMapping(): void {
    setMappingFailure(null);
    const result = extractTimetableFromHtml(stripPageMarkers(text), {
      mapping: {
        headerRow: mapHeaderRow,
        dayStartColumn: mapDayStart,
        dayCount: mapDayCount,
        periodColumn: mapPeriodColumn < 0 ? null : mapPeriodColumn,
      },
    });
    if (result.schedules.length === 0) {
      setMappingFailure({
        source: 'mapping',
        reason: result.warnings.join('；') || '没有识别到排课',
      });
      return;
    }
    logInfo('page-import', '按手动映射解析', {
      headerRow: mapHeaderRow,
      dayStart: mapDayStart,
      dayCount: mapDayCount,
      schedules: result.schedules.length,
    });
    setMappingOpen(false);
    onAccepted(result.schedules, result.warnings);
  }

  async function selectFile(file: File): Promise<void> {
    resetFailures();
    const kind = fileKind(file.name);
    if (kind === 'unknown') {
      setFileFailure({ source: 'file', reason: unsupportedFileReason(file.name) });
      return;
    }
    const result = await run({
      scope: 'import',
      label: '正在读取课表文件…',
      log: '读取课表文件失败',
      task: async () => {
        const semester = await loadSemester(storage, semesterId);
        if (semester === undefined) throw new Error('学期不存在');
        if (kind === 'ics') {
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
          onAccepted(converted.schedules, converted.warnings);
          return;
        }
        const parsed = parseTimetableMatrix(await readMatrix(file), semester.total_weeks);
        onAccepted(
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
      },
    });
    if (!result.ok && result.error !== null) {
      // 解析器的内部报错只进日志；界面给用户能理解的原因与下一步
      setFileFailure({ source: 'file', reason: '文件里的课表没能识别' });
    }
  }

  return {
    text,
    setText,
    busy,
    bookmarkCopied,
    pageFailure,
    mappingFailure,
    fileFailure,
    clipboardFailure,
    inspection,
    mappingOpen,
    mapHeaderRow,
    mapDayStart,
    mapDayCount,
    mapPeriodColumn,
    fileInput,
    runPage,
    copyBookmarklet,
    openMapping,
    closeMapping,
    readTables,
    applyMapping,
    setMapHeaderRow,
    setMapDayStart,
    setMapDayCount,
    setMapPeriodColumn,
    selectFile,
  };
}
