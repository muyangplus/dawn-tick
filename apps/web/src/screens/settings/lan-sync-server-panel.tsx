import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
  lanNetworkEmptyHint,
  shouldShowLanNetworkDiagnostics,
  type LanNetwork,
  type LanNetworkStatus,
} from '../../lan-sync-network.ts';
import { formatPairPayload, formatPairingText } from '../../lan-pair-payload.ts';
import type { LanServerInfo } from '../../lan-sync.ts';
import type { Pairing, TrustedToken } from '../../lan-sync-protocol.ts';
import { LanSyncQrCode } from './lan-sync-qr-code.tsx';
import { lanSyncPanelCopy as copy } from '../../copy/sync-lan-panel.ts';
import { HelpLink } from '../../components/help-link.tsx';

export interface LanSyncServerPanelProps {
  server: LanServerInfo | null;
  pairing: Pairing | null;
  /** 服务端已授权设备（只含哈希）；界面只显示数量 */
  tokens: readonly TrustedToken[];
  networks: readonly LanNetwork[];
  selectedHost: string | null;
  /** Android 上始终显示网络行：即使没有候选也给出空态与刷新 */
  alwaysShowNetwork?: boolean;
  /** 原生报告的当前网络状态（Wi-Fi / 有线 / 移动数据 / VPN）；null 表示原生层没提供 */
  networkStatus?: LanNetworkStatus | null;
  /** 读取网络失败的可读原因；有值时显示在刷新按钮下方 */
  networkError?: string | null;
  /** 上一次开启失败：按钮文案改成「重试」 */
  failed: boolean;
  busy: boolean;
  /** 二维码与复制信息里的展示名 */
  deviceName: string;
  /** 本机稳定设备 id：二维码与复制信息带上，对方据此写配对记录 */
  deviceId?: string;
  onStart: () => void;
  onStop: () => void;
  onNewCode: () => void;
  onChangeNetwork: (address: string) => void;
  /** 重新枚举本机网络（Wi-Fi / 热点切换后无需退出页面） */
  onRefreshNetworks?: (() => void) | undefined;
  /** 复制网络诊断（父组件负责剪贴板与提示）：不含配对码 / 令牌 */
  onCopyDiagnostics?: (() => void) | undefined;
  onCopy: () => void;
}

/**
 * 局域网同步的服务端面板：网络选择、开/停配对、二维码、人类可读配对信息。
 *
 * 二维码内容使用标准链接（`apps/web/src/lan-pair-payload.ts`），下方同时显示
 * `IP:端口 配对码` 人类可读文本；复制按钮复制标准链接，便于粘贴到另一端。
 *
 * Android 上网络行始终存在：候选为空时按原生 `status` 给出能照做的空态——
 * 有 Wi-Fi / 有线但没有 IPv4 提示重新连接或检查 DHCP；只有移动数据提示先连同一 Wi-Fi；
 * 其余情况保留「未发现局域网地址」并附网卡摘要；旁边可复制诊断信息。
 * 刷新按钮始终在，Wi-Fi / 热点切换后不用退出页面。
 */
