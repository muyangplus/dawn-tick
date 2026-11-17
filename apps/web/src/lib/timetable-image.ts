import { WEEKDAY_LABELS, addDays, dayOfWeek, isWeekend, weekOfDate, type AppSettings } from '@dawn-tick/core';
import type { AppData, LessonCell } from '../data.ts';
import {
  FONT_FAMILY,
  PRESETS,
  courseTextOn,
  courseTint,
  resolveTokens,
  type ColorTokens,
} from '../design/tokens.ts';
import { mix } from '../design/contrast.ts';
import { formatMonthDayRange } from './dates.ts';
import { encodePngRgb } from './png.ts';

/**
 * 课表图片导出（PNG）：先把「整周课表」算成纯数据模型，再交给 Canvas 2D 绘制。
 *
 * - 模型只读 `AppData` + `AppSettings`，不含时间与随机数，Node 里可直接断言；
 * - 绘制只用矩形、线、文字等基础图元，不引 html2canvas；
 * - 始终按浅色主题渲染（便于打印与分享），深色主题下也输出浅色；
 * - PNG 编码在 `lib/png.ts`（RGB、filter 0、zlib/Flate + CRC32），浏览器与 Node 同一份实现。
 */

export const TIMETABLE_IMAGE_SCALE = 2;
export const TIMETABLE_IMAGE_WIDTH = 1200;
const PADDING = 36;
const TITLE_HEIGHT = 46;
const SUBTITLE_HEIGHT = 24;
const HEADER_HEIGHT = 56;
const ROW_HEIGHT = 66;
const AXIS_WIDTH = 72;
const FOOTER_HEIGHT = 34;
const CARD_INSET = 4;
const EMPTY_GRID_HEIGHT = 300;

export interface TimetableImageColumn {
  date: string; weekdayLabel: string; dateLabel: string; isToday: boolean;
  holidayName: string | null; x: number; width: number;
}

export interface TimetableImageRow {
  periodNo: number; startTime: string; endTime: string; y: number; height: number;
}

export interface TimetableImageCard {
  key: string; name: string; room: string; teacher: string; timeLabel: string; status: string;
  color: string; tint: string; textColor: string; dashed: boolean; muted: boolean;
  x: number; y: number; width: number; height: number;
}

export interface TimetableImageLayout {
  padding: number;
  axisWidth: number;
  headerHeight: number;
  rowHeight: number;
  tableTop: number;
  gridTop: number;
  gridHeight: number;
  footerTop: number;
}

export interface TimetableImageModel {
  width: number;
  height: number;
  /** 输出倍数：按 2x DPR 出图像素 */
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
  title: string;
  subtitle: string;
  footer: string;
  empty: boolean;
  emptyText: string;
  columns: TimetableImageColumn[];
  rows: TimetableImageRow[];
  cards: TimetableImageCard[];
  layout: TimetableImageLayout;
  tokens: ColorTokens;
}

/** 导出的列日期：从 weekStart 起按视图天数取，跳过周末，与课表窗口口径一致。 */
function windowDates(weekStartDate: string, settings: AppSettings): string[] {
  const days = Math.max(1, Math.min(7, settings.viewDays));
  const dates: string[] = [];
  for (let offset = 0; dates.length < days && offset < days * 3 + 7; offset += 1) {
    const date = addDays(weekStartDate, offset);
    if (settings.hideWeekends && isWeekend(date)) continue;
    dates.push(date);
  }
  return dates;
}

/** 非法的课程色值退回主题主色，避免导入数据里的脏色值让整页绘制失败。 */
function safeColor(color: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color.trim()) ? color.trim().toUpperCase() : fallback;
}

function statusOf(lesson: LessonCell): string {
  if (lesson.cancelled) return '停课';
  if (lesson.movedOut) return '已调课';
  if (!lesson.inWeek) return '非本周';
  if (lesson.lab) return lesson.eventLabel ?? '日程';
  return '';
}

