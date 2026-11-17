/**
 * 课程取色板与语义标识色的唯一来源。
 *
 * 色值与 `docs/04-界面与文案规范.md` 的「青春活力」课程色板一致；
 * 界面层（`apps/web/src/design/tokens.ts`）引用这里，core 不反向依赖界面。
 */

/** 默认课程取色板：固定 12 色，按课程创建顺序取下一色，第 13 门起循环。 */
export const DEFAULT_COURSE_COLORS: readonly string[] = [
  '#FF6B4A', '#FF9F43', '#FFD93D', '#6BCB77', '#2ED573', '#17C3B2',
  '#4D96FF', '#6C5CE7', '#B15CFF', '#FF6FB5', '#FF8FA3', '#8D6E63',
];

/** 兜底课程色：取色板越界或历史数据缺色时使用（与极简墨色色板首色同值的蓝）。 */
export const DEFAULT_COURSE_COLOR = '#4F8DFD';

/** 非课程（课外）实验块的标识色。 */
export const LAB_COLOR = '#8E7CC3';

/** 考试块的标识色。 */
export const EXAM_COLOR = '#E08A3C';
