import type { StatusMessage } from '../../components/ui/status-line.tsx';

/** 状态行统一带时间：动作结果另走 toast，这里留可回看的「上一次操作」。 */
export function said(text: string): StatusMessage {
  return { text, at: Date.now() };
}

/** 快照大小的可读文案。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
