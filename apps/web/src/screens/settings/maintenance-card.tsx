import { useEffect, useState } from 'react';
import { LOG_LEVELS, type AppSettings, type LogLevel, type Storage } from '@dawn-tick/core';
import { CHANNEL } from '../../channel.ts';
import {
  BUILTIN_PRESET_VERSION,
  cacheSnapshotContent,
  checkPresetUpdate,
  fetchSnapshot,
  resolvePresetSource,
  writeCachedSnapshot,
  type PresetSource,
} from '../../preset-update.ts';
import { logInfo, logWarn } from '../../log.ts';
import { resolveReceiveBeta } from '../../update.ts';
import { canUseWidget } from '../../lib/capabilities.ts';
import { readElevationStatus, requestElevation } from '../../autostart.ts';
import { registerPendingRestart } from '../../pending-restart.ts';
import { useAction } from '../../lib/action.ts';
import { fail } from '../../copy/zh.ts';
import { Button } from '../../components/ui/button.tsx';
import { ExternalLink } from '../../components/ui/external-link.tsx';
import { Dialog, DialogContent, DialogFooter } from '../../components/ui/dialog.tsx';
import { Field } from '../../components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SwitchField,
} from '../../components/ui/controls.tsx';
import { StatusLine, type StatusMessage } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { exportLogs } from './file-export.ts';
import { said } from './format.ts';
import type { UpdateCheckApi } from './use-update-check.ts';

/** 预设来源对用户只说是仓库；具体取源（raw / API）只进日志。 */
const PRESET_SOURCE_LABEL = '预设仓库（GitHub）';

/** 日志级别说明（与维护卡片文案一致）。 */
const LOG_LEVEL_HINT: Record<LogLevel, string> = {
  error: '仅严重错误',
  warn: '错误 + 警告信息',
  info: '一般操作信息（默认）',
  debug: '详细信息，包含请求/响应详情',
  trace: '全部日志，最详细',
};

export interface MaintenanceCardProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  /** 版本检查与顶部快捷动作共用一份状态 */
  update: UpdateCheckApi;
}

/**
 * 更新与维护卡：版本检查、发布页、测试版开关、诊断日志与预设仓库。
 *
 * 自己持有预设更新与运行权限的进行中状态和结果；版本检查的状态由 `useUpdateCheck` 提供，
 * 让设备页顶部的「检查更新」与本卡显示同一份进度。
 */
