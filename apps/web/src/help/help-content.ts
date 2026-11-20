/**
 * 帮助模块的数据类型与过滤函数；条目正文在 `copy/help.ts`，这里转导出。
 * 图标在 `help-view.tsx` 里按 `icon` 映射，单测可在 Node 下直接导入本文件。
 */
import { HELP_CATEGORIES } from '../copy/help.ts';

export { HELP_CATEGORIES };

export type HelpIconId = 'update' | 'lan' | 'backup' | 'import' | 'widget' | 'notify' | 'storage' | 'about' | 'schedule';

/** 「去设置」目标：pages 与 App 的 NavId 对齐，group 与分组导航的 data-group 对齐。 */
export interface HelpTarget {
  page: 'settings' | 'devices';
  group: string;
  /** 按钮文案里的目标分组名，例如「更新」「局域网同步」 */
  label: string;
}

export interface HelpEntry {
  id: string;
  title: string;
  /** 一句话说明：列表里直接可见 */
  summary: string;
  /** 搜索关键词：覆盖同义说法与常见报错 */
  keywords: readonly string[];
  /** 有序步骤：展开后按 1/2/3 显示 */
  steps: readonly string[];
  /** 可选的「去设置」目标 */
  goTo?: HelpTarget;
}

export interface HelpCategory {
  id: string;
  title: string;
  description: string;
  icon: HelpIconId;
  entries: readonly HelpEntry[];
}

/** 全部条目数：界面用来展示「共 N 条」。 */
export const HELP_ENTRY_COUNT = HELP_CATEGORIES.reduce((total, category) => total + category.entries.length, 0);

export interface HelpSearchResult {
  /** 过滤后的分类（只保留还有条目的分类） */
  categories: readonly HelpCategory[];
  /** 命中条目总数 */
  total: number;
}

/** 一条条目参与搜索的全部文本：标题、一句话说明、关键词、步骤与分类名。 */
function searchText(category: HelpCategory, entry: HelpEntry): string {
  return [category.title, entry.title, entry.summary, entry.keywords.join(' '), entry.steps.join(' ')]
    .join(' ')
    .toLowerCase();
}

/**
 * 按标题、关键词与正文过滤帮助内容。
 * 空查询返回全部分类；没有命中时返回空分类与 total=0（界面据此显示空态）。
 */
export function searchHelp(query: string): HelpSearchResult {
  const needle = query.trim().toLowerCase();
  if (needle === '') return { categories: HELP_CATEGORIES, total: HELP_ENTRY_COUNT };
  const categories: HelpCategory[] = [];
  let total = 0;
  for (const category of HELP_CATEGORIES) {
    const entries = category.entries.filter((entry) => searchText(category, entry).includes(needle));
    if (entries.length === 0) continue;
    categories.push({ ...category, entries });
    total += entries.length;
  }
  return { categories, total };
}

/** 通过 id 取条目：冒烟与单测用它核对「去设置」目标，不依赖数组顺序。 */
export function findHelpEntry(id: string): HelpEntry | null {
  for (const category of HELP_CATEGORIES) {
    const entry = category.entries.find((item) => item.id === id);
    if (entry !== undefined) return entry;
  }
  return null;
}
