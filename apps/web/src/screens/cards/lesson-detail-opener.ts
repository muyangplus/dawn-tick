import { createContext } from 'react';
import type { AdjustTarget } from '../../components/adjust-dialog.tsx';

/** 打开课程详情的桥：日程卡片上下文里没有，由 App 用 Provider 注入；没有 Provider 时点击不响应。 */
export const LessonDetailOpener = createContext<((target: AdjustTarget) => void) | null>(null);