/** 生成课表图片模型：列、节次行、课程卡与标题文案一次算清。 */
export function buildTimetableImageModel(input: {
  data: AppData;
  settings: AppSettings;
  weekStart: string;
}): TimetableImageModel {
  const { data, settings, weekStart } = input;
  const tokens = resolveTokens(settings.themePreset, 'light');
  const dates = windowDates(weekStart, settings);
  const semester = data.semester;
  const rowCount = data.slots.length;
  const columnWidth = (TIMETABLE_IMAGE_WIDTH - PADDING * 2 - AXIS_WIDTH) / Math.max(1, dates.length);
  const tableTop = PADDING + TITLE_HEIGHT + SUBTITLE_HEIGHT + 10;
  const gridTop = tableTop + HEADER_HEIGHT;
  const gridHeight = rowCount === 0 ? EMPTY_GRID_HEIGHT : rowCount * ROW_HEIGHT;
  const footerTop = gridTop + gridHeight + 22;
  const gridLeft = PADDING + AXIS_WIDTH;
  const height = footerTop + FOOTER_HEIGHT + PADDING;
  const columns: TimetableImageColumn[] = dates.map((date, index) => ({
    date,
    weekdayLabel: WEEKDAY_LABELS[dayOfWeek(date) - 1] ?? '',
    dateLabel: formatMonthDayRange(date),
    isToday: date === data.today,
    holidayName: data.holidayLabels.get(date) ?? null,
    x: gridLeft + index * columnWidth,
    width: columnWidth,
  }));
  const rows: TimetableImageRow[] = data.slots.map((slot, index) => ({
    periodNo: slot.period_no,
    startTime: slot.start_time,
    endTime: slot.end_time,
    y: gridTop + index * ROW_HEIGHT,
    height: ROW_HEIGHT,
  }));
  const lessons = [...data.grid.values()]
    .flat()
    .filter((lesson) => dates.includes(lesson.date) && (lesson.inWeek || settings.showOtherWeeks))
    .sort((left, right) => left.date.localeCompare(right.date) || left.periodStart - right.periodStart);
  const cards: TimetableImageCard[] = [];
  for (const lesson of lessons) {
    const index = dates.indexOf(lesson.date);
    if (index < 0 || rowCount === 0 || lesson.periodStart > rowCount) continue;
    const start = Math.max(1, Math.min(rowCount, lesson.periodStart));
    const end = Math.max(start, Math.min(rowCount, lesson.periodEnd));
    const color = safeColor(lesson.color, tokens.primary);
    const tint = courseTint(tokens.surface, color, 0.18);
    const custom = lesson.customStart !== null && lesson.customStart !== undefined;
    const clock = custom && lesson.customEnd !== null && lesson.customEnd !== undefined
      ? `${lesson.customStart}–${lesson.customEnd}`
      : lesson.startTime === '' || lesson.endTime === ''
        ? ''
        : `${lesson.startTime}–${lesson.endTime}`;
    cards.push({
      key: `${lesson.scheduleId}-${lesson.periodStart}-${lesson.date}`,
      name: lesson.name,
      room: lesson.room ?? '',
      teacher: lesson.teacher ?? '',
      timeLabel: clock,
      status: statusOf(lesson),
      color,
      tint,
      textColor: courseTextOn(tint),
      dashed: lesson.cancelled || lesson.movedOut || !lesson.inWeek,
      muted: lesson.cancelled || lesson.movedOut || lesson.holiday || !lesson.inWeek,
      x: (columns[index] as TimetableImageColumn).x + CARD_INSET,
      y: gridTop + (start - 1) * ROW_HEIGHT + CARD_INSET,
      width: Math.max(0, columnWidth - CARD_INSET * 2),
      height: Math.max(24, (end - start + 1) * ROW_HEIGHT - CARD_INSET * 2),
    });
  }
  const weeks = semester === null ? [] : dates.map((date) => weekOfDate(date, semester.start_date));
  const firstWeek = weeks.length === 0 ? null : Math.max(1, weeks[0] as number);
  const lastWeek = weeks.length === 0
    ? null
    : Math.min(semester?.total_weeks ?? Number.MAX_SAFE_INTEGER, Math.max(...weeks));
  const dateRange = formatMonthDayRange(dates[0] ?? weekStart, dates[dates.length - 1] ?? weekStart);
  const weekLabel = firstWeek === null || lastWeek === null
    ? null
    : firstWeek === lastWeek
      ? `第 ${firstWeek} 周`
      : `第 ${firstWeek}–${lastWeek} 周`;
  return {
    width: TIMETABLE_IMAGE_WIDTH,
    height,
    scale: TIMETABLE_IMAGE_SCALE,
    pixelWidth: TIMETABLE_IMAGE_WIDTH * TIMETABLE_IMAGE_SCALE,
    pixelHeight: height * TIMETABLE_IMAGE_SCALE,
    title: semester?.name ?? '课表',
    subtitle: weekLabel === null ? '还没有设置学期' : `${weekLabel} · ${dateRange}`,
    footer: `晓刻 DawnTick · 浅色主题 · ${PRESETS[settings.themePreset].label}`,
    empty: cards.length === 0,
    emptyText: semester === null ? '还没有学期，先创建学期再导出课表' : '这周没有课程',
    columns,
    rows,
    cards,
    layout: {
      padding: PADDING,
      axisWidth: AXIS_WIDTH,
      headerHeight: HEADER_HEIGHT,
      rowHeight: ROW_HEIGHT,
      tableTop,
      gridTop,
      gridHeight,
      footerTop,
    },
    tokens,
  };
}

