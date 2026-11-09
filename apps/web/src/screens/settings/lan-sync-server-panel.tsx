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
              {selectedNetwork !== null ? formatLanNetworkLine(selectedNetwork) : '网络：未发现局域网地址'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="刷新本机网络"
              data-role="lan-sync-network-refresh"
              loading={refreshing}
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              刷新
            </Button>
          </div>
          {networkError !== null && networkError !== '' && (
            <span className="text-xs text-danger-strong" data-role="lan-sync-network-error">
              读取本机网络失败：{networkError}
            </span>
          )}
          {showSelect && selectedNetwork !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">切换网络</span>
              <Select value={selectedNetwork.address} onValueChange={onChangeNetwork} disabled={busy}>
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
                  诊断信息：{networkStatus.interfaceSummary}
                </span>
              )}
              {onCopyDiagnostics !== undefined && (
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="复制诊断信息"
                    data-role="lan-sync-network-copy-diagnostics"
                    onClick={onCopyDiagnostics}
                  >
                    复制诊断信息
                  </Button>
                </div>
              )}
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
              二维码是标准配对链接；对方可以在安卓上用「扫一扫」直接识别，也可以复制下面的信息发过去。
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
