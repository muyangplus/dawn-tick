import { ScanLine } from 'lucide-react';
import { Button } from '../ui/button.tsx';

/**
 * 顶部工具区的通用「扫一扫」图标按钮（仅 Android 原生渲染，由调用方判断）。
 * 与微信扫一扫同类的工具入口：不只服务配对，识别到的其它内容走结果面板。
 */
export function ScanEntryButton({ onScan }: { onScan: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="扫一扫"
      data-role="scan-entry"
      onClick={onScan}
    >
      <ScanLine className="size-4" aria-hidden />
    </Button>
  );
}
