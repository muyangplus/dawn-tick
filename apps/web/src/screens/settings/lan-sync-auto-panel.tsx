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
        label="自动同步"
        description="每次启动 / 每 30 分钟；范围沿用上面的勾选"
        checked={config.mode !== 'off'}
        onCheckedChange={(checked) => onChange(checked ? 'startup' : 'off')}
        ariaLabel="自动同步"
        dataRole="lan-sync-auto"
      />
      {config.mode !== 'off' && (
        <Field label="自动同步频率" hint="失败静默重试一次并记日志">
          <Select value={config.mode} onValueChange={(value) => onChange(value as LanAutoMode)}>
            <SelectTrigger aria-label="自动同步频率">
              <span>{LAN_AUTO_MODE_LABEL[config.mode]}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="startup">每次启动</SelectItem>
              <SelectItem value="interval30">每 30 分钟</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
      {config.mode !== 'off' && (
        <span className="text-xs text-muted">自动同步使用当前配对会话；重启或令牌过期后需重新配对。</span>
      )}
      {note !== null && <StatusLine dataRole="lan-sync-auto-status">{note}</StatusLine>}
    </>
  );
}
