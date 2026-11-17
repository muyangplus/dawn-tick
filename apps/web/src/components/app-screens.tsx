import { useEffect, useState } from 'react';
import { Database, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from './ui/button.tsx';
import type { Failure } from '../lib/fail.ts';
import {
  STORAGE_FALLBACK_BADGE,
  STORAGE_FALLBACK_BANNER,
  STORAGE_READ_ONLY_MESSAGE,
} from '../db/fallback.ts';

/** 加载页的「仍在载入…」阈值：冷启动超过 3 秒才追加，避免正常启动闪一下。 */
export const LOADING_SLOW_MS = 3000;

/** 冷启动加载页：图标 + 进度文案；3 秒后追加「仍在载入…」。 */
export function LoadingScreen({ slowAfterMs = LOADING_SLOW_MS }: { slowAfterMs?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setSlow(true), slowAfterMs);
    return () => globalThis.clearTimeout(timer);
  }, [slowAfterMs]);
  return (
    <main
      className="dt-screen-in flex h-full flex-col items-center justify-center gap-3 bg-page p-4"
      role="status"
      aria-live="polite"
      data-role="loading-screen"
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-muted text-primary-strong">
        <Loader2 className="dt-spinner size-6" aria-hidden />
      </div>
      <p className="text-sm text-ink">正在载入…</p>
      {slow && (
        <p className="dt-screen-in text-xs text-muted" data-role="loading-slow">
          仍在载入…
        </p>
      )}
    </main>
  );
}

export interface ErrorScreenProps {
  kind: 'corrupt' | 'other';
  failure: Failure;
  onRetry: () => void;
  onRestore: () => void;
  onOpenBackupDir: () => void;
  onOpenLogs: () => void;
}

/** 页面级错误：图标 + 标题 + 说明 + 最多两个修复按钮（损坏走备份，其它走重试/日志）。 */
export function ErrorScreen({
  kind,
  failure,
  onRetry,
  onRestore,
  onOpenBackupDir,
  onOpenLogs,
}: ErrorScreenProps) {
  const corrupt = kind === 'corrupt';
  const Icon = corrupt ? Database : TriangleAlert;
  return (
    <main
      className="dt-screen-in flex h-full items-start justify-center overflow-y-auto overscroll-contain bg-page p-4"
      data-role="error-screen"
    >
      <div className="my-auto flex w-full max-w-md flex-col items-center gap-3 text-center" role="alert">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-danger/10 text-danger-strong">
          <Icon className="size-6" aria-hidden />
        </div>
        <h1 className="text-base font-semibold text-ink">{failure.title}</h1>
        <p className="text-sm text-muted">{failure.body}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {corrupt ? (
            <>
              <Button variant="primary" onClick={onRestore}>
                从备份文件恢复
              </Button>
              <Button variant="secondary" onClick={onOpenBackupDir}>
                打开备份目录
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" onClick={onRetry}>
                重试
              </Button>
              <Button variant="secondary" onClick={onOpenLogs}>
                打开日志
              </Button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export interface StorageFallbackBannerProps {
  onRetry: () => void;
  onOpenLogs: () => void;
}

/** 主壳顶部的临时回退警告条：常驻、首屏可见，并说明回退期间只读。 */
export function StorageFallbackBanner({ onRetry, onOpenLogs }: StorageFallbackBannerProps) {
  return (
    <div
      role="alert"
      data-role="storage-fallback-banner"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-strong"
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{STORAGE_FALLBACK_BANNER}</span>
      <span className="rounded-full bg-warning/10 px-2 py-0.5 font-medium">{STORAGE_FALLBACK_BADGE}</span>
      <span className="text-[11px]">{STORAGE_READ_ONLY_MESSAGE}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        重试
      </Button>
      <Button size="sm" variant="ghost" onClick={onOpenLogs}>
        打开日志
      </Button>
    </div>
  );
}
