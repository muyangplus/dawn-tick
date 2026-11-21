import { Field } from '../../components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SwitchField,
} from '../../components/ui/controls.tsx';
import { StatusLine } from '../../components/ui/status-line.tsx';
import {
  LAN_AUTO_MODE_LABEL,
  type LanAutoConfig,
  type LanAutoMode,
} from '../../lan-sync-auto.ts';
import { lanSyncPanelCopy as copy } from '../../copy/sync-lan-panel.ts';

export interface LanAutoPanelProps {
  config: LanAutoConfig;
  note: string | null;
  onChange: (mode: LanAutoMode) => void;
}

/** 自动同步：开关 + 频率（每次启动 / 每 30 分钟）+ 最近一次结果。 */
export function LanAutoPanel({ config, note, onChange }: LanAutoPanelProps) {
  return (
    <>
      <SwitchField
        label={copy.autoTitle}
        description={copy.autoDescription}
        checked={config.mode !== 'off'}
        onCheckedChange={(checked) => onChange(checked ? 'startup' : 'off')}
        ariaLabel={copy.autoTitle}
        dataRole="lan-sync-auto"
      />
      {config.mode !== 'off' && (
        <Field label={copy.autoFrequency} help={copy.autoFrequencyHelp}>
          <Select value={config.mode} onValueChange={(value) => onChange(value as LanAutoMode)}>
            <SelectTrigger aria-label={copy.autoFrequency}>
              <span>{LAN_AUTO_MODE_LABEL[config.mode]}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="startup">{LAN_AUTO_MODE_LABEL.startup}</SelectItem>
              <SelectItem value="interval30">{LAN_AUTO_MODE_LABEL.interval30}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
      {note !== null && <StatusLine dataRole="lan-sync-auto-status">{note}</StatusLine>}
    </>
  );
}
