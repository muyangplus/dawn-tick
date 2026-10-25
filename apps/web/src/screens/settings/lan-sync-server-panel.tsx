import { Button } from '../../components/ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '../../components/ui/controls.tsx';
import {
  defaultLanNetwork,
  formatLanNetworkLabel,
  formatLanNetworkLine,
  type LanNetwork,
} from '../../lan-sync-network.ts';
import { formatPairPayload, formatPairingText } from '../../lan-pair-payload.ts';
import type { LanServerInfo } from '../../lan-sync.ts';
import type { Pairing, TrustedToken } from '../../lan-sync-protocol.ts';
import { LanSyncQrCode } from './lan-sync-qr-code.tsx';

export interface LanSyncServerPanelProps {
  server: LanServerInfo | null;
  pairing: Pairing | null;
  /** 服务端已授权设备（只含哈希）；界面只显示数量 */
  tokens: readonly TrustedToken[];
  networks: readonly LanNetwork[];
  selectedHost: string | null;
  /** 上一次开启失败：按钮文案改成「重试」 */
  failed: boolean;
  busy: boolean;
  /** 二维码与复制信息里的展示名 */
  deviceName: string;
  onStart: () => void;
  onStop: () => void;
  onNewCode: () => void;
  onChangeNetwork: (address: string) => void;
  onCopy: () => void;
}

/**
 * 局域网同步的服务端面板：网络选择、开/停配对、二维码、人类可读配对信息。
 *
 * 二维码内容使用标准链接（`apps/web/src/lan-pair-payload.ts`），下方同时显示
 * `IP:端口 配对码` 人类可读文本；复制按钮复制标准链接，便于粘贴到另一端。
 */
export function LanSyncServerPanel({
  server,
  pairing,
  tokens,
  networks,
  selectedHost,
  failed,
  busy,
  deviceName,
  onStart,
  onStop,
  onNewCode,
  onChangeNetwork,
  onCopy,
}: LanSyncServerPanelProps) {
  const lanCandidates = networks.filter((network) => network.isLan);
  const selectedNetwork: LanNetwork | null =
    networks.find((network) => selectedHost !== null && network.address === selectedHost) ??
    defaultLanNetwork(networks);
  const payload =
    server !== null && pairing !== null
      ? formatPairPayload({
          host: server.host,
          port: server.port,
          code: pairing.code,
          name: deviceName,
        })
      : '';
  const humanText =
    server !== null && pairing !== null
      ? formatPairingText({ host: server.host, port: server.port, code: pairing.code })
      : '';

  return (
    <div className="flex flex-col gap-1" data-role="lan-sync-server">
      {selectedNetwork !== null && (
        <div className="flex flex-col gap-1" data-role="lan-sync-network">
          <span className="text-xs text-muted" data-role="lan-sync-network-line">
            {formatLanNetworkLine(selectedNetwork)}
          </span>
          {lanCandidates.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">切换网络</span>
              <Select
                value={selectedNetwork.address}
                onValueChange={onChangeNetwork}
                disabled={busy}
              >
                <SelectTrigger aria-label="切换网络" data-role="lan-sync-network-select" className="max-w-60">
                  <span>{formatLanNetworkLabel(selectedNetwork)}</span>
                </SelectTrigger>
                <SelectContent>
                  {lanCandidates.map((network) => (
                    <SelectItem key={network.address} value={network.address}>
                      {formatLanNetworkLabel(network)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label={failed ? '重试开启局域网配对' : '开启局域网配对'}
          loading={busy}
          disabled={server !== null}
          onClick={onStart}
        >
          {failed ? '重试' : '开启配对'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="停止局域网配对"
          disabled={server === null}
          onClick={onStop}
        >
          停止配对
        </Button>
      </div>
      {server !== null && (
        <span className="text-xs text-muted" data-role="lan-sync-address">
          本机地址：{server.address}
        </span>
      )}
      {pairing !== null && (
        <span className="text-sm text-ink" data-role="lan-sync-code">
          配对码：{pairing.code}（5 分钟内有效）
        </span>
      )}
      {server !== null && pairing !== null && (
        <div className="flex flex-wrap items-start gap-3" data-role="lan-sync-pairing-info">
          <LanSyncQrCode text={payload} />
          <div className="flex max-w-60 flex-col gap-1">
            <span className="text-xs text-muted">
              二维码是标准配对链接；对方可以在安卓上用「扫码配对」直接识别，也可以复制下面的信息发过去。
            </span>
            <Button size="sm" variant="ghost" aria-label="复制配对信息" onClick={onCopy}>
              复制配对信息
            </Button>
            <span className="break-all text-xs text-muted" data-role="lan-sync-pairing-text">
              {humanText}
            </span>
            <span className="break-all text-xs text-muted" data-role="lan-sync-pairing-link">
              {payload}
            </span>
          </div>
        </div>
      )}
      {server !== null && pairing === null && (
        <div className="flex flex-wrap items-center gap-2" data-role="lan-sync-granted">
          <span className="text-xs text-muted">
            {tokens.length === 0
              ? '等待对方请求…'
              : `已有 ${tokens.length} 台设备可长期连接；要添加新设备请生成新配对码`}
          </span>
          <Button size="sm" variant="ghost" aria-label="生成新配对码" onClick={onNewCode}>
            新配对码
          </Button>
        </div>
      )}
    </div>
  );
}
