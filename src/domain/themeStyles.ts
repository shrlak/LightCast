// Design › Colors / Fonts / Background Styles: the 12 theme colour slots, custom colour and font
// schemes (Create New Theme Colors / Fonts), and the 12 Background Styles.
//
// A colour scheme is 12 colours in the order the engine reads them (`custom:<name>|<12 hex>`):
// dk1, lt1, dk2, lt2, accent1-6, hlink, folHlink. LightCast themes have no bg1/bg2/tx1/tx2 matrix of
// their own, so the Background Styles are built from the scheme: lt1 / lt2 / dk2 / dk1 as solids
// (PowerPoint's Background 1, Background 2, Text 2, Text 1), then a subtle and an intense
// gradient of each with the accent colours mixed in.
import type { Background, Presentation, SlideElement } from './types';
import { officeFont } from './fonts';

export const COLOR_SLOTS: { key: string; label: string }[] = [
  { key: 'dk1', label: '텍스트/배경 - 어둡게 1' },
  { key: 'lt1', label: '텍스트/배경 - 밝게 1' },
  { key: 'dk2', label: '텍스트/배경 - 어둡게 2' },
  { key: 'lt2', label: '텍스트/배경 - 밝게 2' },
  { key: 'accent1', label: '강조 1' },
  { key: 'accent2', label: '강조 2' },
  { key: 'accent3', label: '강조 3' },
  { key: 'accent4', label: '강조 4' },
  { key: 'accent5', label: '강조 5' },
  { key: 'accent6', label: '강조 6' },
  { key: 'hlink', label: '하이퍼링크' },
  { key: 'folHlink', label: '열어 본 하이퍼링크' },
];

/** `#rgb` / `#rrggbb` / `rrggbb` → `#rrggbb` (lower case), or null. */
export function normalizeHex(v: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

/** A scheme / theme name as the engine can carry it in `custom:<name>|…` (no `|` or `,`). */
export const cleanName = (n: string) => n.replace(/[|,]/g, ' ').replace(/\s+/g, ' ').trim();

/** The scheme name the engine reads. */
export const customSchemeId = (name: string, colors: string[]) => `custom:${cleanName(name)}|${colors.join(',')}`;

/** A `custom:` scheme name → its label and 12 colours (null when it is not one, or malformed). */
export function parseCustomScheme(id: string | undefined): { name: string; colors: string[] } | null {
  if (!id?.startsWith('custom:')) return null;
  const [name, list] = id.slice(7).split('|');
  const colors = (list ?? '').split(',').map((c) => normalizeHex(c));
  if (colors.length !== 12 || colors.some((c) => !c)) return null;
  return { name: name || '사용자 지정', colors: colors as string[] };
}

/** The 12 colours of a scheme given by name: a custom one, or one of the engine's. */
export function colorsOf(id: string | undefined, builtin: { name: string; colors: string[] }[]): string[] {
  return parseCustomScheme(id)?.colors ?? builtin.find((s) => s.name === id)?.colors ?? builtin[0]?.colors ?? [];
}

// ---------------------------------------------------------------- Background Styles

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt((normalizeHex(hex) ?? '#000000').slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** `a` mixed with `b` (t = share of `b`). */
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
export const luminance = (hex: string) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export interface BackgroundStyle {
  /** 1–12, in PowerPoint's order: solid, subtle, intense × Background 1, Background 2, Text 2, Text 1. */
  n: number;
  label: string;
  background: Background;
  /** The text colour that reads on it: the scheme's dark or light text colour, whichever contrasts more. */
  text: string;
  /** A CSS colour or gradient for the swatch. */
  css: string;
}

const STYLE_BASE = [{ slot: 1, name: '배경 1' }, { slot: 3, name: '배경 2' }, { slot: 2, name: '텍스트 2' }, { slot: 0, name: '텍스트 1' }];
const STYLE_KIND = ['단색', '은은한 효과', '강한 효과'];

/** The 12 Background Styles for a scheme's 12 colours (see the file comment). */
export function backgroundStyles(colors: string[]): BackgroundStyle[] {
  const c = (i: number, fallback: string) => normalizeHex(colors[i] ?? '') ?? fallback;
  const dk1 = c(0, '#000000'), lt1 = c(1, '#ffffff'), accent1 = c(4, '#4472c4'), accent2 = c(5, '#ed7d31');
  const out: BackgroundStyle[] = [];
  for (let kind = 0; kind < 3; kind++) {
    STYLE_BASE.forEach(({ slot, name }, k) => {
      const base = c(slot, slot % 2 ? '#ffffff' : '#000000');
      const dark = luminance(base) < 0.4;
      // Accent tints stay light on a light base and deep on a dark one.
      const tint = (a: string, t: number) => mix(base, a, dark ? t * 0.8 : t);
      const css = kind === 0 ? base
        : kind === 1 ? `linear-gradient(160deg, ${tint(accent1, 0.08)} 0%, ${tint(accent1, 0.3)} 100%)`
        : `radial-gradient(ellipse at 30% 20%, ${tint(accent1, 0.6)} 0%, ${tint(accent2, 0.28)} 50%, ${mix(base, dark ? '#000000' : dk1, dark ? 0.45 : 0.28)} 100%)`;
      const text = contrast(dk1, base) >= contrast(lt1, base) ? dk1 : lt1;
      out.push({ n: kind * 4 + k + 1, label: `배경 스타일 ${kind * 4 + k + 1} (${name} · ${STYLE_KIND[kind]})`, css, text, background: kind === 0 ? { kind: 'color', value: base } : { kind: 'gradient', value: css } });
    });
  }
  return out;
}

/** The presentation patch that applies a Background Style to every slide, with the text colour that reads on it. */
export function applyBackgroundStyle(p: Pick<Presentation, 'slides'>, style: BackgroundStyle, themeColor: string): Partial<Presentation> {
  return {
    background: style.background,
    slides: p.slides.map((s) => {
      const st = { ...(s.style ?? {}) };
      // The theme's own text colour stays when it reads on the style; else the style's text colour.
      if (contrast(themeColor, firstColor(style.css)) >= 4.5) delete st.color; else st.color = style.text;
      return { ...s, background: style.background, style: Object.keys(st).length ? st : undefined };
    }),
  };
}

/** The first colour in a CSS gradient. */
export const firstColor = (css: string) => /#[0-9a-f]{6}/i.exec(css)?.[0] ?? '#000000';

// ---------------------------------------------------------------- Custom schemes (the galleries' own list)

export interface CustomColorScheme { id: string; name: string; colors: string[] }
export interface CustomFontScheme { id: string; name: string; major: string; minor: string }
const KEY_COLORS = 'lightcast.customColorSchemes', KEY_FONTS = 'lightcast.customFontSchemes';

function read<T>(key: string): T[] {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked: the list is just not remembered */ } }

export const loadColorSchemes = (): CustomColorScheme[] => read<CustomColorScheme>(KEY_COLORS).filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.colors) && s.colors.length === 12);
export const loadFontSchemes = (): CustomFontScheme[] => read<CustomFontScheme>(KEY_FONTS).filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.major === 'string' && typeof s.minor === 'string');

