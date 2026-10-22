import { useState } from 'react';
import type { AppSettings, Storage } from '@dawn-tick/core';
import { loadAppData } from '../../data.ts';
import { errorMessage } from '../../lib/errors.ts';
import { buildPdfFromPng } from '../../lib/pdf.ts';
import {
  buildTimetableImageModel,
  renderTimetablePng,
  timetableFileName,
  type TimetableImageModel,
} from '../../lib/timetable-image.ts';
import { fail } from '../../copy/zh.ts';
import { logWarn } from '../../log.ts';
import { saveBinaryFile } from '../../system-actions.ts';
import { Button } from '../../components/ui/button.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { toastSaved } from './file-export.ts';

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
    const what = kind === 'png' ? '导出课表图片' : '导出课表 PDF';
    setBusy(kind);
    try {
      const model = await loadWeekModel(storage, settings);
      if (model === null) {
        toast.info('还没有学期，先在设置里创建学期再导出课表');
        return;
      }
      const png = await renderTimetablePng(model);
      const bytes =
        kind === 'png'
          ? png
          : buildPdfFromPng(png, { width: model.pixelWidth, height: model.pixelHeight });
      const name = timetableFileName(model.title === '课表' ? null : model.title, kind, Date.now());
      const saved = await saveBinaryFile(
        name,
        bytes,
        kind === 'png'
          ? { extension: 'png', filterName: 'PNG 图片' }
          : { extension: 'pdf', filterName: 'PDF 文档' },
      );
      if (saved.cancelled) {
        toast.info('已取消保存');
        return;
      }
      if (!saved.ok) {
        toast.error(fail(what, saved.error, '请换一个保存位置后重试'));
        return;
      }
      toastSaved(
        kind === 'png' ? `已导出课表图片（PNG，${model.scale}x 高清）` : '已导出课表 PDF（A4 横向）',
        saved.path,
      );
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      logWarn('export', `${what}失败`, { message });
      toast.error(fail(what, message, '请重试；仍失败可先导出备份再反馈'));
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
        导出课表图片（PNG）
      </Button>
      <Button
        size="sm"
        variant="secondary"
        data-role="export-timetable-pdf"
        loading={busy === 'pdf'}
        disabled={busy !== null && busy !== 'pdf'}
        onClick={() => void run('pdf')}
      >
        导出课表 PDF
      </Button>
    </>
  );
}
