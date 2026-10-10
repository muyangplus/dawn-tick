import type { ThemeMode, ThemePreset } from '@dawn-tick/core';
import { AA_LARGE, AA_TEXT, ensureContrast, mix, pickTextOn, rgba } from './contrast.ts';

/** 语义色令牌：`*Strong` 为可用于文字与图标的达标变体，原色只用于填充与大面积色块。 */
export interface ColorTokens {
  bg: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  primary: string;
  onPrimary: string;
  primaryStrong: string;
  accent: string;
  accentStrong: string;
  success: string;
  successStrong: string;
  warning: string;
  warningStrong: string;
  danger: string;
  dangerStrong: string;
  info: string;
  infoStrong: string;
  overlay: string;
}

export interface PresetTokens {
  label: string;
  light: ColorTokens;
  dark: ColorTokens;
  courses: string[];
}

interface BaseColors {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  primary: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

function build(base: BaseColors): ColorTokens {
  const strong = (color: string): string => ensureContrast(color, base.bg, AA_TEXT);
  return {
    bg: base.bg,
    surface: base.surface,
    surfaceMuted: mix(base.bg, base.surface, 0.5),
    border: base.border,
    borderStrong: ensureContrast(base.border, base.surface, AA_LARGE),
    text: base.text,
    muted: base.muted,
    primary: base.primary,
    onPrimary: pickTextOn(base.primary).color,
    primaryStrong: strong(base.primary),
    accent: base.accent,
    accentStrong: strong(base.accent),
    success: base.success,
    successStrong: strong(base.success),
    warning: base.warning,
    warningStrong: strong(base.warning),
    danger: base.danger,
    dangerStrong: strong(base.danger),
    info: base.info,
    infoStrong: strong(base.info),
    overlay: rgba('#000000', 0.36),
  };
}

const SHARED = {
  success: '#2ED573',
  warning: '#FFB020',
  danger: '#FF4757',
  info: '#4D96FF',
};

export const PRESETS: Record<ThemePreset, PresetTokens> = {
  vivid: {
    label: '青春活力',
    light: build({
      bg: '#FFF7F2',
      surface: '#FFFFFF',
      border: '#F0E4DC',
      text: '#1F1B24',
      muted: '#6B6475',
      primary: '#FF6B4A',
      accent: '#6C5CE7',
      ...SHARED,
    }),
    dark: build({
      bg: '#14121A',
      surface: '#1E1A26',
      border: '#2C2634',
      text: '#F3EFF6',
      muted: '#A79FB3',
      primary: '#FF8A6B',
      accent: '#8B7CF0',
      ...SHARED,
    }),
    courses: [
      '#FF6B4A', '#FF9F43', '#FFD93D', '#6BCB77', '#2ED573', '#17C3B2',
      '#4D96FF', '#6C5CE7', '#B15CFF', '#FF6FB5', '#FF8FA3', '#8D6E63',
    ],
  },
  fresh: {
    label: '清爽学院',
    light: build({
      bg: '#F7FAFF',
      surface: '#FFFFFF',
      border: '#E2EAF5',
      text: '#101A28',
      muted: '#5B6B80',
      primary: '#2F80ED',
      accent: '#27AE60',
      success: '#27AE60',
      warning: '#F2C94C',
      danger: '#EB5757',
      info: '#2F80ED',
    }),
    dark: build({
      bg: '#0F1621',
      surface: '#16202E',
      border: '#22303F',
      text: '#EAF1FA',
      muted: '#9FB0C4',
      primary: '#5B9BF5',
      accent: '#4ECB84',
      success: '#4ECB84',
      warning: '#F2C94C',
      danger: '#EB5757',
      info: '#5B9BF5',
    }),
    courses: [
      '#2F80ED', '#56CCF2', '#27AE60', '#6FCF97', '#9B51E0', '#BB6BD9',
      '#F2994A', '#F2C94C', '#EB5757', '#FF8A65', '#00B8A9', '#7E8FA6',
    ],
  },
  mono: {
    label: '极简墨色',
    light: build({
      bg: '#F5F7FA',
      surface: '#FFFFFF',
      border: '#E4E8EE',
      text: '#10161C',
      muted: '#5C6672',
      primary: '#1F2933',
      accent: '#4F8DFD',
      success: '#14B8A6',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#4F8DFD',
    }),
    dark: build({
      bg: '#0B0F14',
      surface: '#131A22',
      border: '#1F2A36',
      text: '#E6ECF3',
      muted: '#939EAB',
      primary: '#E4E9F0',
      accent: '#7BAAF7',
      success: '#14B8A6',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#7BAAF7',
    }),
    courses: [
      '#4F8DFD', '#5C7CFA', '#748FFC', '#94A3B8', '#64748B', '#475569',
      '#0EA5E9', '#14B8A6', '#F59E0B', '#EF4444', '#A855F7', '#334155',
    ],
  },
  muted: {
    label: '莫兰迪柔光',
    light: build({
      bg: '#FAF7F2',
      surface: '#FFFFFF',
      border: '#E8E2D9',
      text: '#2A2A26',
      muted: '#6E6B63',
      primary: '#8A9A8B',
      accent: '#C08A7C',
      success: '#84A98C',
      warning: '#DDBEA9',
      danger: '#B5838D',
      info: '#7D8CA3',
    }),
    dark: build({
      bg: '#1A1A18',
      surface: '#232320',
      border: '#2E2E2A',
      text: '#EFEDE7',
      muted: '#A6A29A',
      primary: '#A9B8AA',
      accent: '#D6A395',
      success: '#84A98C',
      warning: '#DDBEA9',
      danger: '#B5838D',
      info: '#7D8CA3',
    }),
    courses: [
      '#8A9A8B', '#A3B18A', '#CB997E', '#B5838D', '#E5989B', '#DDBEA9',
      '#A5A58D', '#6D6875', '#7D8CA3', '#9C89B8', '#C9ADA7', '#84A98C',
    ],
  },
};

export const SPACING = { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px' } as const;
export const RADIUS = { sm: '8px', md: '12px', lg: '16px', full: '9999px' } as const;
export const FONT_SIZE = {
  xs: '12px',
  sm: '14px',
  base: '16px',
  lg: '20px',
  xl: '24px',
  '2xl': '32px',
} as const;
export const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
export const SHADOW = {
  sm: '0 1px 2px rgb(0 0 0 / 0.06)',
  md: '0 4px 12px rgb(0 0 0 / 0.10)',
  lg: '0 12px 32px rgb(0 0 0 / 0.16)',
} as const;
export const TAP_MIN = 44;
export const BREAKPOINT = { tablet: 768, desktop: 1024 } as const;

/** 课程块底色：以表面色为基底混入课程色，保证块内文字仍满足对比度要求。 */
export function courseTint(surface: string, courseColor: string, amount = 0.18): string {
  return mix(surface, courseColor, amount);
}

export function courseTextOn(tintColor: string): string {
  return pickTextOn(tintColor).color;
}

export function resolveTokens(preset: ThemePreset, mode: 'light' | 'dark'): ColorTokens {
  return PRESETS[preset][mode];
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/** 运行时变量：`--dt-*` 供 Tailwind 令牌映射，其余为迁移期的旧变量名。 */
export function cssVariables(preset: ThemePreset, mode: 'light' | 'dark'): Record<string, string> {
  const tokens = resolveTokens(preset, mode);
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    variables[`--dt-${kebab(key)}`] = value;
    variables[`--${key}`] = value;
  }
  PRESETS[preset].courses.forEach((color, index) => {
    variables[`--dt-course-${index}`] = color;
    variables[`--dt-course-${index}-tint`] = courseTint(tokens.surface, color);
    variables[`--course-${index}`] = color;
  });
  return variables;
}