/** Add or replace (same id) a custom colour scheme in a list; a new one with a taken name gets the older one's place. */
export function upsertByName<T extends { id: string; name: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id || x.name === item.name);
  return i < 0 ? [...list, item] : list.map((x, k) => (k === i ? { ...item, id: x.id === item.id ? item.id : x.id } : x));
}
export const saveColorScheme = (item: CustomColorScheme) => { const next = upsertByName(loadColorSchemes(), item); write(KEY_COLORS, next); return next; };
export const deleteColorScheme = (id: string) => { const next = loadColorSchemes().filter((s) => s.id !== id); write(KEY_COLORS, next); return next; };
export const saveFontScheme = (item: CustomFontScheme) => { const next = upsertByName(loadFontSchemes(), item); write(KEY_FONTS, next); return next; };
export const deleteFontScheme = (id: string) => { const next = loadFontSchemes().filter((s) => s.id !== id); write(KEY_FONTS, next); return next; };

/** The next free name "사용자 지정 1", "사용자 지정 2"… among `taken`. */
export function nextCustomName(taken: string[], base = '사용자 지정'): string {
  for (let i = 1; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

// ---------------------------------------------------------------- Theme fonts

export interface FontScheme { name: string; major: string; minor: string }

/** The editor's title text: a placeholder-title box. */
const isHeading = (e: SlideElement) => e.kind === 'text' && e.placeholder === 'title';

/**
 * The presentation patch that makes `scheme` its theme fonts: the heading font on titles (the slide's own
 * title is drawn in the slide font, so it follows the body font here), the body font on all other text.
 */
export function applyFontScheme(p: Pick<Presentation, 'slides'>, scheme: FontScheme): Partial<Presentation> {
  const major = officeFont(scheme.major), minor = officeFont(scheme.minor);
  const fix = (e: SlideElement): SlideElement => (e.kind === 'text' || e.kind === 'shape' || e.kind === 'table' ? { ...e, fontFamily: isHeading(e) ? major : minor } : e);
  return { fontScheme: { name: scheme.name, major: scheme.major, minor: scheme.minor }, slides: p.slides.map((s) => ({ ...s, style: { ...s.style, fontFamily: minor }, elements: s.elements?.map(fix) })) };
}
