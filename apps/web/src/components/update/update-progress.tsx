import type { DownloadProgress } from '../../lib/update-download.ts';
import { formatByteProgress, formatDownloadDetail } from '../../lib/update-download.ts';

export interface UpdateProgressProps {
  progress: DownloadProgress | null;
  /** 容器 data-role：弹窗与设备页各用各的选择器，冒烟据此分别断言 */
  dataRole?: string;
}

/**
 * 更新进度区：百分比 + 进度条 + 速度 + 已收/总量 + 剩余时间。
 * 总长未知时只显示已下载字节，不硬凑百分比。
 */
export function UpdateProgress({ progress, dataRole = 'update-progress' }: UpdateProgressProps) {
  const percent = progress?.percent ?? null;
  const percentText = percent === null ? '已下载' : `${Math.round(percent * 100)}%`;
  const summary =
    progress === null ? '' : formatByteProgress(progress.received, progress.total, progress.percent);
  const detail = progress === null ? '' : formatDownloadDetail(progress);
  return (
    <div className="flex flex-col gap-1" data-role={dataRole}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
        <span className="tabular font-medium text-ink" data-role="update-progress-percent">
          {percentText}
        </span>
        {summary !== '' && (
          <span className="tabular text-muted" data-role="update-progress-bytes">
            {summary}
          </span>
        )}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label="下载进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? undefined : Math.round(percent * 100)}
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${Math.round((percent ?? 0) * 100)}%` }}
        />
      </div>
      {detail !== '' && (
        <span className="tabular text-xs text-muted" data-role="update-progress-detail">
          {detail}
        </span>
      )}
    </div>
  );
}
