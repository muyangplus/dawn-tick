import { FileSpreadsheet, MonitorSmartphone, PencilLine, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn.ts';
import { BACKUP_IMPORT_HINT, CHANNELS, type ImportChannel } from './import-flow-model.ts';

const CHANNEL_ICONS: Record<ImportChannel, LucideIcon> = {
  paste: FileSpreadsheet,
  window: MonitorSmartphone,
  manual: PencilLine,
};

export interface ChannelStepProps {
  onPick: (channel: ImportChannel) => void;
}

/**
 * 第一步：三个渠道平铺，每张卡一句话说清「适用场景 / 产出」。
 * 手动添加是动作而不是步骤，点它由宿主打开课程表单。
 */
export function ChannelStep({ onPick }: ChannelStepProps) {
  return (
    <section className="flex flex-col gap-2" data-role="import-channels">
      <div className="grid gap-2 tablet:grid-cols-3">
        {CHANNELS.map((channel) => {
          const Icon = CHANNEL_ICONS[channel.id];
          return (
            <button
              key={channel.id}
              type="button"
              data-role="channel-card"
              data-channel={channel.id}
              onClick={() => onPick(channel.id)}
              className={cn(
                'flex min-h-tap flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-left',
                'hover:border-line-strong hover:bg-surface-muted focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-primary-strong',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                <Icon className="size-4 shrink-0 text-primary-strong" aria-hidden />
                {channel.title}
              </span>
              <span className="text-xs text-muted">{channel.scenario}</span>
              <span className="text-xs text-muted">{channel.output}</span>
              {channel.formats !== undefined && (
                <span data-role="channel-formats" className="text-[11px] text-muted">
                  {channel.formats}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">{BACKUP_IMPORT_HINT}</p>
    </section>
  );
}
