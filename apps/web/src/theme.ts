import type { ThemeMode, ThemePreset } from '@dawn-tick/core';

export interface ThemeTokens {
  label: string;
  light: Record<string, string>;
  dark: Record<string, string>;
  courses: string[];
}

const SHARED = {
  success: '#2ED573',
  warning: '#FFB020',
  danger: '#FF4757',
  info: '#4D96FF',
};

export const THEMES: Record<ThemePreset, ThemeTokens> = {
  vivid: {
    label: '青春活力',
    light: {
      bg: '#FFF7F2',
      surface: '#FFFFFF',
      primary: '#FF6B4A',
      accent: '#6C5CE7',
      text: '#1F1B24',
      muted: '#6B6475',
      border: '#F0E4DC',
      ...SHARED,
    },
    dark: {
      bg: '#14121A',
      surface: '#1E1A26',
      primary: '#FF8A6B',
      accent: '#8B7CF0',
      text: '#F3EFF6',
      muted: '#A79FB3',
      border: '#2C2634',
      ...SHARED,
    },
    courses: [
      '#FF6B4A', '#FF9F43', '#FFD93D', '#6BCB77', '#2ED573', '#17C3B2',
      '#4D96FF', '#6C5CE7', '#B15CFF', '#FF6FB5', '#FF8FA3', '#8D6E63',
    ],
  },
  fresh: {
    label: '清爽学院',
    light: {
      bg: '#F7FAFF',
      surface: '#FFFFFF',
      primary: '#2F80ED',
      accent: '#27AE60',
      text: '#101A28',
      muted: '#5B6B80',
      border: '#E2EAF5',
      success: '#27AE60',
      warning: '#F2C94C',
      danger: '#EB5757',
      info: '#2F80ED',
    },
    dark: {
      bg: '#0F1621',
      surface: '#16202E',
      primary: '#5B9BF5',
      accent: '#4ECB84',
      text: '#EAF1FA',
      muted: '#9FB0C4',
      border: '#22303F',
      success: '#4ECB84',
      warning: '#F2C94C',
      danger: '#EB5757',
      info: '#5B9BF5',
    },
    courses: [
      '#2F80ED', '#56CCF2', '#27AE60', '#6FCF97', '#9B51E0', '#BB6BD9',
      '#F2994A', '#F2C94C', '#EB5757', '#FF8A65', '#00B8A9', '#7E8FA6',
    ],
  },
  mono: {
    label: '极简墨色',
    light: {
      bg: '#F5F7FA',
      surface: '#FFFFFF',
      primary: '#1F2933',
      accent: '#4F8DFD',
      text: '#10161C',
      muted: '#5C6672',
      border: '#E4E8EE',
      success: '#14B8A6',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#4F8DFD',
    },
    dark: {
      bg: '#0B0F14',
      surface: '#131A22',
      primary: '#E4E9F0',
      accent: '#7BAAF7',
      text: '#E6ECF3',
      muted: '#939EAB',
      border: '#1F2A36',
      success: '#14B8A6',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#7BAAF7',
    },
    courses: [
      '#4F8DFD', '#5C7CFA', '#748FFC', '#94A3B8', '#64748B', '#475569',
      '#0EA5E9', '#14B8A6', '#F59E0B', '#EF4444', '#A855F7', '#334155',
    ],
  },
  muted: {
    label: '莫兰迪柔光',
    light: {
      bg: '#FAF7F2',
      surface: '#FFFFFF',
      primary: '#8A9A8B',
      accent: '#C08A7C',
      text: '#2A2A26',
      muted: '#6E6B63',
      border: '#E8E2D9',
      success: '#84A98C',
      warning: '#DDBEA9',
      danger: '#B5838D',
      info: '#7D8CA3',
    },
    dark: {
      bg: '#1A1A18',
      surface: '#232320',
      primary: '#A9B8AA',
      accent: '#D6A395',
      text: '#EFEDE7',
      muted: '#A6A29A',
      border: '#2E2E2A',
      success: '#84A98C',
      warning: '#DDBEA9',
      danger: '#B5838D',
      info: '#7D8CA3',
    },
    courses: [
      '#8A9A8B', '#A3B18A', '#CB997E', '#B5838D', '#E5989B', '#DDBEA9',
      '#A5A58D', '#6D6875', '#7D8CA3', '#9C89B8', '#C9ADA7', '#84A98C',
    ],
  },
};

export function resolveMode(mode: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

export function courseColor(preset: ThemePreset, index: number): string {
  const palette = THEMES[preset].courses;
  return palette[index % palette.length] ?? palette[0] ?? '#4F8DFD';
}

export function applyTheme(preset: ThemePreset, mode: ThemeMode, root: HTMLElement = document.documentElement): 'light' | 'dark' {
  const prefersDark =
    typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = resolveMode(mode, prefersDark);
  const tokens = THEMES[preset][resolved];
  root.dataset.theme = resolved;
  root.dataset.preset = preset;
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${key}`, value);
  }
  THEMES[preset].courses.forEach((color, index) => {
    root.style.setProperty(`--course-${index}`, color);
  });
  return resolved;
}
