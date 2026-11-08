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
  /** 地址 / 配对码文本交给父组件校验并发起配对；`name` 来自扫码或粘贴 */
  onPair: (peerText: string, codeText: string, name?: string) => void;
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
    onNote(`已从${source}填入 ${peerText} 与配对码 ${payload.code}`);
    if (autoPair) onPair(peerText, payload.code, payload.name);
  }

  // 通用扫一扫把配对信息交进来：填入并自动配对，然后通知父组件已消费
  useEffect(() => {
    if (pendingPair === null) return;
    applyPayload(pendingPair.payload, true, '扫码结果');
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
    applyPayload(parsed.payload, false, '粘贴内容');
  }

  async function runScan(): Promise<void> {
    setScanState('scanning');
    onNote('正在打开相机…请在取景框内对准对方屏幕上的二维码');
    try {
      const text = await scanCodeOnce();
      if (text === null) {
        setScanState('idle');
        onNote('已取消扫码');
        return;
      }
      const parsed = parseScannedPayload(text);
      if (parsed.kind !== 'pair') {
        setScanState('idle');
        onNote(
          parsed.note === undefined
            ? '扫码结果不是配对信息；可以在主界面「扫一扫」里查看或复制'
            : `扫码结果不是配对信息：${parsed.note}`,
        );
        return;
      }
      setScanState('idle');
      applyPayload(parsed.payload, true, '扫码结果');
    } catch (cause: unknown) {
      setScanState('failed');
      onNote(describeScanError(errorMessage(cause)));
    }
  }

  async function cancelScan(): Promise<void> {
    setScanState('idle');
    await stopScanCode();
    onNote('已取消扫码');
  }

  return (
    <div className="flex flex-col gap-2" data-role="lan-sync-pair">
      <Field label="对方地址" hint="与本机在同一局域网" help="填对方的局域网 IP 与端口，例如 192.168.1.5:8765">
        <Input
          data-role="lan-sync-peer"
          aria-label="对方地址"
          value={peer}
          placeholder="192.168.1.5:8765"
          onChange={(event) => onPeerChange(event.target.value)}
        />
      </Field>
      <Field label="配对码" hint="对方「开启配对」后显示的 6 位数字">
        <Input
          data-role="lan-sync-pair-code"
          aria-label="配对码"
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
          aria-label="配对"
          loading={busy}
          onClick={() => onPair(peer, code)}
        >
          {paired ? '重新配对' : '配对'}
        </Button>
        {scanAvailable && (
          <Button
            size="sm"
            variant="secondary"
            aria-label="扫码配对"
            data-role="lan-sync-scan"
            onClick={() => void runScan()}
          >
            扫码配对
          </Button>
        )}
        {scanState === 'failed' && (
          <Button size="sm" variant="ghost" aria-label="重新扫码" onClick={() => void runScan()}>
            重新扫码
          </Button>
        )}
      </div>
      {error !== null && error !== '' && (
        <StatusLine dataRole="lan-sync-pair-error" tone="danger">
          {error}
        </StatusLine>
      )}
      <Field label="粘贴配对信息" hint="链接或 IP:端口 配对码 都行">
        <Input
          data-role="lan-sync-paste"
          aria-label="粘贴配对信息"
          value={pasteInput}
          placeholder="dawn-tick://pair?schema=1&host=192.168.1.5&port=8765&code=123456"
          onChange={(event) => setPasteInput(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" aria-label="解析配对信息" onClick={parsePasted}>
          解析并填入
        </Button>
        {!scanAvailable && (
          <span className="text-xs text-muted">扫码配对仅安卓版可用；可以粘贴对方复制的配对信息</span>
        )}
      </div>
      {scanState === 'failed' && (
        <StatusLine dataRole="lan-sync-scan-error" tone="danger">
          扫码没有成功，可以点「重新扫码」再试，或改用粘贴配对信息。
        </StatusLine>
      )}
      {scanState === 'scanning' && (
        <ScanOverlay
          onCancel={() => void cancelScan()}
          title="扫码配对"
          hint="将对方屏幕上的二维码放入取景框"
        />
      )}
    </div>
  );
}