export function MaintenanceCard({ storage, settings, onPatch, update }: MaintenanceCardProps) {
  const presetAction = useAction();
  const logAction = useAction();
  const [presetSource, setPresetSource] = useState<PresetSource | null>(null);
  const [presetResult, setPresetResult] = useState<StatusMessage | null>(null);
  const [elevated, setElevated] = useState<boolean | null>(null);
  /** 打开「接收测试版更新」前的警告：测试版可能不稳定，确认后才写设置 */
  const [betaWarningOpen, setBetaWarningOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 缓存比内置新且哈希可信才用缓存
      const source = await resolvePresetSource(storage);
      if (!cancelled) setPresetSource(source);
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  useEffect(() => {
    if (!canUseWidget()) return;
    let cancelled = false;
    void (async () => {
      const value = await readElevationStatus();
      if (!cancelled) setElevated(value);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function requestAdmin(): Promise<void> {
    const result = await requestElevation();
    if (!result.ok) {
      toast.error(fail('提权', result.error ?? '', '请手动以管理员身份运行'));
    }
  }

  /** 检查预设更新：快照写入缓存、下次启动由 resolvePresetSource 生效；失败时界面沿用内置预设。 */
  async function runPresetCheck(): Promise<void> {
    const result = await presetAction.run({
      scope: 'preset',
      label: '正在读取预设更新…',
      log: '下载预设快照失败',
      fail: { what: '检查预设更新', next: '请稍后再试' },
      task: async () => {
        const currentVersion = presetSource?.version ?? BUILTIN_PRESET_VERSION;
        const status = await checkPresetUpdate({ cachedVersion: currentVersion });
        if (status.error !== null) {
          const message = fail('检查预设更新', status.error, '请稍后再试');
          setPresetResult(said(message));
          toast.error(message);
          logWarn('preset', '检查预设更新失败', { error: status.error, current: currentVersion });
          return;
        }
        if (!status.available || status.version === null) {
          const message = `预设已是最新（${currentVersion}）${status.source === undefined ? '' : `，来源 ${PRESET_SOURCE_LABEL}`}`;
          setPresetResult(said(message));
          toast.success(message);
          logInfo('preset', '预设已是最新', { current: currentVersion, latest: status.version, source: status.source });
          return;
        }
        const snapshot = await fetchSnapshot(status.version);
        await writeCachedSnapshot(storage, snapshot);
        // 快照是清单；正文在这一步校验后一并落盘，不合法时只记日志、下次启动回退内置。
        const content = await cacheSnapshotContent(storage, snapshot);
        if (!content.ok) {
          logWarn('preset', '预设正文校验未通过，已缓存清单但不缓存正文', {
            version: snapshot.version,
            message: content.reason ?? '未知原因',
          });
        }
        setPresetSource(await resolvePresetSource(storage));
        const message = `已下载预设 ${snapshot.version}（${snapshot.sources.timetables.length} 套作息、${snapshot.sources.systems.length} 个教务系统），下次启动生效`;
        setPresetResult(said(message));
        toast.success(message);
        // 预设要下次启动才套用：与其它待重启改动共用一条提示
        registerPendingRestart('preset-update');
        logInfo('preset', '已下载预设快照', { version: snapshot.version, hash: snapshot.hash });
      },
    });
    if (!result.ok && result.error !== null) {
      setPresetResult(said(fail('检查预设更新', result.error, '请稍后再试')));
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label="检查更新"
          loading={update.busy}
          onClick={() => void update.run()}
        >
          检查更新
        </Button>
        <ExternalLink
          dataRole="release-page-link"
          className="text-xs text-primary-strong underline"
          href="https://github.com/muyangplus/dawn-tick/releases"
          ariaLabel="打开发布页（GitHub）"
        >
          打开发布页
        </ExternalLink>
        {update.result !== null && (
          <StatusLine dataRole="update-result" at={update.result.at}>
            {update.result.text}
          </StatusLine>
        )}
      </div>
      {CHANNEL !== 'dev' ? (
        <SwitchField
          label="接收测试版更新"
          description={CHANNEL === 'beta' ? '默认开启；关闭后只收正式版' : '默认关闭；开启后还会收到测试版'}
          checked={resolveReceiveBeta(settings.receiveBeta, CHANNEL)}
          onCheckedChange={(checked) => {
            if (checked && !resolveReceiveBeta(settings.receiveBeta, CHANNEL)) {
              setBetaWarningOpen(true);
              return;
            }
            void onPatch({ receiveBeta: checked });
          }}
          ariaLabel="接收测试版更新"
        />
      ) : (
        <span className="text-xs text-muted">开发版只接收开发构建，不受此开关影响</span>
      )}
      <SwitchField
        label="自动检查版本更新"
        description="启动后自动查一次，有新版本时弹出更新信息"
        checked={settings.autoCheckUpdate}
        onCheckedChange={(checked) => void onPatch({ autoCheckUpdate: checked })}
        ariaLabel="自动检查版本更新"
      />
      {CHANNEL === 'dev' && (
        <SwitchField
          label="开发者特性"
          description="关闭后按正式版运行"
          checked={settings.devFeatures}
          onCheckedChange={(checked) => void onPatch({ devFeatures: checked })}
          ariaLabel="开发者特性"
        />
      )}

      {/* 应用诊断日志：开关控制 dawn-tick.log，级别决定门槛 */}
      <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-role="log-settings">
        <span className="text-sm font-medium text-ink">应用诊断日志</span>
        <span className="text-xs text-muted">
          写入文件的门槛
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label="打开日志"
            onClick={() => void logAction.run({ scope: 'log', label: '正在导出日志…', task: exportLogs })}
          >
            打开日志
          </Button>
          <span className="text-xs text-muted">导出当前缓冲区</span>
        </div>
        <SwitchField
          label="启用应用诊断日志"
          checked={settings.logEnabled}
          onCheckedChange={(checked) => void onPatch({ logEnabled: checked })}
          ariaLabel="启用应用诊断日志"
        />
        <Field label="日志级别" hint="设置输出的最低日志级别">
          <Select value={settings.logLevel} onValueChange={(value) => void onPatch({ logLevel: value as LogLevel })}>
            <SelectTrigger aria-label="日志级别">
              <span>{settings.logLevel}</span>
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level} · {LOG_LEVEL_HINT[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <span className="flex min-h-tap flex-wrap items-center gap-2 text-xs text-muted">
        <span>预设仓库</span>
        <ExternalLink
          dataRole="preset-repo-link"
          className="text-primary-strong underline"
          href="https://github.com/muyangplus/dawn-tick-presets"
          ariaLabel="打开预设仓库（GitHub）"
        >
          GitHub
        </ExternalLink>
        <StatusLine dataRole="preset-version">
          预设版本：
          {presetSource === null
            ? '读取中…'
            : `${presetSource.version}（${presetSource.kind === 'cached' ? '已更新' : '内置'}）`}
        </StatusLine>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label="检查预设更新"
          loading={presetAction.busy}
          onClick={() => void runPresetCheck()}
        >
          检查预设更新
        </Button>
        {presetResult !== null && (
          <StatusLine dataRole="preset-result" at={presetResult.at}>
            {presetResult.text}
          </StatusLine>
        )}
      </div>
      {canUseWidget() && (
        <div className="flex flex-wrap items-center gap-2">
          <StatusLine dataRole="elevation-status">
            运行权限：{elevated === null ? '读取中…' : elevated ? '管理员' : '普通用户'}
          </StatusLine>
          <Button
            size="sm"
            variant="secondary"
            aria-label="以管理员身份重新启动"
            disabled={elevated !== false}
            onClick={() => void requestAdmin()}
          >
            以管理员身份重新启动
          </Button>
        </div>
      )}
      <span className="text-xs text-muted">只在应用内检查版本</span>
      <Dialog open={betaWarningOpen} onOpenChange={setBetaWarningOpen}>
        <DialogContent
          title="开启测试版更新？"
          description="测试版会先于正式版收到改动，可能包含未完成或不稳定的功能；出问题时可在「应用诊断日志」里导出日志反馈。"
          data-role="beta-warning-dialog"
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBetaWarningOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setBetaWarningOpen(false);
                void onPatch({ receiveBeta: true });
              }}
            >
              仍要开启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
