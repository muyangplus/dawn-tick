import { createContext } from 'react';

/**
 * 搜索命中的日程条目 id：日程时间线据此滚动到该行并高亮。
 * 由 App 在切到日程页时注入；为 null 表示没有待定位的命中。
 */
export const ScheduleFocusContext = createContext<string | null>(null);
