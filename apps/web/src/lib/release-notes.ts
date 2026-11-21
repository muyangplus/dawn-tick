import { baseVersion } from './changelog-section.ts';
import { compareVersions } from './update-release.ts';

export { baseVersion, changelogSection } from './changelog-section.ts';

/**
 * 更新后的「新版本内容」：构建时从 CHANGELOG.md 取当前版本那一段注入（`__DT_RELEASE_NOTES__`），
 * 启动时与上次运行的版本比较，升级后弹一次。
 */

export type ReleaseNotesAction =
  /** 弹出新版本内容，关闭后记下当前版本 */
  | 'show'
  /** 不弹，只记下当前版本（首次安装、开关关闭、没有说明） */
  | 'record'
  /** 什么都不做（版本没变） */
  | 'none';

export function releaseNotesAction(input: {
  /** 上次运行记下的版本；null 表示首次运行 */
  lastVersion: string | null;
  currentVersion: string;
  enabled: boolean;
  notes: string;
}): ReleaseNotesAction {
  const current = baseVersion(input.currentVersion);
  if (current === null) return 'none';
  const last = input.lastVersion === null ? null : baseVersion(input.lastVersion);
  if (last === null) return 'record';
  const order = compareVersions(current, last);
  if (order < 0) return 'record';
  if (order === 0) return 'none';
  return input.enabled && input.notes.trim() !== '' ? 'show' : 'record';
}

declare const __DT_RELEASE_NOTES__: string | undefined;

/** 构建时注入的当前版本说明；测试与未注入的环境为空串。 */
export function bundledReleaseNotes(): string {
  return typeof __DT_RELEASE_NOTES__ === 'string' ? __DT_RELEASE_NOTES__ : '';
}
