// Moving backgrounds for the 수련회 (and any deck): generated live, so no video file is needed.
// The retreat theme text picks a look by its words; every part of it can be changed by hand.
import type { Background, MotionStyle, RetreatLook } from './types';

export type MotionBackground = Extract<Background, { kind: 'motion' }>;

export const MOTION_STYLES: { id: MotionStyle; label: string; hint: string }[] = [
  { id: 'aurora', label: '오로라', hint: '은혜 · 하늘 · 새벽' },
  { id: 'waves', label: '물결', hint: '바다 · 생수 · 강' },
  { id: 'stars', label: '별빛', hint: '밤 · 광야 · 약속' },
  { id: 'rays', label: '빛줄기', hint: '빛 · 영광 · 소망' },
  { id: 'embers', label: '불꽃', hint: '성령 · 부흥 · 열정' },
  { id: 'bokeh', label: '빛망울', hint: '생명 · 사랑 · 열매' },
];

/** [base, accent, highlight] for each style. */
export const MOTION_PALETTES: Record<MotionStyle, string[]> = {
  aurora: ['#08122b', '#3ad6c4', '#8a6bff'],
  waves: ['#04213f', '#1d7fd1', '#7fd3ff'],
  stars: ['#050b1f', '#7f9bff', '#ffffff'],
  rays: ['#0a1a3a', '#ffcf5c', '#fff3c4'],
  embers: ['#1a0603', '#ff6a1f', '#ffc247'],
  bokeh: ['#06210f', '#5ee08a', '#f7e26b'],
};

/** Words in a theme (Korean and English) that point to a style. */
const KEYWORDS: Record<MotionStyle, RegExp> = {
  rays: /빛|광명|영광|비추|밝|등불|등대|소망|light|shine|glory|lamp|bright|hope|ray/i,
  waves: /바다|(?:^|[^가-힣])물(?![가-힣])|물결|물가|생수|(?:^|[^가-힣])강(?![가-힣])|강물|강가|샘물|파도|세례|흐르|폭포|호수|갈릴리|sea|water|river|ocean|flood|stream|spring|wave/i,
  embers: /성령|열정|부흥|제단|타오|뜨거|연단|(?:^|[^가-힣])불(?![가-힣])|불꽃|불길|불씨|불타|fire|flame|spirit|revival|passion|burn|altar|ember/i,
  stars: /(?:^|[^가-힣])별(?![가-힣])|별빛|(?:^|[^가-힣])밤|광야|사막|약속|어둠|어두|night|star|wilderness|desert|promise|dark/i,
  bokeh: /생명|열매|포도|(?:^|[^가-힣])봄(?![가-힣])|(?:^|[^가-힣])숲|(?:^|[^가-힣])꽃|씨앗|자라|성장|사랑|평안|기쁨|life|fruit|vine|forest|seed|grow|love|peace|joy|flower/i,
  aurora: /은혜|하늘|새벽|아침|새롭|새 일|변화|은총|천국|동행|grace|heaven|dawn|morning|new|change|walk/i,
};

const ORDER: MotionStyle[] = ['rays', 'waves', 'embers', 'stars', 'bokeh', 'aurora'];

/** Small stable number for a text, so a theme with no known word still gets its own steady look. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The style a theme text points to: most matching words win; no match = a steady pick from the text. */
export function styleForTheme(theme: string): MotionStyle {
  const text = theme.trim();
  if (!text) return 'aurora';
  let best: MotionStyle | null = null;
  let bestHits = 0;
  for (const style of ORDER) {
    const hits = text.match(new RegExp(KEYWORDS[style].source, 'gi'))?.length ?? 0;
    if (hits > bestHits) { best = style; bestHits = hits; }
  }
  return best ?? ORDER[hash(text.toLowerCase()) % ORDER.length];
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Always three usable colours: a bad or missing one falls back to the style's palette. */
export function safeColors(style: MotionStyle, colors: unknown): string[] {
  const palette = MOTION_PALETTES[style] ?? MOTION_PALETTES.aurora;
  const given = Array.isArray(colors) ? colors : [];
  return palette.map((fallback, i) => (typeof given[i] === 'string' && HEX.test(given[i]) ? given[i].toLowerCase() : fallback));
}

export const clampSpeed = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(3, Math.max(0.25, v)) : 1);
const clampDim = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(0.9, Math.max(0, v)) : 0.25);

export const isMotionStyle = (v: unknown): v is MotionStyle => MOTION_STYLES.some((s) => s.id === v);

export function motionBackground(style: MotionStyle, colors?: string[], speed = 1): MotionBackground {
  return { kind: 'motion', style, colors: safeColors(style, colors), speed: clampSpeed(speed) };
}

export function defaultRetreatLook(theme = ''): RetreatLook {
  const style = styleForTheme(theme);
  return { theme, enabled: true, auto: true, style, colors: [...MOTION_PALETTES[style]], speed: 1, dim: 0.25 };
}

/** The theme text changed: with 자동 on the style and colours follow it, otherwise only the text is kept. */
export function withTheme(look: RetreatLook, theme: string): RetreatLook {
  if (!look.auto) return { ...look, theme };
  const style = styleForTheme(theme);
  return { ...look, theme, style, colors: [...MOTION_PALETTES[style]] };
}

/** Choose a style by hand: colours reset to its palette (they can be changed afterwards). */
export function withStyle(look: RetreatLook, style: MotionStyle): RetreatLook {
  return { ...look, auto: false, style, colors: [...MOTION_PALETTES[style]] };
}

/** Turn 자동 back on: style and colours follow the theme text again. */
export function withAuto(look: RetreatLook, auto: boolean): RetreatLook {
  return auto ? withTheme({ ...look, auto: true }, look.theme) : { ...look, auto: false };
}

/** The background a retreat deck gets, or null when the retreat look is switched off. */
export function retreatBackground(look: RetreatLook | undefined | null): MotionBackground | null {
  return look?.enabled ? motionBackground(look.style, look.colors, look.speed) : null;
}

/** Check a look read from storage or the cloud; null when it is not one. */
export function normalizeRetreatLook(value: unknown): RetreatLook | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (!isMotionStyle(v.style)) return undefined;
  return {
    theme: typeof v.theme === 'string' ? v.theme.slice(0, 200) : '',
    enabled: v.enabled !== false,
    auto: v.auto !== false,
    style: v.style,
    colors: safeColors(v.style, v.colors),
    speed: clampSpeed(v.speed),
    dim: clampDim(v.dim),
  };
}

export const mix = (a: string, b: string, k: number) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((x >> shift) & 255) * (1 - k) + ((y >> shift) & 255) * k);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
};

export const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/** A still picture of the look (thumbnails, slide sorter, PowerPoint export): CSS gradients in its colours. */
export function motionFallback(bg: MotionBackground): string {
  const [base, accent, high] = safeColors(bg.style, bg.colors);
  return [
    `radial-gradient(ellipse at 50% 38%, ${rgba(accent, 0.55)} 0%, ${rgba(high, 0.12)} 38%, transparent 68%)`,
    `linear-gradient(180deg, ${base} 0%, ${mix(base, accent, 0.18)} 100%)`,
  ].join(', ');
}

/** The one #rrggbb colour that stands in for the look where only a flat colour is possible. */
export const motionFlatColor = (bg: MotionBackground) => safeColors(bg.style, bg.colors)[0];
