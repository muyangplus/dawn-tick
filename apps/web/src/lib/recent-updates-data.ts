import changelog from '../../../../CHANGELOG.md?raw';
import { parseRecentUpdates, type RecentUpdate } from './recent-updates.ts';

/** 应用内置的近期更新：构建时把仓库根目录的 CHANGELOG.md 内联进来，离线可看。 */
export const RECENT_UPDATES: readonly RecentUpdate[] = parseRecentUpdates(changelog, 6);
