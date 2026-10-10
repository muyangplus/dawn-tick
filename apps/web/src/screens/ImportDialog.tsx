import { useRef, useState } from 'react';
import {
  applyImport,
  exportIcs,
  icsToSchedules,
  listCourses,
  listSchedules,
  listTimeSlots,
  loadSemester,
  parseCsv,
  parseIcs,
  parseTimetableMatrix,
  type ImportedSchedule,
  type Storage,
} from '@dawn-tick/core';

interface Props {
  storage: Storage;
  semesterId: string;
  onDone: () => void;
}

interface Preview {
  schedules: ImportedSchedule[];
  warnings: string[];
  source: string;
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
      row.eachCell({ includeEmpty: true }, (cell) => {
        values.push(cell.text ?? String(cell.value ?? ''));
      });
      rows.push(values);
    });
    return rows;
  }
  return parseCsv(await file.text());
}

export function ImportDialog({ storage, semesterId, onDone }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const semester = await loadSemester(storage, semesterId);
      if (semester === undefined) throw new Error('学期不存在');
      const timeSlots = await listTimeSlots(storage, semesterId);

      if (file.name.toLowerCase().endsWith('.ics')) {
        const calendar = parseIcs(await file.text());
        const converted = icsToSchedules(
          calendar,
          {
            id: semester.id,
            start_date: semester.start_date,
            total_weeks: semester.total_weeks,
            time_zone: semester.time_zone,
          },
          timeSlots.map((slot) => ({ period_no: slot.period_no, start_time: slot.start_time, end_time: slot.end_time })),
        );
        setPreview({ ...converted, source: `${calendar.events.length} 个日程` });
      } else {
        const parsed = parseTimetableMatrix(await readMatrix(file), semester.total_weeks);
        setPreview({
          schedules: parsed.slots.map((slot) => ({
            courseName: slot.name,
            dayOfWeek: slot.dayOfWeek,
            periodStart: slot.periodStart,
            periodEnd: slot.periodEnd,
            weeks: slot.weeks ?? Array.from({ length: semester.total_weeks }, (_, index) => index + 1),
            room: slot.room,
            teacher: slot.teacher,
          })),
          warnings: parsed.warnings,
          source: `${parsed.slots.length} 个课程格`,
        });
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (preview === null) return;
    setBusy(true);
    try {
      const applied = await applyImport(storage, semesterId, preview.schedules);
      setResult(
        `新增课程 ${applied.createdCourses} · 新增排课 ${applied.createdSchedules} · 跳过重复 ${applied.skippedSchedules}`,
      );
      setPreview(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function exportCurrent(): Promise<void> {
    setBusy(true);
    try {
      const semester = await loadSemester(storage, semesterId);
      if (semester === undefined) throw new Error('学期不存在');
      const [courses, schedules, timeSlots] = await Promise.all([
        listCourses(storage, semesterId),
        listSchedules(storage, semesterId),
        listTimeSlots(storage, semesterId),
      ]);
      const text = exportIcs({
        semester: {
          id: semester.id,
          start_date: semester.start_date,
          total_weeks: semester.total_weeks,
          time_zone: semester.time_zone,
        },
        courses: courses.map((course) => ({
          id: course.id,
          name: course.name,
          short_name: course.short_name,
          teacher: course.teacher,
          location: course.location,
        })),
        schedules: schedules.map((schedule) => ({
          id: schedule.id,
          course_id: schedule.course_id,
          day_of_week: schedule.day_of_week,
          period_start: schedule.period_start,
          period_end: schedule.period_end,
          weeks_mask: schedule.weeks_mask,
          room: schedule.room,
        })),
        timeSlots: timeSlots.map((slot) => ({
          period_no: slot.period_no,
          start_time: slot.start_time,
          end_time: slot.end_time,
        })),
        calendarName: semester.name,
      });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${semester.name}.ics`;
      anchor.click();
      URL.revokeObjectURL(url);
      setResult('已导出 ICS');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onDone}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <strong>导入课表</strong>
        <div className="muted">支持 .ics / .csv / .xlsx，或先导出当前课表</div>
        <input
          ref={fileInput}
          type="file"
          accept=".ics,.csv,.xlsx,.txt"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void prepare(file);
          }}
        />
        <div className="row">
          <button type="button" onClick={() => void exportCurrent()} disabled={busy}>
            导出 ICS
          </button>
        </div>

        {preview !== null && (
          <div className="list">
            <div className="muted">
              解析到 {preview.source}，可导入 {preview.schedules.length} 条
            </div>
            {preview.schedules.slice(0, 5).map((item, index) => (
              <div key={`${item.courseName}-${index}`} className="muted">
                {item.courseName} · 周{item.dayOfWeek} 第 {item.periodStart}-{item.periodEnd} 节 · {item.weeks.length} 周
              </div>
            ))}
            {preview.warnings.length > 0 && <p className="error">{preview.warnings.join('；')}</p>}
            <div className="row">
              <button type="button" className="primary" disabled={busy} onClick={() => void confirm()}>
                确认导入
              </button>
            </div>
          </div>
        )}

        {result !== null && <div className="muted">{result}</div>}
        {error !== null && <p className="error">{error}</p>}
        <div className="row">
          <button type="button" onClick={onDone}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
