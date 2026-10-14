export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const text = hex.trim().replace(/^#/, '');
  const full = text.length === 3 ? text.split('').map((ch) => ch + ch).join('') : text;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`非法颜色值: ${hex}`);
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const linear = (value: number): number => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const t = Math.max(0, Math.min(1, amount));
  return toHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

/** 在两个候选前景色中选出与背景对比度更高者。 */
export function pickTextOn(background: string, candidates: readonly string[] = ['#FFFFFF', '#111111']): {
  color: string;
  ratio: number;
} {
  let best: { color: string; ratio: number } | null = null;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, background);
    if (best === null || ratio > best.ratio) best = { color: candidate, ratio };
  }
  if (best === null) throw new Error('候选前景色为空');
  return best;
}

/** 就地混色直到与背景达到目标对比度；浅底向黑、深底向白。 */
export function ensureContrast(color: string, background: string, target: number = AA_TEXT): string {
  if (contrastRatio(color, background) >= target) return color.toUpperCase();
  const toward = relativeLuminance(background) > 0.5 ? '#000000' : '#FFFFFF';
  for (let step = 1; step <= 40; step += 1) {
    const candidate = mix(color, toward, step / 40);
    if (contrastRatio(candidate, background) >= target) return candidate;
  }
  return toward;
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
