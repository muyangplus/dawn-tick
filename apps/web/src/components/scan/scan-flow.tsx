import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../lib/errors.ts';
import {
  describeScanError,
  parseScannedPayload,
  scanCodeOnce,
  stopScanCode,
  type ScannedPayload,
} from '../../lib/scan.ts';
import type { PairPayload } from '../../lan-pair-payload.ts';
import { ScanOverlay } from './scan-overlay.tsx';
import { ScanResultDialog } from './scan-result-dialog.tsx';

export interface ScanFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 扫到标准配对信息：由调用方负责跳转与自动配对 */
  onPair: (payload: PairPayload) => void;
}

type ScanPhase = 'scanning' | 'result' | 'error';

/**
 * 通用扫一扫流程：打开相机 → 扫到第一条 → 按载荷类型分流。
 *
 * - 配对信息交给 `onPair`，本组件不直接跳页；
 * - 其它文本进结果面板（显示 / 复制 / 关闭）；
 * - 扫码失败保留「重新扫码」。
 */
export function ScanFlow({ open, onOpenChange, onPair }: ScanFlowProps) {
  const [phase, setPhase] = useState<ScanPhase>('scanning');
  const [result, setResult] = useState<ScannedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onPairRef = useRef(onPair);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onPairRef.current = onPair;
  }, [onPair]);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('scanning');
    setResult(null);
    setError(null);
    void (async () => {
      try {
        const text = await scanCodeOnce();
        if (cancelled) return;
        if (text === null) {
          onOpenChangeRef.current(false);
          return;
        }
        const parsed = parseScannedPayload(text);
        if (parsed.kind === 'pair') {
          onOpenChangeRef.current(false);
          onPairRef.current(parsed.payload);
          return;
        }
        setResult(parsed);
        setPhase('result');
      } catch (cause: unknown) {
        if (cancelled) return;
        setError(describeScanError(errorMessage(cause)));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
      void stopScanCode();
    };
  }, [open, attempt]);

  if (!open) return null;

  return (
    <>
      {phase === 'scanning' && (
        <ScanOverlay
          onCancel={() => {
            onOpenChangeRef.current(false);
            void stopScanCode();
          }}
        />
      )}
      <ScanResultDialog
        open={phase === 'result' || phase === 'error'}
        {...(phase === 'result' && result !== null && result.kind === 'text' ? { text: result.text } : {})}
        {...(phase === 'result' && result !== null && result.kind === 'text' && result.note !== undefined
          ? { note: result.note }
          : {})}
        {...(phase === 'error' ? { error } : {})}
        onClose={() => onOpenChangeRef.current(false)}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    </>
  );
}
