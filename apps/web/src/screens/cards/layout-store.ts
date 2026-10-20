import type { Storage } from '@dawn-tick/core';
import { readMetaJson, writeMetaJson } from '../../lib/meta.ts';
import { LAYOUT_META_KEY } from '../../lib/meta-keys.ts';
import type { CardState, LayoutConfig } from './registry.ts';

export { LAYOUT_META_KEY };

/** 解析卡片布局：只保留认识的字段，整份结构不对时返回 null 交给调用方兜底。 */
function parseConfig(value: unknown): LayoutConfig | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const config: LayoutConfig = {};
  for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const entry: CardState = {};
    if (typeof record['visible'] === 'boolean') entry.visible = record['visible'];
    if (typeof record['order'] === 'number' && Number.isFinite(record['order'])) entry.order = record['order'];
    if (record['zone'] === 'main' || record['zone'] === 'side') entry.zone = record['zone'];
    config[id] = entry;
  }
  return config;
}

/** 只留下已知字段后再交给 JSON 助手序列化。 */
function plainConfig(config: LayoutConfig): Record<string, CardState> {
  const plain: Record<string, CardState> = {};
  for (const [id, state] of Object.entries(config)) {
    const entry: CardState = {};
    if (state.visible !== undefined) entry.visible = state.visible;
    if (state.order !== undefined) entry.order = state.order;
    if (state.zone !== undefined) entry.zone = state.zone;
    plain[id] = entry;
  }
  return plain;
}

/** 读取卡片布局配置；缺失或损坏时返回空配置（即全部用默认值） */
export async function readLayout(storage: Storage): Promise<LayoutConfig> {
  return readMetaJson(storage, LAYOUT_META_KEY, { parse: parseConfig, fallback: {}, scope: 'layout' });
}

/** 写回卡片布局配置；空配置表示全部恢复默认。写入失败会记日志并抛出，由界面提示。 */
export async function writeLayout(storage: Storage, config: LayoutConfig): Promise<void> {
  await writeMetaJson(storage, LAYOUT_META_KEY, plainConfig(config), { scope: 'layout' });
}

/** 恢复默认：清空所有覆盖项 */
export async function resetLayout(storage: Storage): Promise<void> {
  await writeLayout(storage, {});
}
