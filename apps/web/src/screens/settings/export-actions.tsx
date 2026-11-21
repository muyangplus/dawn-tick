import { useState } from 'react';
import type { AppSettings, Storage } from '@dawn-tick/core';
import { loadAppData } from '../../data.ts';
import { errorMessage } from '../../lib/errors.ts';
import { isCorruptDatabase } from '../../db/health.ts';
import { EXPORT_CORRUPT_MESSAGE } from '../../db/corrupt-guard.ts';
import { buildPdfFromPng } from '../../lib/pdf.ts';
import {
  buildTimetableImageModel,
  renderTimetablePng,
  timetableFileName,
  type TimetableImageModel,
} from '../../lib/timetable-image.ts';
import { fail } from '../../copy/common.ts';
import { logError } from '../../log.ts';
import { saveBinaryFile } from '../../system-actions.ts';
import { Button } from '../../components/ui/button.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { saveText, toastSaved } from './file-export.ts';
import { exportActiveShare, shareFileName } from '../../lib/share-file.ts';
import { transferCopy as copy } from '../../copy/backup-transfer.ts';
import { exportImageCopy } from '../../copy/export-image.ts';

/**
 * 设备页顶部的课表图片 / PDF 导出（分享与呈现）。
 *
 * 数据口径：当前视图周（`weekStartDate` 周一开头，列数/隐藏周末沿用视图设置），
 * 先重载一份以周一为窗口起点的 `AppData`，再交给 `lib/timetable-image.ts` 生成模型；
 * 保存沿用 `saveBinaryFile`（桌面弹保存框、Android 落盘、浏览器下载），
 * 失败时给「原因 + 下一步」，成功沿用带路径与「打开所在位置」的 toast。
 */

export interface TimetableExportActionsProps {
  storage: Storage;
  settings: AppSettings;
}

type ExportKind = 'png' | 'pdf';

/** 取当前视图周的数据：显式从周一重载，保证整周列齐全（默认窗口可能从今天开始）。 */
async function loadWeekModel(storage: Storage, settings: AppSettings): Promise<TimetableImageModel | null> {
  const current = await loadAppData(storage, settings);
  if (current.semester === null) return null;
  const start = current.weekStartDate;
  const data =
    current.windowStart === start
      ? current
      : await loadAppData(storage, settings, { windowStart: start });
  return buildTimetableImageModel({ data, settings, weekStart: data.windowDates[0] ?? start });
}

export function TimetableExportActions({ storage, settings }: TimetableExportActionsProps) {
  const [busy, setBusy] = useState<ExportKind | null>(null);

  async function run(kind: ExportKind): Promise<void> {
    if (busy !== null) return;
    const what = kind === 'png' ? copy.exportImageWhat : copy.exportPdfWhat;
    setBusy(kind);
    try {
      const model = await loadWeekModel(storage, settings);
      if (model === null) {
        toast.info(copy.noSemesterExport);
        return;
      }
      const png = await renderTimetablePng(model);
      const bytes =
        kind === 'png'
          ? png
          : buildPdfFromPng(png, { width: model.pixelWidth, height: model.pixelHeight });
      const name = timetableFileName(model.title === exportImageCopy.fallbackTitle ? null : model.title, kind, Date.now());
      const saved = await saveBinaryFile(
        name,
        bytes,
        kind === 'png'
          ? { extension: 'png', filterName: copy.pngFilter }
          : { extension: 'pdf', filterName: copy.pdfFilter },
      );
      if (saved.cancelled) {
        toast.info(copy.saveCancelled);
        return;
      }
      if (!saved.ok) {
        toast.error(fail(what, saved.error, copy.imageSaveNext));
        return;
      }
      toastSaved(
        kind === 'png' ? copy.imageExported(model.scale) : copy.pdfExported,
        saved.path,
      );
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      logError('backup', '导出失败', { what, message });
      const corrupt = isCorruptDatabase(cause);
      toast.error(corrupt ? fail(what, EXPORT_CORRUPT_MESSAGE) : fail(what, message, copy.retryNext));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        data-role="export-timetable-png"
        loading={busy === 'png'}
        disabled={busy !== null && busy !== 'png'}
        onClick={() => void run('png')}
      >
        {copy.exportImageButton}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        data-role="export-timetable-pdf"
        loading={busy === 'pdf'}
        disabled={busy !== null && busy !== 'pdf'}
        onClick={() => void run('pdf')}
      >
        {copy.exportPdfButton}
      </Button>
    </>
  );
}

/** 只读课表分享文件：当前学期的节次、课程与排课，对方从「导入备份」导入为新学期。 */
export function ShareExportAction({ storage }: { storage: Storage }) {
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    setBusy(true);
    try {
      const now = Date.now();
      const exported = await exportActiveShare(storage, now);
      if (exported === null) {
        toast.info(copy.noSemesterExport);
        return;
      }
      const result = await saveText(shareFileName(now), exported.text, 'json', copy.shareFileFilter, 'application/json');
      if (result.saved) toastSaved(copy.shareExported(exported.semesterName), result.path);
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      logError('backup', '课表分享文件导出失败', { message });
      toast.error(fail(copy.shareExportWhat, message, copy.retryNext));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="secondary" data-role="export-share" loading={busy} onClick={() => void run()}>
      {copy.shareButton}
    </Button>
  );
}
