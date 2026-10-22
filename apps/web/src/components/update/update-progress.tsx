import { StatusLine, type StatusTone } from '../ui/status-line.tsx';

/**
 * 更新进度块：进度条 + 一行状态（百分比、速度、已收/总量、剩余时间都在这行文案里）。
 * 弹窗与设备页共用，只由 `data-role` 区分选择器，避免两处各写一套进度 UI。
 */
export interface UpdateProgressProps {
  /** 0–100 */
  percent: number;
  text: string;
  /** 进度条的 data-role：弹窗用 `update-progress`，设备页用 `update-task-progress` */
  barRole: string;
  /** 文案行的 data-role：弹窗用 `update-status`，设备页用 `update-task-status` */
  statusRole: string;
  tone?: StatusTone;
}

export function UpdateProgress({ percent, text, barRole, statusRole, tone = 'muted' }: UpdateProgressProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
        data-role={barRole}
        role="progressbar"
        aria-label="更新下载进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${clamped}%` }} />
      </div>
      <StatusLine dataRole={statusRole} tone={tone}>
        {text}
      </StatusLine>
    </div>
  );
}
