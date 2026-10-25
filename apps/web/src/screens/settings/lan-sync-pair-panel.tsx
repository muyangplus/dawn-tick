import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { StatusLine } from '../../components/ui/status-line.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { formatPeerAddress } from '../../lan-sync-protocol.ts';
import {
  parsePairPayload,
  type PairPayload,
} from '../../lan-pair-payload.ts';
import {
  describeScanError,
  isScanAvailable,
  scanPairPayload,
  stopScan,
} from '../../lan-pair-scan.ts';

export interface LanSyncPairPanelProps {
  busy: boolean;
  paired: boolean;
  /** 受控的对方地址与配对码：发现设备的结果会直接填入 */
  peer: string;
  code: string;
  onPeerChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  /** 地址 / 配对码文本交给父组件校验并发起配对；`name` 来自扫码或粘贴 */
  onPair: (peerText: string, codeText: string, name?: string) => void;
  /** 扫码 / 粘贴过程中的提示（父组件的状态行统一展示） */
  onNote: (text: string) => void;
}

/**
 * 配对入口：手输地址 + 配对码 / 安卓应用内扫码 / 粘贴标准配对信息。
 *
 * 扫码使用 `@capacitor-mlkit/barcode-scanning` 的相机预览（WebView 后方），本组件画一层
 * 透明覆盖层做提示与取消；解析与自动填入复用 `lan-pair-payload.ts` 的同一套格式。
 */
export function LanSyncPairPanel({
  busy,
  paired,
  peer,
  code,
  onPeerChange,
  onCodeChange,
  onPair,
  onNote,
}: LanSyncPairPanelProps) {
  const [pasteInput, setPasteInput] = useState('');
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'failed'>('idle');
  const scanAvailable = isScanAvailable();
  /** 覆盖层挂到 body：扫码时把 #root 隐藏，相机预览才能从 WebView 后面透出来 */
  const [scanHost] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : document.createElement('div'),
  );

  useEffect(() => {
    if (scanHost === null) return;
    scanHost.setAttribute('data-role', 'lan-sync-scan-host');
    document.body.append(scanHost);
    return () => {
      scanHost.remove();
    };
  }, [scanHost]);

  // 开始扫码时透明化页面背景并隐藏主界面；结束时原样恢复
  useEffect(() => {
    if (scanState !== 'scanning' || scanHost === null) return;
    const root = document.getElementById('root');
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      html: html.style.background,
      body: body.style.background,
      root: root?.style.visibility ?? '',
    };
    html.style.background = 'transparent';
    body.style.background = 'transparent';
    if (root !== null) root.style.visibility = 'hidden';
    return () => {
      html.style.background = previous.html;
      body.style.background = previous.body;
      if (root !== null) root.style.visibility = previous.root;
    };
  }, [scanState, scanHost]);

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
      const text = await scanPairPayload();
      if (text === null) {
        setScanState('idle');
        onNote('已取消扫码');
        return;
      }
      const parsed = parsePairPayload(text);
      if (!parsed.ok) {
        setScanState('failed');
        onNote(`扫码结果无法识别：${parsed.error}`);
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
    await stopScan();
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
      {scanState === 'scanning' &&
        scanHost !== null &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-transparent p-4"
            data-role="lan-sync-scan-overlay"
            role="dialog"
            aria-label="扫码配对"
            aria-modal="true"
          >
            <div className="mt-10 rounded-md bg-black/60 px-3 py-2 text-sm text-white">
              将对方屏幕上的二维码放入取景框
            </div>
            <div className="mb-6 flex w-full max-w-xs flex-col items-center gap-2 rounded-md bg-black/60 p-3">
              <span className="text-center text-xs text-white">
                扫到第一条二维码会自动停止并填入地址与配对码
              </span>
              <Button size="sm" variant="secondary" aria-label="取消扫码" onClick={() => void cancelScan()}>
                取消扫码
              </Button>
            </div>
          </div>,
          scanHost,
        )}
    </div>
  );
}