/** 可注入的 canvas：Node 测试用它断言绘制调用与 2x 像素尺寸。 */
export interface TimetableCanvas {
  width: number;
  height: number;
  getContext(contextId: '2d'): CanvasRenderingContext2D | null;
}

export type TimetableCanvasFactory = (pixelWidth: number, pixelHeight: number) => TimetableCanvas | null;

function defaultCanvasFactory(pixelWidth: number, pixelHeight: number): TimetableCanvas | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  return canvas;
}

function fitText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(value).width <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, width: number, height: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

/** 统一文字入口：基线固定 middle，减少绘制分支。 */
function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  bold = false,
  maxWidth?: number,
): void {
  ctx.fillStyle = color;
  ctx.font = `${bold ? 600 : 400} ${size}px ${FONT_FAMILY}`;
  ctx.textAlign = align;
  ctx.fillText(maxWidth === undefined ? value : fitText(ctx, value, maxWidth), x, y);
}

function drawTimetable(ctx: CanvasRenderingContext2D, model: TimetableImageModel): void {
  const { tokens, layout, width } = model;
  const left = layout.padding;
  const right = width - layout.padding;
  const tableWidth = right - left;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = tokens.bg;
  ctx.fillRect(0, 0, width, model.height);

  rect(ctx, tokens.primary, left, layout.padding + 2, 6, 36);
  text(ctx, model.title, left + 18, layout.padding + 22, 28, tokens.text, 'left', true, tableWidth - 24);
  text(ctx, model.subtitle, left + 18, layout.padding + 54, 14, tokens.muted);

  // 表头：节次列 + 每天的星期与日期（今天高亮，放假标「假」）
  rect(ctx, tokens.surfaceMuted, left, layout.tableTop, layout.axisWidth, layout.headerHeight);
  text(ctx, '节次', left + layout.axisWidth / 2, layout.tableTop + layout.headerHeight / 2, 12, tokens.muted, 'center');
  for (const column of model.columns) {
    rect(
      ctx,
      column.isToday ? courseTint(tokens.surface, tokens.primary, 0.1) : tokens.surface,
      column.x,
      layout.tableTop,
      column.width,
      layout.headerHeight,
    );
    const center = column.x + column.width / 2;
    text(ctx, column.weekdayLabel, center, layout.tableTop + 20, 13, column.isToday ? tokens.primaryStrong : tokens.text, 'center', true);
    const holiday = column.holidayName === null ? '' : ' 假';
    text(
      ctx,
      `${column.dateLabel}${holiday}`,
      center,
      layout.tableTop + 40,
      11,
      column.holidayName === null ? tokens.muted : tokens.warningStrong,
      'center',
    );
  }

  // 网格底、节次轴与分隔线
  rect(ctx, tokens.surface, left, layout.gridTop, tableWidth, layout.gridHeight);
  rect(ctx, tokens.surfaceMuted, left, layout.gridTop, layout.axisWidth, layout.gridHeight);
  ctx.strokeStyle = tokens.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of [left, left + layout.axisWidth, right, ...model.columns.map((column) => column.x)]) {
    ctx.moveTo(x, layout.gridTop);
    ctx.lineTo(x, layout.gridTop + layout.gridHeight);
  }
  for (const y of [layout.gridTop, layout.gridTop + layout.gridHeight]) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();

  // 节次行：编号 + 起止时间，行线贯穿整个表格
  for (const row of model.rows) {
    ctx.strokeStyle = tokens.border;
    ctx.beginPath();
    ctx.moveTo(left, row.y);
    ctx.lineTo(right, row.y);
    ctx.stroke();
    text(ctx, String(row.periodNo), left + layout.axisWidth / 2, row.y + 22, 13, tokens.text, 'center', true);
    if (row.startTime !== '' && row.endTime !== '') {
      text(ctx, `${row.startTime}–${row.endTime}`, left + layout.axisWidth / 2, row.y + 44, 9, tokens.muted, 'center');
    }
  }

  // 课程卡：课程色条 + 主题混色底 + 名称 / 地点 / 时间；停课、调课与非本周用虚线
  for (const card of model.cards) {
    rect(ctx, card.muted ? tokens.surfaceMuted : card.tint, card.x, card.y, card.width, card.height);
    rect(ctx, card.muted ? tokens.muted : card.color, card.x, card.y, 5, card.height);
    ctx.strokeStyle = card.muted ? tokens.borderStrong : tokens.border;
    ctx.lineWidth = 1;
    ctx.setLineDash(card.dashed ? [4, 3] : []);
    ctx.strokeRect(card.x + 0.5, card.y + 0.5, card.width - 1, card.height - 1);
    ctx.setLineDash([]);
    const textColor = card.muted ? tokens.muted : card.textColor;
    const textLeft = card.x + 12;
    text(ctx, card.name, textLeft, card.y + 20, 14, textColor, 'left', true, card.width - 20);
    if (card.status !== '') {
      text(ctx, card.status, card.x + card.width - 8, card.y + 14, 9, tokens.muted, 'right');
    }
    const detail = card.room !== '' ? card.room : card.teacher;
    if (card.height >= 42 && detail !== '') {
      text(ctx, detail, textLeft, card.y + 35, 10, mix(textColor, card.tint, 0.15), 'left', false, card.width - 20);
    }
    if (card.height >= 54 && card.timeLabel !== '') {
      text(ctx, card.timeLabel, textLeft, card.y + 49, 9, mix(textColor, card.tint, 0.15), 'left', false, card.width - 20);
    }
  }

  if (model.empty) {
    text(
      ctx,
      model.emptyText,
      left + layout.axisWidth + (tableWidth - layout.axisWidth) / 2,
      layout.gridTop + layout.gridHeight / 2,
      18,
      tokens.muted,
      'center',
    );
  }
  text(ctx, model.footer, left, layout.footerTop + 20, 11, tokens.muted);
}

/** 画布绘制并按 2x 像素读取，直接编码成 PNG 字节。 */
export async function renderTimetablePng(
  model: TimetableImageModel,
  options: { canvasFactory?: TimetableCanvasFactory } = {},
): Promise<Uint8Array> {
  const canvas = (options.canvasFactory ?? defaultCanvasFactory)(model.pixelWidth, model.pixelHeight);
  if (canvas === null) throw new Error('当前环境不支持 Canvas，无法导出图片');
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('当前环境不支持 Canvas 2D，无法导出图片');
  ctx.scale(model.scale, model.scale);
  drawTimetable(ctx, model);
  const image = ctx.getImageData(0, 0, model.pixelWidth, model.pixelHeight);
  return encodePngRgb(image.data, model.pixelWidth, model.pixelHeight);
}


/** 文件名：DawnTick-<学期名>-<UTC 日期>.<扩展名>，学期名去掉文件系统保留字符。 */
export function timetableFileName(semesterName: string | null, extension: 'png' | 'pdf', stamp: number): string {
  const safe = (semesterName ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const day = new Date(stamp).toISOString().slice(0, 10);
  return `DawnTick-${safe.length === 0 ? '课表' : safe}-${day}.${extension}`;
}
