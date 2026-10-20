import type { ReactNode } from 'react';
import type { EventRow, Storage } from '@dawn-tick/core';
import type { AppData } from '../../data.ts';
import type { AdjustTarget } from '../../components/adjust-dialog.tsx';

/** 卡片所在页面 */
export type CardScope = 'schedule' | 'settings' | 'devices';
/** 卡片所在区域：主列 / 侧列 */
export type CardZone = 'main' | 'side';

/** 用户可自定义的程度：显示隐藏、顺序、所在区域 */
export interface CardState {
  visible?: boolean;
  order?: number;
  zone?: CardZone;
}

/** 用户布局配置：卡片 id → 覆盖项；缺省即用注册表默认值 */
export type LayoutConfig = Record<string, CardState>;

/** 日程页卡片的渲染上下文 */
export interface ScheduleCardContext {
  scope: 'schedule';
  data: AppData;
  storage: Storage;
  /** 卡片布局配置与写回入口 */
  layout: LayoutConfig;
  onLayoutChange: (layout: LayoutConfig) => void;
  /** 当前查看的日期与切换 */
  viewDate: string;
  onViewDateChange: (date: string) => void;
  /** 打开「加日程 / 加考试」表单 */
  onAddTodo: () => void;
  onAddExam: () => void;
  /** 单击时间线里的日程：进入详情编辑 */
  onOpenEvent: (event: EventRow) => void;
  /** 打开调课弹窗；null 表示不预选某节课 */
  onOpenAdjust: (target: AdjustTarget | null) => void;
  /** 新增调课、调整、节假日后刷新数据 */
  onChanged: () => void;
  /** 显示开学倒计时 */
  semesterCountdown: boolean;
  /** 显示下一个假期倒计时 */
  holidayCountdown: boolean;
  /** 某天没有日程时提示明日预告 */
  tomorrowPreview: boolean;
}

/** 设置页卡片的渲染上下文 */
export interface SettingsCardContext {
  scope: 'settings';
  layout: LayoutConfig;
  onLayoutChange: (layout: LayoutConfig) => void;
}

/** 设备与同步页卡片的渲染上下文：同样只由布局注册表驱动 */
export interface DevicesCardContext {
  scope: 'devices';
  layout: LayoutConfig;
  onLayoutChange: (layout: LayoutConfig) => void;
}

export type CardContext = ScheduleCardContext | SettingsCardContext | DevicesCardContext;

/** 某页面自己的上下文类型 */
export type CardContextOf<S extends CardScope> = Extract<CardContext, { scope: S }>;

export interface CardDef {
  /** 唯一标识，如 'timeline' | 'exams' | 'countdowns' | 'actions' */
  id: string;
  /** 属于哪个页面 */
  scope: CardScope;
  /** 中文标题 */
  title: string;
  /** 主列 / 侧列 */
  defaultZone: CardZone;
  defaultOrder: number;
  defaultVisible: boolean;
  render(ctx: CardContext): ReactNode;
}

/** 某页面的卡片定义：render 收到的是该页面自己的上下文 */
export type ScopedCard<S extends CardScope> = Omit<CardDef, 'scope' | 'render'> & {
  scope: S;
  render(ctx: CardContextOf<S>): ReactNode;
};

/** 定义卡片；注册表内部统一按 CardContext 保存，调用方仍拿到窄化后的类型 */
export function defineCard<S extends CardScope>(def: ScopedCard<S>): ScopedCard<S> {
  return registerCard(def as unknown as CardDef) as unknown as ScopedCard<S>;
}

/** 卡片在界面上真正生效的形态 */
export interface ResolvedCard {
  def: CardDef;
  visible: boolean;
  order: number;
  zone: CardZone;
}

const REGISTRY = new Map<CardScope, Map<string, CardDef>>();

/** 注册一张卡片；同页面同 id 重复注册时以最后一次为准 */
export function registerCard(def: CardDef): CardDef {
  const bucket = REGISTRY.get(def.scope) ?? new Map<string, CardDef>();
  bucket.set(def.id, def);
  REGISTRY.set(def.scope, bucket);
  return def;
}

