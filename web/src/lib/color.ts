// Derivação do tema de cores a partir do time selecionado.
//
// Todas as funções são puras (fáceis de testar): recebem hex e devolvem hex.
// A cor primária do time vira o `accent` e colore fundo/superfícies/bordas,
// tanto no modo claro quanto no escuro — o modo escuro clareia a cor para
// manter contraste legível.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export const FALLBACK_PRIMARY = '#0093EC';

/** Converte `#abc`, `#aabbcc` (com ou sem `#`) em RGB. */
export function parseHex(input: string | null | undefined): Rgb | null {
  if (!input) return null;
  let hex = String(input).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (hex.length !== 6) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) =>
    clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return {
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255,
  };
}

/** Interpola duas cores (t=0 => a, t=1 => b). */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1);
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

/** Branco (#fff) ou preto (#000), conforme tiver mais contraste sobre `bg`. */
export function readableTextOn(bg: Rgb): string {
  const luminance = (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 255;
  return luminance > 0.55 ? '#111827' : '#F8FAFC';
}

/** Cor primária "consertada" para ser usada como accent (legível nos dois modos). */
export function accentFor(primary: string, mode: 'light' | 'dark'): string {
  const rgb = parseHex(primary) ?? parseHex(FALLBACK_PRIMARY)!;
  const hsl = rgbToHsl(rgb);
  // cores muito claras/escuras não servem de accent: aproxima do intervalo útil
  const l = mode === 'light' ? clamp(hsl.l, 0.3, 0.52) : clamp(hsl.l, 0.56, 0.74);
  const s = clamp(hsl.s, 0.45, 0.95);
  return toHex(hslToRgb({ h: hsl.h, s, l }));
}

export interface ThemeTokens {
  accent: string;
  accentStrong: string;
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
  focusRing: string;
}

/**
 * Paleta completa derivada da cor do time para um modo.
 *
 * O fundo/superfícies recebem um matiz bem discreto da cor primária, para a
 * aplicação "pertencer" ao time sem comprometer a legibilidade.
 */
export function teamThemeTokens(
  primary: string | null | undefined,
  mode: 'light' | 'dark',
): ThemeTokens {
  const rgb = parseHex(primary) ?? parseHex(FALLBACK_PRIMARY)!;
  const { h } = rgbToHsl(rgb);
  const accent = accentFor(primary ?? FALLBACK_PRIMARY, mode);

  if (mode === 'light') {
    return {
      accent,
      accentStrong: toHex(hslToRgb({ h, s: clamp(rgbToHsl(parseHex(accent)!).s, 0.5, 0.95), l: 0.32 })),
      bg: toHex(hslToRgb({ h, s: 0.16, l: 0.965 })),
      surface: toHex(hslToRgb({ h, s: 0.1, l: 0.995 })),
      surface2: toHex(hslToRgb({ h, s: 0.18, l: 0.945 })),
      border: toHex(hslToRgb({ h, s: 0.22, l: 0.855 })),
      text: '#131820',
      textMuted: '#556072',
      focusRing: toHex(hslToRgb({ h, s: 0.7, l: 0.42 })),
    };
  }

  return {
    accent,
    accentStrong: toHex(hslToRgb({ h, s: clamp(rgbToHsl(parseHex(accent)!).s, 0.5, 0.95), l: 0.66 })),
    bg: toHex(hslToRgb({ h, s: 0.24, l: 0.085 })),
    surface: toHex(hslToRgb({ h, s: 0.2, l: 0.13 })),
    surface2: toHex(hslToRgb({ h, s: 0.18, l: 0.17 })),
    border: toHex(hslToRgb({ h, s: 0.16, l: 0.26 })),
    text: '#E8EEF8',
    textMuted: '#9BA7BA',
    focusRing: toHex(hslToRgb({ h, s: 0.6, l: 0.62 })),
  };
}

/** Aplica os tokens no elemento raiz (variáveis CSS usadas pelo tokens.css). */
export function applyThemeTokens(
  el: HTMLElement,
  tokens: ThemeTokens,
  mode: 'light' | 'dark',
): void {
  el.setAttribute('data-theme', mode);
  el.style.setProperty('--accent', tokens.accent);
  el.style.setProperty('--accent-strong', tokens.accentStrong);
  el.style.setProperty('--bg', tokens.bg);
  el.style.setProperty('--surface', tokens.surface);
  el.style.setProperty('--surface-2', tokens.surface2);
  el.style.setProperty('--border', tokens.border);
  el.style.setProperty('--text', tokens.text);
  el.style.setProperty('--text-muted', tokens.textMuted);
  el.style.setProperty('--focus-ring', tokens.focusRing);
}
