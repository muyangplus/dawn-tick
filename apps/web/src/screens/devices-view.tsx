import { useEffect, useState, type ReactNode } from 'react';
import { LayoutGrid } from 'lucide-react';
import type { AppSettings, Storage } from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { CollapsibleCard } from '../components/ui/collapsible-card.tsx';
import { cn } from '../lib/cn.ts';
import { rememberCollapsed } from '../lib/collapse-store.ts';
import { CardLayoutDialog } from './cards/layout-panel.tsx';
import { readLayout } from './cards/layout-store.ts';
import { cardsInZone, type LayoutConfig, type ResolvedCard } from './cards/registry.ts';
import { devicesSection } from './cards/devices-cards.tsx';
import { AboutCard } from './settings/about-card.tsx';
import { DataCard } from './settings/data-card.tsx';
import { MaintenanceCard } from './settings/maintenance-card.tsx';
import { ExportDialog, ImportDialog } from './settings/transfer-dialogs.tsx';
import { useUpdateCheck } from './settings/use-update-check.ts';

export interface DevicesViewProps {
  storage: Storage;
  settings: AppSettings;
  /** 浏览器持久化权限：已申请 / 已授权 / 未授权 */
  persistent: boolean | null;
  /** 存储类型的可读文案，如 IndexedDB / SQLite */
  storageKind: string;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  onChanged: () => void;
  /** 从库外写入设置后（如 WebDAV 只应用设置）重新读取设置并热加载 */
  onSettingsReplaced: () => Promise<void>;
}

/**
 * 设备与同步页：只留布局、卡片注册表与页级弹窗外壳。
 *
 * 三张卡片（存储与同步 / 更新与维护 / 关于）各自在 `screens/settings/` 下独立成组件，
 * 顶部快捷动作与卡片共用「检查更新」状态，导出/导入对话框由页面挂载。
 */
export function DevicesView({
  storage,
  settings,
  persistent,
  storageKind,
  onPatch,
  onChanged,
  onSettingsReplaced,
}: DevicesViewProps) {
  /** 版本检查：顶部快捷动作与更新与维护卡共用同一份进行中状态 */
  const update = useUpdateCheck(settings);
  const [layout, setLayout] = useState<LayoutConfig>({});
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /** 设备页顶部快捷动作「恢复快照」：重挂卡片以按最新收起状态渲染 */
  const [cardEpoch, setCardEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await readLayout(storage);
      if (!cancelled) setLayout(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const bodies: Record<string, ReactNode> = {
    data: (
      <DataCard
        storage={storage}
        settings={settings}
        persistent={persistent}
        storageKind={storageKind}
        onPatch={onPatch}
        onChanged={onChanged}
        onSettingsReplaced={onSettingsReplaced}
        onOpenExport={() => setExportOpen(true)}
        onOpenImport={() => setImportOpen(true)}
      />
    ),

    maintenance: (
      <MaintenanceCard storage={storage} settings={settings} onPatch={onPatch} update={update} />
    ),

    about: <AboutCard />,
  };

  /** 设备与同步页卡片：主列在上、侧列在右；侧列由顶部「卡片布局」切换，没有侧列时不占宽度。 */
  const mainCards = cardsInZone('devices', layout, 'main');
  const sideCards = cardsInZone('devices', layout, 'side');
  /** 两列只在主列与侧列都有卡片时生效：全部卡片都切到侧列时，侧列自己占满整行（P2-07） */
  const twoColumn = mainCards.length > 0 && sideCards.length > 0;

  const renderCard = (card: ResolvedCard): ReactNode => {
    const body = bodies[card.def.id];
    if (body === undefined) return null;
    const section = devicesSection(card.def.id);
    return (
      <CollapsibleCard
        key={`${card.def.id}-${cardEpoch}`}
        id={card.def.id}
        title={card.def.title}
        {...(section === undefined ? {} : { icon: section.icon })}
      >
        {body}
      </CollapsibleCard>
    );
  };

  return (
    <div className="flex flex-col gap-3" data-role="devices-view" aria-label="设备与同步">
      {/* 数据类快捷动作固定在顶部，与设置页的导入课表分开，避免两处重复入口 */}
      <div className="flex flex-wrap items-center gap-2" data-role="devices-actions">
        <Button size="sm" variant="secondary" onClick={() => setExportOpen(true)}>
          导出备份
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            rememberCollapsed('data', false);
            setCardEpoch((value) => value + 1);
          }}
        >
          恢复快照
        </Button>
        <Button size="sm" variant="secondary" loading={update.busy} onClick={() => void update.run()}>
          检查更新
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-role="devices-toolbar">
        <Button
          size="sm"
          variant="secondary"
          aria-label="卡片布局"
          onClick={() => setLayoutOpen(true)}
        >
          <LayoutGrid className="size-4" aria-hidden />
          卡片布局
        </Button>
        <span className="text-xs text-muted">显示 / 隐藏卡片、调顺序与主侧列</span>
      </div>

      {/* P2-07：侧列只在有卡片时生效（desktop 两列 2fr/1fr），否则主列占满整行 */}
      <div
        className={cn('grid items-start gap-3', twoColumn && 'desktop:grid-cols-[2fr_1fr]')}
        data-role="devices-grid"
      >
        <div className="flex min-w-0 flex-col gap-3" data-role="devices-main">
          {mainCards.map(renderCard)}
        </div>
        {sideCards.length > 0 && (
          <aside
            className="flex min-w-0 flex-col gap-3"
            data-role="devices-side"
            aria-label="设备与同步侧栏"
          >
            {sideCards.map(renderCard)}
          </aside>
        )}
      </div>

      <CardLayoutDialog
        open={layoutOpen}
        onOpenChange={setLayoutOpen}
        layout={layout}
        onChange={setLayout}
        storage={storage}
      />

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} storage={storage} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} storage={storage} onChanged={onChanged} />
    </div>
  );
}
