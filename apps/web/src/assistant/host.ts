/**
 * 助手在 web 端能用的界面与平台能力。动作只依赖这个接口：真实实现见 `host-impl.ts`，测试里换成假的。
 * 每个方法返回给用户看的一句结果；失败抛错，由执行计划停下并报告。
 */
import type { AiCoreContext, AppSettings } from '@dawn-tick/core';
import type { NavId } from '../components/nav.tsx';
import type { SettingsGroupId } from '../screens/settings-group-summaries.ts';

/** 设备与同步页的分组 */
export const DEVICES_GROUP_IDS = ['storage', 'backup', 'update', 'webdav', 'lan', 'maintenance', 'about'] as const;
export type DevicesGroupId = (typeof DEVICES_GROUP_IDS)[number];

export type AssistantNavTarget =
  | { kind: 'page'; page: Exclude<NavId, 'settings' | 'devices'> }
  | { kind: 'settings'; group: SettingsGroupId | null }
  | { kind: 'devices'; group: DevicesGroupId | null }
  /** 课表跳到某天（日模式）或某天所在的一屏（周模式） */
  | { kind: 'date'; date: string; mode: 'day' | 'week' };

export interface AssistantSnapshot {
  id: string;
  /** 生成时刻（UTC ms） */
  createdAt: number;
  bytes: number;
}

export interface AssistantLanDevice {
  id: string;
  name: string;
  lastSyncAt: number | null;
}

export type AssistantLanScope = 'timetable' | 'todos' | 'settings';

export interface AssistantHost {
  settings(): AppSettings;
  /** 经现有校验写设置，并做设置页同样的后续处理（热加载、待重启等） */
  patchSettings(patch: Partial<AppSettings>): Promise<void>;
  navigate(target: AssistantNavTarget): void;
  /** 打开导入流程并把文本填进粘贴框，由用户在导入预览里确认 */
  openImport(text: string): void;
  /** 导出完整备份（JSON 文件） */
  exportBackup(): Promise<string>;
  /** 导出当前学期的日历文件 */
  exportIcs(includeEvents: boolean): Promise<string>;
  /** 导出当前学期的统计报表（CSV） */
  exportReport(): Promise<string>;
  /** 当前学期统计；没有学期返回 null */
  semesterStats(): Promise<unknown>;
  createSnapshot(): Promise<string>;
  listSnapshots(): Promise<AssistantSnapshot[]>;
  restoreSnapshot(id: string): Promise<string>;
  webdavConfigured(): boolean;
  webdavUpload(): Promise<string>;
  /** all：用远端整包覆盖本机；settings：只应用设置与预设 */
  webdavDownload(mode: 'all' | 'settings'): Promise<string>;
  lanDevices(): Promise<AssistantLanDevice[]>;
  lanSync(deviceId: string, scopes: readonly AssistantLanScope[]): Promise<string>;
  checkUpdate(): Promise<unknown>;
}

export interface AssistantContext extends AiCoreContext {
  host: AssistantHost;
}