/** 某页面注册的全部卡片（按注册表声明序） */
export function listCards(scope: CardScope): readonly CardDef[] {
  return [...(REGISTRY.get(scope)?.values() ?? [])];
}

/** 取某页面的一张卡片 */
export function getCard(scope: CardScope, id: string): CardDef | undefined {
  return REGISTRY.get(scope)?.get(id);
}

function zoneOf(def: CardDef, state: CardState | undefined): CardZone {
  return state?.zone ?? def.defaultZone;
}

function orderOf(def: CardDef, state: CardState | undefined): number {
  return state?.order ?? def.defaultOrder;
}

function visibleOf(def: CardDef, state: CardState | undefined): boolean {
  return state?.visible ?? def.defaultVisible;
}

function byZoneThenOrder(left: ResolvedCard, right: ResolvedCard): number {
  if (left.zone !== right.zone) return left.zone === 'main' ? -1 : 1;
  if (left.order !== right.order) return left.order - right.order;
  return left.def.id.localeCompare(right.def.id);
}

/** 某页面全部卡片在配置下的生效形态（含隐藏项，按区域与顺序排列） */
export function resolveAllCards(scope: CardScope, config: LayoutConfig): ResolvedCard[] {
  return listCards(scope)
    .map((def) => {
      const state = config[def.id];
      return {
        def,
        visible: visibleOf(def, state),
        order: orderOf(def, state),
        zone: zoneOf(def, state),
      };
    })
    .sort(byZoneThenOrder);
}

/** 某页面要渲染的卡片：先按配置过滤隐藏项，再按区域与顺序排出渲染顺序 */
export function resolveCards(scope: CardScope, config: LayoutConfig): ResolvedCard[] {
  return resolveAllCards(scope, config).filter((card) => card.visible);
}

/** 渲染一张已解析的卡片；调用方负责传入该页面自己的上下文 */
export function renderCard<S extends CardScope>(card: ResolvedCard, ctx: CardContextOf<S>): ReactNode {
  return (card.def.render as (ctx: CardContextOf<S>) => ReactNode)(ctx);
}

/** 某页面某个区域要渲染的卡片 */
export function cardsInZone(scope: CardScope, config: LayoutConfig, zone: CardZone): ResolvedCard[] {
  return resolveCards(scope, config).filter((card) => card.zone === zone);
}

/** 写入配置的纯函数：切换某张卡片的显示状态 */
export function toggleCardVisible(config: LayoutConfig, scope: CardScope, id: string): LayoutConfig {
  const card = resolveAllCards(scope, config).find((item) => item.def.id === id);
  if (card === undefined) return config;
  return { ...config, [id]: { ...config[id], visible: !card.visible } };
}

/** 写入配置的纯函数：把卡片切到另一个区域，落位在该区域末尾 */
export function setCardZone(config: LayoutConfig, scope: CardScope, id: string, zone: CardZone): LayoutConfig {
  const cards = resolveAllCards(scope, config);
  const card = cards.find((item) => item.def.id === id);
  if (card === undefined || card.zone === zone) return config;
  const tail = cards.filter((item) => item.zone === zone).reduce((max, item) => Math.max(max, item.order), -1);
  return { ...config, [id]: { ...config[id], zone, order: tail + 1 } };
}

/** 写入配置的纯函数：在同区域内上移或下移一格（交换两张卡片的顺序值） */
export function moveCard(
  config: LayoutConfig,
  scope: CardScope,
  id: string,
  direction: 'up' | 'down',
): LayoutConfig {
  const cards = resolveAllCards(scope, config);
  const card = cards.find((item) => item.def.id === id);
  if (card === undefined) return config;
  const siblings = cards.filter((item) => item.zone === card.zone);
  const index = siblings.findIndex((item) => item.def.id === id);
  const neighbor = siblings[direction === 'up' ? index - 1 : index + 1];
  if (neighbor === undefined) return config;
  return {
    ...config,
    [card.def.id]: { ...config[card.def.id], order: neighbor.order },
    [neighbor.def.id]: { ...config[neighbor.def.id], order: card.order },
  };
}
