import { qrMatrix } from '../../lan-sync-qr.ts';

export interface LanSyncQrCodeProps {
  text: string;
  /** 视觉边长（像素）；SVG 内部用模块坐标，缩放不糊 */
  size?: number;
}

/**
 * 配对二维码：只负责把纯函数生成的矩阵画成 SVG。
 *
 * 内容过长（例如设备名特别长）时退回一段可读提示，不抛错中断整个设备页；
 * 人类可读文本与「复制配对信息」仍在下方可用。扫码在安卓端由相机完成。
 */
export function LanSyncQrCode({ text, size = 148 }: LanSyncQrCodeProps) {
  let matrix: boolean[][];
  try {
    matrix = qrMatrix(text);
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : '二维码生成失败';
    return (
      <div className="w-fit max-w-56 rounded-md border border-line p-2 text-xs text-muted" data-role="lan-sync-qr-error">
        {message}；请改用「复制配对信息」。
      </div>
    );
  }
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
