import type { AppSettings } from '@dawn-tick/core';
import { Upload } from 'lucide-react';
import { CHANNEL, featureVisible } from '../../channel.ts';
import { canUseWidget } from '../../lib/capabilities.ts';
import { useAction } from '../../lib/action.ts';
import { Button } from '../../components/ui/button.tsx';
import { exportLogs, showLogDirectory } from './file-export.ts';

export interface TransferBlockProps {
  settings: AppSettings;
  /** 导出/导入对话框由设备页挂载（顶部快捷动作也要打开导出），这里只发开关意图 */
  onOpenExport: () => void;
  onOpenImport: () => void;
}

/**
 * 导出导入块：导出备份、导入备份，以及诊断日志的导出与目录定位。
 *
 * 对话框本体在设备页（页级弹窗外壳）；本块只放卡内入口与诊断日志动作。
 */
export function TransferBlock({ settings, onOpenExport, onOpenImport }: TransferBlockProps) {
  const logAction = useAction();
  /** 诊断入口：dev/beta 可见；dev 关掉开发者特性后与正式版一致地隐藏 */
  const diagnosticsVisible = featureVisible('diagnostics') && (CHANNEL !== 'dev' || settings.devFeatures);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={onOpenExport}>
        导出备份
      </Button>
      <Button size="sm" variant="secondary" aria-label="导入备份" onClick={onOpenImport}>
        <Upload className="size-4" aria-hidden />
        导入备份
      </Button>
      {diagnosticsVisible && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void logAction.run({ scope: 'log', label: '正在导出日志…', task: exportLogs })}
        >
          导出日志
        </Button>
      )}
      {canUseWidget() && diagnosticsVisible && (
        <Button size="sm" variant="secondary" onClick={() => void showLogDirectory()}>
          打开日志文件所在目录
        </Button>
      )}
    </div>
  );
}
