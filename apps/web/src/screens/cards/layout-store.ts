import type { Storage } from '@dawn-tick/core';
import type { CardState, LayoutConfig } from './registry.ts';

/** 卡片布局存在 app_meta 里的键名 */
export const LAYOUT_META_KEY = 'ui_layout_v1';

function parseConfig(raw: string | undefined): LayoutConfig {
  if (raw === undefined || raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const config: LayoutConfig = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      const entry: CardState = {};
      if (typeof item['visible'] === 'boolean') entry.visible = item['visible'];
      if (typeof item['order'] === 'number' && Number.isFinite(item['order'])) entry.order = item['order'];
      if (item['zone'] === 'main' || item['zone'] === 'side') entry.zone = item['zone'];
      config[id] = entry;
    }
    return config;
  } catch {
    return {};
  }
}

function serialize(config: LayoutConfig): string {
  const plain: Record<string, CardState> = {};
  for (const [id, state] of Object.entries(config)) {
    const entry: CardState = {};
    if (state.visible !== undefined) entry.visible = state.visible;
    if (state.order !== undefined) entry.order = state.order;
    if (state.zone !== undefined) entry.zone = state.zone;
    plain[id] = entry;
  }
  return JSON.stringify(plain);
}

/** 读取卡片布局配置；缺失或损坏时返回空配置（即全部用默认值） */
export async function readLayout(storage: Storage): Promise<LayoutConfig> {
  return parseConfig(await storage.readMeta(LAYOUT_META_KEY));
}

/** 写回卡片布局配置；空配置表示全部恢复默认 */
export async function writeLayout(storage: Storage, config: LayoutConfig): Promise<void> {
  await storage.writeMeta(LAYOUT_META_KEY, serialize(config));
}

/** 恢复默认：清空所有覆盖项 */
export async function resetLayout(storage: Storage): Promise<void> {
  await writeLayout(storage, {});
}
