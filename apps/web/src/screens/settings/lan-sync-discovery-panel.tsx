import { Button } from '../../components/ui/button.tsx';
import {
  canDiscoverLanPeers,
  formatDiscoveryPeer,
  type LanDiscoveryPeer,
} from '../../lan-sync-discovery.ts';

export interface LanDiscoveryPanelProps {
  peers: readonly LanDiscoveryPeer[];
  discovering: boolean;
  onDiscover: () => void;
  onChoose: (peer: LanDiscoveryPeer) => void;
}

/** 发现设备：桌面 / 安卓显示可用按钮，浏览器只给手输提示。 */
export function LanDiscoveryPanel({ peers, discovering, onDiscover, onChoose }: LanDiscoveryPanelProps) {
  const supported = canDiscoverLanPeers();
  return (
    <div className="flex flex-col gap-1" data-role="lan-sync-discovery">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">发现设备</span>
        <Button
          size="sm"
          variant="secondary"
          aria-label="发现设备"
          loading={discovering}
          disabled={!supported}
          onClick={onDiscover}
        >
          扫描局域网
        </Button>
        {!supported && <span className="text-xs text-muted">浏览器端不支持自动发现，请手动填写地址</span>}
      </div>
      {peers.length > 0 && (
        <div className="flex flex-col gap-1" data-role="lan-sync-peers">
          {peers.map((peer) => (
            <button
              key={`${peer.host}:${peer.port}`}
              type="button"
              className="min-h-tap w-fit rounded-md border border-line px-3 text-left text-sm text-ink hover:bg-surface-muted"
              aria-label={`使用 ${peer.name} 的地址`}
              onClick={() => onChoose(peer)}
            >
              {formatDiscoveryPeer(peer)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