export function LanSyncServerPanel({
  server,
  pairing,
  tokens,
  networks,
  selectedHost,
  alwaysShowNetwork = false,
  networkStatus = null,
  networkError = null,
  failed,
  busy,
  deviceName,
  deviceId,
  onStart,
  onStop,
  onNewCode,
  onChangeNetwork,
  onRefreshNetworks,
  onCopyDiagnostics,
  onCopy,
}: LanSyncServerPanelProps) {
  const [refreshing, setRefreshing] = useState(false);
  const lanCandidates = networks.filter((network) => network.isLan);
  const selectedNetwork: LanNetwork | null =
    networks.find((network) => selectedHost !== null && network.address === selectedHost) ??
    defaultLanNetwork(networks);
  const showNetwork = alwaysShowNetwork || selectedNetwork !== null;
  const showSelect = lanCandidates.length > 0 && (alwaysShowNetwork || lanCandidates.length > 1);
  /** 空态文案按原生状态区分：没连 / 只有移动数据 / 有 Wi-Fi 但没有 IPv4。 */
  const emptyHint = lanNetworkEmptyHint(networkStatus);
  const showDiagnostics = shouldShowLanNetworkDiagnostics(networkStatus);
  const payload =
    server !== null && pairing !== null
      ? formatPairPayload({
          host: server.host,
          port: server.port,
          code: pairing.code,
          name: deviceName,
          ...(deviceId === undefined ? {} : { deviceId }),
        })
      : '';
  const humanText =
    server !== null && pairing !== null
      ? formatPairingText({ host: server.host, port: server.port, code: pairing.code })
      : '';

  async function refresh(): Promise<void> {
    if (onRefreshNetworks === undefined) return;
    setRefreshing(true);
    try {
      onRefreshNetworks();
    } finally {
      // 枚举是异步的；这里只防连点，结果由父组件状态行展示
      window.setTimeout(() => setRefreshing(false), 400);
    }
  }

  return (
    <div className="flex flex-col gap-1" data-role="lan-sync-server">
      {showNetwork && (
        <div className="flex flex-col gap-1" data-role="lan-sync-network">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted" data-role="lan-sync-network-line">
              {selectedNetwork !== null ? formatLanNetworkLine(selectedNetwork) : copy.networkNone}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={copy.refreshNetworkLabel}
              data-role="lan-sync-network-refresh"
              loading={refreshing}
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {copy.refreshNetworkButton}
            </Button>
          </div>
          {networkError !== null && networkError !== '' && (
            <span className="text-xs text-danger-strong" data-role="lan-sync-network-error">
              {copy.networkReadFailed(networkError)}
            </span>
          )}
          {showSelect && selectedNetwork !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">{copy.switchNetwork}</span>
              <Select value={selectedNetwork.address} onValueChange={onChangeNetwork} disabled={busy}>
                <SelectTrigger aria-label={copy.switchNetwork} data-role="lan-sync-network-select" className="max-w-60">
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
          {lanCandidates.length === 0 && (
            <div className="flex flex-col gap-1" data-role="lan-sync-network-empty-block">
              <span className="text-xs text-muted" data-role="lan-sync-network-empty">
                {emptyHint}
              </span>
              {showDiagnostics && networkStatus !== null && (
                <span
                  className="break-all text-xs text-muted"
                  data-role="lan-sync-network-diagnostics"
                >
                  {copy.diagnostics(networkStatus.interfaceSummary)}
                </span>
              )}
              {onCopyDiagnostics !== undefined && (
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={copy.copyDiagnostics}
                    data-role="lan-sync-network-copy-diagnostics"
                    onClick={onCopyDiagnostics}
                  >
                    {copy.copyDiagnostics}
                  </Button>
                </div>
              )}
              <HelpLink entryId="lan-network" />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label={failed ? copy.retryStartLabel : copy.startLabel}
          loading={busy}
          disabled={server !== null}
          onClick={onStart}
        >
          {failed ? copy.retryButton : copy.startButton}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={copy.stopLabel}
          disabled={server === null}
          onClick={onStop}
        >
          {copy.stopButton}
        </Button>
      </div>
      {server !== null && (
        <span className="text-xs text-muted" data-role="lan-sync-address">
          {copy.localAddress(server.address)}
        </span>
      )}
      {pairing !== null && (
        <span className="text-sm text-ink" data-role="lan-sync-code">
          {copy.pairCode(pairing.code)}
        </span>
      )}
      {server !== null && pairing !== null && (
        <div className="flex flex-wrap items-start gap-3" data-role="lan-sync-pairing-info">
          <LanSyncQrCode text={payload} />
          <div className="flex max-w-60 flex-col gap-1">
            <Button size="sm" variant="ghost" aria-label={copy.copyPairing} onClick={onCopy}>
              {copy.copyPairing}
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
              ? copy.waitingPeer
              : copy.grantedDevices(tokens.length)}
          </span>
          <Button size="sm" variant="ghost" aria-label={copy.newCodeLabel} onClick={onNewCode}>
            {copy.newCodeButton}
          </Button>
        </div>
      )}
    </div>
  );
}
