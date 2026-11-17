import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

/**
 * 反馈双轨（P1-05）的「持续状态」通道：
 * 动作结果走 toast，只留一次；卡内固定状态行走这里，带 live region，可回看。
 */
export type StatusTone = 'muted' | 'success' | 'danger';

/** 一条可回看的状态：文案 + 上一次操作时间（毫秒）。 */
export interface StatusMessage {
  text: string;
  at?: number;
  tone?: StatusTone;
}

export interface StatusLineProps {
  children: ReactNode;
  /** 上一次操作时间：给出时追加「· HH:mm」，让状态能对应到哪次操作 */
  at?: number | null | undefined;
  tone?: StatusTone;
  /** 行内动作按钮，例如「去系统设置」「去开启」 */
  action?: ReactNode;
  dataRole?: string;
  className?: string;
}

const TONE: Record<StatusTone, string> = {
  muted: 'text-muted',
  success: 'text-success-strong',
  danger: 'text-danger-strong',
};

/** 状态时间只到分钟：同一天内的多次操作也足够区分。 */
export function statusTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function StatusLine({
  children,
  at,
  tone = 'muted',
  action,
  dataRole = 'status-line',
  className,
}: StatusLineProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      data-role={dataRole}
      className={cn('flex min-w-0 flex-wrap items-center gap-2 text-xs', TONE[tone], className)}
    >
      <span className="min-w-0 break-words">{children}</span>
      {at !== null && at !== undefined && (
        <span className="tabular shrink-0 opacity-80" data-role="status-time">
          · {statusTime(at)}
        </span>
      )}
      {action}
    </span>
  );
}
