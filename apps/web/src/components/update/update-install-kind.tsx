import type { UpdatePlatform } from '../../lib/update-download.ts';
import {
  useDetectedWindowsInstallKind,
  windowsInstallKindLabel,
} from '../../lib/update-install.ts';

export interface UpdateInstallKindLineProps {
  platform: UpdatePlatform;
  className?: string;
}

/**
 * 显示检测到的 Windows 运行形态（「便携版 / 安装版」）。
 * 检测由 `lib/update-install.ts` 缓存并发起，弹窗与设备页读到同一份结果；
 * 非 Windows 渠道不渲染任何内容。
 */
export function UpdateInstallKindLine({ platform, className = 'text-xs text-muted' }: UpdateInstallKindLineProps) {
  const kind = useDetectedWindowsInstallKind(platform);
  if (platform !== 'windows') return null;
  return (
    <span className={className} data-role="update-install-kind">
      版本类型：{windowsInstallKindLabel(kind)}
    </span>
  );
}
