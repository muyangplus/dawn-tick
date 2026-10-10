import type { ThemeMode, ThemePreset } from '@dawn-tick/core';
import { PRESETS, courseTint, cssVariables, resolveTokens } from './design/tokens.ts';

/** 主题预设；`label` 用于设置页展示，`courses` 为课程取色板。 */
export const THEMES = PRESETS;

export function resolveMode(mode: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

export function courseColor(preset: ThemePreset, index: number): string {
  const palette = PRESETS[preset].courses;
  return palette[index % palette.length] ?? palette[0] ?? '#4F8DFD';
}

export { courseTint, resolveTokens };

export function applyTheme(
  preset: ThemePreset,
  mode: ThemeMode,
  root: HTMLElement = document.documentElement,
): 'light' | 'dark' {
  const prefersDark =
    typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = resolveMode(mode, prefersDark);
  root.dataset.theme = resolved;
  root.dataset.preset = preset;
  for (const [key, value] of Object.entries(cssVariables(preset, resolved))) {
    root.style.setProperty(key, value);
  }
  return resolved;
}
