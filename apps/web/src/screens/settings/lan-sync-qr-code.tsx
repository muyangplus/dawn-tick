import { qrMatrix } from '../../lan-sync-qr.ts';

export interface LanSyncQrCodeProps {
  text: string;
  /** 视觉边长（像素）；SVG 内部用模块坐标，缩放不糊 */
  size?: number;
}

/**
 * 配对二维码：只负责把纯函数生成的矩阵画成 SVG。
 *
 * 不做扫码、不调相机；对方用系统相机或扫码应用读出「IP:端口 配对码」后手动输入。
 */
export function LanSyncQrCode({ text, size = 148 }: LanSyncQrCodeProps) {
  const matrix = qrMatrix(text);
  const modules = matrix.length;
  // 静区留 3 个模块（再叠加容器 padding），扫码端才能稳定识别
  const margin = 3;
  const path = matrix
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x},${y}h1v1h-1z` : '')).join(''))
    .join('');
  return (
    <div className="w-fit rounded-md bg-white p-2" data-role="lan-sync-qr">
      <svg
        role="img"
        aria-label="配对二维码"
        width={size}
        height={size}
        viewBox={`-${margin} -${margin} ${modules + margin * 2} ${modules + margin * 2}`}
        shapeRendering="crispEdges"
      >
        <rect
          x={-margin}
          y={-margin}
          width={modules + margin * 2}
          height={modules + margin * 2}
          fill="#ffffff"
        />
        <path d={path} fill="#000000" />
      </svg>
    </div>
  );
}
