import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { StatusLine } from '../../components/ui/status-line.tsx';
import { ScanOverlay } from '../../components/scan/scan-overlay.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { parseScannedPayload, scanCodeOnce, stopScanCode, type ScannedPairRequest } from '../../lib/scan.ts';
import { formatPeerAddress } from '../../lan-sync-protocol.ts';
import { parsePairPayload, type PairPayload } from '../../lan-pair-payload.ts';
import { describeScanError, isScanAvailable, stopScan } from '../../lan-pair-scan.ts';
import { lanSyncPanelCopy as copy } from '../../copy/sync-lan-panel.ts';

export interface LanSyncPairPanelProps {
  busy: boolean;
  paired: boolean;
  /** 受控的对方地址与配对码：发现设备的结果会直接填入 */
  peer: string;
  code: string;
  /** 上一次配对失败的具体原因：在配对面板里保留，不静默 */
  error?: string | null;
  onPeerChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  /** 地址 / 配对码文本交给父组件校验并发起配对；`name` / `deviceId` 来自扫码或粘贴 */
  onPair: (peerText: string, codeText: string, name?: string, deviceId?: string) => void;
  /** 扫码 / 粘贴过程中的提示（父组件的状态行统一展示） */
  onNote: (text: string) => void;
  /** 通用扫一扫交来的配对请求：自动填入并发起配对，只消费一次 */
  pendingPair?: ScannedPairRequest | null;
  onPendingPairHandled?: (() => void) | undefined;
}

/**
 * 配对入口：手输地址 + 配对码 / 安卓应用内扫码 / 粘贴标准配对信息。
 *
 * 扫码与主界面的「扫一扫」共用 `lib/scan.ts` 的同一套相机与解析；扫到标准配对信息
 * 自动填入并发起配对，扫到其它文本则提示可用主界面「扫一扫」查看。
 */
export function LanSyncPairPanel({
  busy,
  paired,
  peer,
  code,
  error = null,
  onPeerChange,
  onCodeChange,
  onPair,
  onNote,
  pendingPair = null,
  onPendingPairHandled,
}: LanSyncPairPanelProps) {
  const [pasteInput, setPasteInput] = useState('');
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'failed'>('idle');
  const scanAvailable = isScanAvailable();

  // 离开页面时一定要关相机，否则预览会留在后台
  useEffect(() => {
    return () => {
      void stopScan();
    };
  }, []);

  function applyPayload(payload: PairPayload, autoPair: boolean, source: string): void {
    const peerText = formatPeerAddress({ host: payload.host, port: payload.port });
    onPeerChange(peerText);
    onCodeChange(payload.code);
    onNote(copy.filledFrom(source, peerText, payload.code));
    if (autoPair) onPair(peerText, payload.code, payload.name, payload.deviceId);
  }

  // 通用扫一扫把配对信息交进来：填入并自动配对，然后通知父组件已消费
  useEffect(() => {
    if (pendingPair === null) return;
    applyPayload(pendingPair.payload, true, copy.sourceScan);
    onPendingPairHandled?.();
    // 只在请求 id 变化时消费一次；applyPayload 随渲染重建，不放进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPair]);

  function parsePasted(): void {
    const parsed = parsePairPayload(pasteInput);
    if (!parsed.ok) {
      onNote(parsed.error);
      return;
    }
    applyPayload(parsed.payload, false, copy.sourcePaste);
  }

  async function runScan(): Promise<void> {
    setScanState('scanning');
    onNote(copy.cameraOpening);
    try {
      const text = await scanCodeOnce();
      if (text === null) {
        setScanState('idle');
        onNote(copy.scanCancelled);
        return;
      }
      const parsed = parseScannedPayload(text);
      if (parsed.kind !== 'pair') {
        setScanState('idle');
        onNote(
          parsed.note === undefined
            ? copy.scanNotPairing
            : copy.scanNotPairingWith(parsed.note),
        );
        return;
      }
      setScanState('idle');
      applyPayload(parsed.payload, true, copy.sourceScan);
    } catch (cause: unknown) {
      setScanState('failed');
      onNote(describeScanError(errorMessage(cause)));
    }
  }

  async function cancelScan(): Promise<void> {
    setScanState('idle');
    await stopScanCode();
    onNote(copy.scanCancelled);
  }

  return (
    <div className="flex flex-col gap-2" data-role="lan-sync-pair">
      <Field label={copy.peerLabel} help={copy.peerHelp}>
        <Input
          data-role="lan-sync-peer"
          aria-label={copy.peerLabel}
          value={peer}
          placeholder="192.168.1.5:8765"
          onChange={(event) => onPeerChange(event.target.value)}
        />
      </Field>
      <Field label={copy.codeLabel} hint={copy.codeHint}>
        <Input
          data-role="lan-sync-pair-code"
          aria-label={copy.codeLabel}
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => onCodeChange(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label={copy.pairButton}
          loading={busy}
          onClick={() => onPair(peer, code)}
        >
          {paired ? copy.repairButton : copy.pairButton}
        </Button>
        {scanAvailable && (
          <Button
            size="sm"
            variant="secondary"
            aria-label={copy.scanLabel}
            data-role="lan-sync-scan"
            onClick={() => void runScan()}
          >
            {copy.scanLabel}
          </Button>
        )}
        {scanState === 'failed' && (
          <Button size="sm" variant="ghost" aria-label={copy.rescanButton} onClick={() => void runScan()}>
            {copy.rescanButton}
          </Button>
        )}
      </div>
      {error !== null && error !== '' && (
        <StatusLine dataRole="lan-sync-pair-error" tone="danger">
          {error}
        </StatusLine>
      )}
      <Field label={copy.pasteLabel} hint={copy.pasteHint}>
        <Input
          data-role="lan-sync-paste"
          aria-label={copy.pasteLabel}
          value={pasteInput}
          placeholder="dawn-tick://pair?schema=1&host=192.168.1.5&port=8765&code=123456"
          onChange={(event) => setPasteInput(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" aria-label={copy.parseLabel} onClick={parsePasted}>
          {copy.parseButton}
        </Button>
        {!scanAvailable && (
          <span className="text-xs text-muted">{copy.scanAndroidOnly}</span>
        )}
      </div>
      {scanState === 'failed' && (
        <StatusLine dataRole="lan-sync-scan-error" tone="danger">
          {copy.scanFailed}
        </StatusLine>
      )}
      {scanState === 'scanning' && (
        <ScanOverlay
          onCancel={() => void cancelScan()}
          title={copy.scanLabel}
          hint={copy.scanOverlayHint}
        />
      )}
    </div>
  );
}
